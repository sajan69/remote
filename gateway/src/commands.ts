import type { CommandRecord, DeviceRecord, DeviceState } from '@remote/protocol'
import { validateArguments } from '@remote/protocol'
import type { Hub } from './hub.ts'
import type { Store } from './store.ts'

export interface ExecuteResult {
  kind: 'transmitted' | 'failed' | 'unknown'
  code?: string
  message?: string
  statePatch?: Record<string, unknown>
  confirmed?: boolean
}

export interface CommandDeps {
  now: () => number
  delay: (ms: number) => Promise<void>
  deadlineMs: number
  coalesceMs: number
  store: Store
  hub: Hub
  execute: (device: DeviceRecord, command: CommandRecord) => Promise<ExecuteResult>
  onTerminal?: (command: CommandRecord) => void
}

interface Queue {
  items: Array<{ command: CommandRecord; device: DeviceRecord }>
  running: boolean
}

export class CommandError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class CommandService {
  private readonly queues = new Map<string, Queue>()
  private work = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly deps: CommandDeps) {}

  submit(input: {
    device: DeviceRecord
    id: string
    capability: string
    arguments: Record<string, unknown>
    sequence: number
    trial?: CommandRecord['trial']
  }): CommandRecord {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(input.id)) {
      throw new CommandError(400, 'invalid_command', 'Command id is not valid.')
    }
    const existing = this.deps.store.data.commands.find((command) => command.id === input.id)
    if (existing) return existing
    if (!Number.isInteger(input.sequence) || input.sequence < 1) {
      throw new CommandError(400, 'invalid_command', 'Command sequence is not valid.')
    }

    const capability = input.device.capabilities.find((item) => item.id === input.capability && item.available)
    if (!capability) {
      throw new CommandError(400, 'unsupported_capability', 'That control is not available on this device.')
    }
    const valid = validateArguments(capability, input.arguments)
    if (!valid.ok) throw new CommandError(400, 'invalid_command', valid.message)

    const last = input.trial
      ? (this.deps.store.data.trialSequences[input.trial.connectionId] ?? 0)
      : input.device.lastSequence
    if (input.sequence <= last) {
      throw new CommandError(409, 'stale_sequence', 'A newer command was already accepted. This one was not sent.')
    }

    const created = this.deps.now()
    const command: CommandRecord = {
      id: input.id,
      deviceId: input.device.id,
      capability: input.capability,
      arguments: input.arguments,
      sequence: input.sequence,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.deps.deadlineMs).toISOString(),
      status: 'gateway_accepted',
      phase: 'queued',
      simulated: input.device.simulated,
      idempotent: capability.idempotent,
      ...(input.trial ? { trial: input.trial } : {}),
    }

    this.deps.store.mutate((data) => {
      data.commands.push(command)
      if (data.commands.length > 300) data.commands.splice(0, data.commands.length - 300)
      if (input.trial) data.trialSequences[input.trial.connectionId] = input.sequence
      const saved = data.devices.find((device) => device.id === input.device.id)
      if (saved) {
        saved.lastSequence = input.sequence
        saved.lastUsedAt = command.createdAt
      }
    })
    this.deps.hub.publish({ type: 'command', command })
    this.enqueue(input.device, command)
    return command
  }

  cancel(id: string): CommandRecord {
    const command = this.deps.store.data.commands.find((item) => item.id === id)
    if (!command) throw new CommandError(404, 'not_found', 'That command is not on this gateway.')
    if (command.phase !== 'queued' || command.status !== 'gateway_accepted') {
      throw new CommandError(
        409,
        'already_sending',
        'This command may already have been sent. It was not cancelled or retried.',
      )
    }
    this.finish(command, 'failed', {
      code: 'cancelled',
      message: 'Stopped before it was sent.',
    })
    return command
  }

  whenIdle(): Promise<void> {
    if (this.work === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private enqueue(device: DeviceRecord, command: CommandRecord): void {
    const key = device.id
    const queue = this.queues.get(key) ?? { items: [], running: false }
    queue.items.push({ command, device })
    this.queues.set(key, queue)
    this.work += 1
    if (!queue.running) {
      queue.running = true
      void this.pump(queue)
    }
  }

  private async pump(queue: Queue): Promise<void> {
    try {
      while (queue.items.length > 0) {
        let item = queue.items.shift()
        if (!item) break
        if (item.command.capability === 'climate.set' && this.deps.coalesceMs > 0) {
          await this.deps.delay(this.deps.coalesceMs)
          const absorbed = [item]
          while (queue.items[0]?.command.capability === 'climate.set') {
            const next = queue.items.shift()
            if (next) absorbed.push(next)
          }
          for (const old of absorbed.slice(0, -1)) {
            if (old.command.status === 'gateway_accepted') {
              this.finish(old.command, 'failed', {
                code: 'coalesced',
                message: 'A newer temperature change replaced this one before it was sent.',
              })
            }
          }
          item = absorbed[absorbed.length - 1] ?? item
        }
        if (item.command.status !== 'gateway_accepted') continue
        if (this.deps.now() >= Date.parse(item.command.expiresAt)) {
          this.finish(item.command, 'failed', {
            code: 'expired',
            message: 'The command expired before it could be sent. It was not retried.',
          })
          continue
        }
        item.command.phase = 'sending'
        this.touch(item.command)
        try {
          const result = await this.deps.execute(item.device, item.command)
          this.applyResult(item.device, item.command, result)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The command did not finish.'
          this.finish(item.command, 'outcome_unknown', {
            code: 'transmission_timeout',
            message: `${message} It was not retried.`,
          })
        }
      }
    } finally {
      queue.running = false
      if (queue.items.length > 0) {
        queue.running = true
        void this.pump(queue)
      }
    }
  }

  private applyResult(device: DeviceRecord, command: CommandRecord, result: ExecuteResult): void {
    if (result.kind === 'failed') {
      this.finish(command, 'failed', {
        code: result.code ?? 'transmission_failed',
        message: result.message ?? 'The command was not sent.',
      })
      return
    }
    if (result.kind === 'unknown') {
      this.finish(command, 'outcome_unknown', {
        code: result.code ?? 'outcome_unknown',
        message: result.message ?? 'It is unclear whether this command was sent. It was not retried.',
      })
      return
    }

    const confirmed = Boolean(result.confirmed) && device.confirmation === 'state' && !device.simulated
    command.status = confirmed ? 'appliance_confirmed' : 'transmitted'
    command.phase = 'done'
    command.simulated = device.simulated
    this.touch(command)
    if (result.statePatch && Object.keys(result.statePatch).length > 0) {
      this.patchState(device, command, result.statePatch, confirmed)
    }
    this.deps.hub.publish({ type: 'command', command })
    this.finishWork()
  }

  private patchState(
    device: DeviceRecord,
    command: CommandRecord,
    patch: Record<string, unknown>,
    confirmed: boolean,
  ): void {
    const saved = this.deps.store.data.devices.find((item) => item.id === device.id)
    if (!saved) return
    const note = device.simulated
      ? 'Demo preview. No appliance was contacted.'
      : confirmed
        ? 'The integration reported a matching update.'
        : 'Sent. The appliance has not confirmed this state.'
    const state: DeviceState = {
      values: { ...saved.state.values, ...patch },
      source: confirmed ? 'adapter' : 'last_sent',
      confidence: confirmed ? 'confirmed' : 'assumed',
      observedAt: new Date(this.deps.now()).toISOString(),
      lastCommandId: command.id,
      note,
    }
    this.deps.store.mutate((data) => {
      const current = data.devices.find((item) => item.id === device.id)
      if (current) current.state = state
    })
    this.deps.hub.publish({ type: 'state', deviceId: device.id, state })
  }

  private finish(
    command: CommandRecord,
    status: 'failed' | 'outcome_unknown',
    error: { code: string; message: string },
  ): void {
    if (command.phase === 'done') return
    command.status = status
    command.phase = 'done'
    command.error = error
    this.touch(command)
    this.deps.hub.publish({ type: 'command', command })
    if (error.code !== 'coalesced' && error.code !== 'cancelled') this.deps.onTerminal?.(command)
    this.finishWork()
  }

  private touch(command: CommandRecord): void {
    this.deps.store.mutate((data) => {
      const index = data.commands.findIndex((item) => item.id === command.id)
      if (index >= 0) data.commands[index] = command
    })
  }

  private finishWork(): void {
    this.work = Math.max(0, this.work - 1)
    if (this.work === 0) {
      const waiters = this.waiters.splice(0)
      for (const waiter of waiters) waiter()
    }
  }
}
