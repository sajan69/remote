import { encodeAcStateV1, encodeNec, encodeNecRepeat, type CommandRecord, type DeviceRecord, type Profile } from '@remote/protocol'
import type { AppConfig } from '../config.ts'
import type { ExecuteResult } from '../commands.ts'
import { AdapterError } from '../errors.ts'
import type { Store } from '../store.ts'
import { demoResult } from './demo.ts'
import { describeEntity, type HaEntity } from './ha-map.ts'
import type { HomeAssistant } from './ha.ts'

const HA_DOMAINS = new Set(['media_player', 'climate', 'fan', 'light', 'remote'])

export async function executeDevice(
  store: Store,
  ha: HomeAssistant,
  irRaw: AppConfig['irRaw'],
  device: DeviceRecord,
  command: CommandRecord,
): Promise<ExecuteResult> {
  try {
    if (device.adapterId === 'demo' || device.simulated) {
      if (!store.data.demoEnabled) {
        return failed('unsupported_capability', 'Demo mode is off, so this preview control was not run.')
      }
      return demoResult(device, command)
    }
    assertAllowed(store, device)
    const profile = device.profileId ? store.data.profiles.find((item) => item.id === device.profileId) ?? null : null
    const profileCommand = profile?.commands[command.capability]
    const timeout = Math.max(50, Date.parse(command.expiresAt) - Date.now())
    if (profile?.protocol === 'ac_state_v1' && command.capability === 'climate.set' && profile.ac) {
      return transmitRaw(ha, irRaw, encodeAc(command, profile), timeout)
    }
    if (profileCommand?.type === 'nec') {
      try {
        const timings =
          command.arguments.repeat === true ? encodeNecRepeat() : encodeNec(profileCommand.address, profileCommand.command)
        return await transmitRaw(ha, irRaw, { timingsUs: timings, carrierHz: 38000 }, timeout)
      } catch (error) {
        if (error instanceof AdapterError) throw error
        const message = error instanceof Error ? error.message : 'The infrared frame was rejected.'
        throw new AdapterError(message, 'invalid_command', false)
      }
    }
    if (profileCommand?.type === 'raw') {
      return transmitRaw(
        ha,
        irRaw,
        { timingsUs: profileCommand.timingsUs, carrierHz: profileCommand.carrierHz },
        timeout,
      )
    }
    if (profileCommand?.type === 'ha_remote') {
      const domain = domainOf(device.connectionId)
      if (domain !== 'remote') {
        return failed('unsupported_capability', 'Named infrared commands require a Home Assistant remote entity.')
      }
      const data: Record<string, unknown> = {
        entity_id: device.connectionId,
        command: profileCommand.command,
      }
      if (profileCommand.device) data.device = profileCommand.device
      const body = await ha.callService('remote', 'send_command', data, timeout)
      return transmitted(device, body, absolutePatch(command))
    }
    return standardCall(ha, device, command, timeout)
  } catch (error) {
    if (error instanceof AdapterError) {
      return {
        kind: error.ambiguous ? 'unknown' : 'failed',
        code: error.code,
        message: error.message,
      }
    }
    throw error
  }
}

async function standardCall(
  ha: HomeAssistant,
  device: DeviceRecord,
  command: CommandRecord,
  timeout: number,
): Promise<ExecuteResult> {
  const domain = domainOf(device.connectionId)
  if (!HA_DOMAINS.has(domain)) {
    return failed('unsupported_capability', 'This gateway does not send commands for that integration domain.')
  }
  const entityId = device.connectionId
  const args = command.arguments
  if (command.capability === 'climate.set') {
    return sendClimate(ha, entityId, args, timeout, device)
  }
  const call = serviceCall(domain, command.capability, entityId, args)
  if (!call) return failed('unsupported_capability', 'This control has no command on the connected integration.')
  const body = await ha.callService(call.domain, call.service, call.data, timeout)
  return transmitted(device, body, call.patch)
}

async function sendClimate(
  ha: HomeAssistant,
  entityId: string,
  args: Record<string, unknown>,
  timeout: number,
  device: DeviceRecord,
): Promise<ExecuteResult> {
  const sent: Record<string, unknown> = {}
  let sawEcho = false
  const track = async (domain: string, service: string, data: Record<string, unknown>, patch: Record<string, unknown>) => {
    const body = await ha.callService(domain, service, data, timeout)
    Object.assign(sent, patch)
    if (responseIncludes(entityId, body)) sawEcho = true
  }
  try {
    if (args.power === false) {
      await track('climate', 'turn_off', { entity_id: entityId }, { power: false })
      return { kind: 'transmitted', statePatch: sent, confirmed: sawEcho && device.confirmation === 'state' }
    }
    if (args.power === true) await track('climate', 'turn_on', { entity_id: entityId }, { power: true })
    const temperature: Record<string, unknown> = { entity_id: entityId }
    const patch: Record<string, unknown> = {}
    if (typeof args.temperature === 'number') {
      temperature.temperature = args.temperature
      patch.temperature = args.temperature
    }
    if (typeof args.mode === 'string') {
      temperature.hvac_mode = args.mode
      patch.mode = args.mode
    }
    if (Object.keys(temperature).length > 1) await track('climate', 'set_temperature', temperature, patch)
    if (typeof args.fan === 'string') {
      await track('climate', 'set_fan_mode', { entity_id: entityId, fan_mode: args.fan }, { fan: args.fan })
    }
    if (typeof args.swing === 'string') {
      await track('climate', 'set_swing_mode', { entity_id: entityId, swing_mode: args.swing }, { swing: args.swing })
    }
    return { kind: 'transmitted', statePatch: sent, confirmed: sawEcho && device.confirmation === 'state' }
  } catch (error) {
    if (Object.keys(sent).length > 0) {
      return {
        kind: 'unknown',
        code: 'outcome_unknown',
        message: 'Only part of the air-conditioner settings may have been sent. Check the unit before trying again. Nothing was retried.',
      }
    }
    throw error
  }
}

function serviceCall(
  domain: string,
  capability: string,
  entityId: string,
  args: Record<string, unknown>,
): { domain: string; service: string; data: Record<string, unknown>; patch: Record<string, unknown> } | null {
  const base = { entity_id: entityId }
  const table: Record<string, { service: string; data?: Record<string, unknown>; patch?: Record<string, unknown> }> = {
    power_on: { service: 'turn_on', patch: { power: true } },
    power_off: { service: 'turn_off', patch: { power: false } },
    volume_up: { service: 'volume_up' },
    volume_down: { service: 'volume_down' },
    play: { service: 'media_play' },
    pause: { service: 'media_pause' },
    stop: { service: 'media_stop' },
    next: { service: 'media_next_track' },
    previous: { service: 'media_previous_track' },
  }
  if (capability === 'mute' && domain === 'media_player') {
    return {
      domain,
      service: 'volume_mute',
      data: { ...base, is_volume_muted: args.value === true },
      patch: { muted: args.value === true },
    }
  }
  if (capability === 'volume' && domain === 'media_player' && typeof args.value === 'number') {
    return {
      domain,
      service: 'volume_set',
      data: { ...base, volume_level: args.value / 100 },
      patch: { volume: args.value },
    }
  }
  if (capability === 'input' && domain === 'media_player' && typeof args.value === 'string') {
    return { domain, service: 'select_source', data: { ...base, source: args.value }, patch: { input: args.value } }
  }
  if (capability === 'fan.speed' && typeof args.value === 'number') {
    return { domain: 'fan', service: 'set_percentage', data: { ...base, percentage: args.value }, patch: { percentage: args.value } }
  }
  if (capability === 'fan.oscillate') {
    return {
      domain: 'fan',
      service: 'oscillate',
      data: { ...base, oscillating: args.value === true },
      patch: { oscillating: args.value === true },
    }
  }
  if (capability === 'light.brightness' && typeof args.value === 'number') {
    return {
      domain: 'light',
      service: 'turn_on',
      data: { ...base, brightness_pct: args.value },
      patch: { brightness: args.value, power: true },
    }
  }
  if (capability === 'light.color_temp' && typeof args.value === 'number') {
    return {
      domain: 'light',
      service: 'turn_on',
      data: { ...base, color_temp_kelvin: args.value },
      patch: { colorTemp: args.value },
    }
  }
  if (capability === 'activity' && typeof args.value === 'string') {
    return { domain: 'remote', service: 'turn_on', data: { ...base, activity: args.value }, patch: { input: args.value } }
  }
  const mapped = table[capability]
  if (!mapped || (capability.startsWith('media_') && domain !== 'media_player')) return null
  if (['volume_up', 'volume_down', 'play', 'pause', 'stop', 'next', 'previous'].includes(capability) && domain !== 'media_player') {
    return null
  }
  return { domain, service: mapped.service, data: { ...base, ...mapped.data }, patch: mapped.patch ?? {} }
}

async function transmitRaw(
  ha: HomeAssistant,
  irRaw: AppConfig['irRaw'],
  frame: { timingsUs: number[]; carrierHz: number },
  timeout: number,
): Promise<ExecuteResult> {
  if (!irRaw) {
    return failed(
      'unsupported_capability',
      'The infrared frame is valid, but the gateway has no raw transmit service configured.',
    )
  }
  await ha.callService(
    irRaw.domain,
    irRaw.service,
    { entity_id: irRaw.entityId, timings: frame.timingsUs, carrier_frequency: frame.carrierHz },
    timeout,
  )
  return { kind: 'transmitted', confirmed: false }
}

function encodeAc(command: CommandRecord, profile: Profile): { timingsUs: number[]; carrierHz: number } {
  if (!profile.ac) throw new AdapterError('The air-conditioner profile has no limits.', 'unsupported_capability', false)
  const args = command.arguments
  try {
    const frame = encodeAcStateV1(
      {
        power: args.power === true,
        mode: String(args.mode),
        celsius: Number(args.temperature),
        fan: String(args.fan),
        swing: String(args.swing),
      },
      profile.ac,
    )
    return { timingsUs: frame.timingsUs, carrierHz: frame.carrierHz }
  } catch (error) {
    if (error instanceof AdapterError) throw error
    const message = error instanceof Error ? error.message : 'The air-conditioner frame was rejected.'
    throw new AdapterError(message, 'invalid_command', false)
  }
}

function transmitted(device: DeviceRecord, body: unknown, patch: Record<string, unknown>): ExecuteResult {
  const echoed = echoedEntity(device.connectionId, body)
  const described = echoed ? describeEntity(echoed) : null
  const statePatch = described ? described.state.values : patch
  const confirmed = Boolean(described) && device.confirmation === 'state' && !device.simulated
  return { kind: 'transmitted', statePatch, confirmed }
}

function echoedEntity(entityId: string, body: unknown): HaEntity | null {
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.changed_states)
      ? body.changed_states
      : []
  const found = list.find((item) => isRecord(item) && item.entity_id === entityId)
  if (!found || !isRecord(found) || typeof found.state !== 'string') return null
  const attributes = isRecord(found.attributes) ? found.attributes : {}
  return { entity_id: entityId, state: found.state, attributes }
}

function responseIncludes(entityId: string, body: unknown): boolean {
  return echoedEntity(entityId, body) !== null
}

function absolutePatch(command: CommandRecord): Record<string, unknown> {
  return command.capability === 'input' && typeof command.arguments.value === 'string'
    ? { input: command.arguments.value }
    : {}
}

function assertAllowed(store: Store, device: DeviceRecord): void {
  const known =
    store.data.devices.some((item) => item.id === device.id && item.connectionId === device.connectionId) ||
    store.data.discovery.some((item) => item.connectionId === device.connectionId)
  if (!known) {
    throw new AdapterError('That device is not in the gateway allowlist.', 'permission_denied', false)
  }
}

function domainOf(entityId: string): string {
  return entityId.split('.')[0] ?? ''
}

function failed(code: string, message: string): ExecuteResult {
  return { kind: 'failed', code, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
