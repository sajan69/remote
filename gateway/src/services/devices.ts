import crypto from 'node:crypto'
import { emptyState, labelFor, repeatFor, type Capability, type CommandRecord, type DeviceRecord } from '@remote/protocol'
import { presentState, type DiscoveryEntity } from '../adapters/ha-map.ts'
import type { CommandService } from '../commands.ts'
import { HttpError } from '../errors.ts'
import { mergeCapabilities } from '../profiles.ts'
import type { Store } from '../store.ts'
import { isRecord } from '../http/request.ts'

export const DISCOVERY_MS = 10 * 60 * 1000

export function trial(store: Store, commands: CommandService, body: unknown): { command: CommandRecord } {
  if (!freshDiscovery(store)) {
    throw new HttpError(409, 'model_mismatch', 'Discover devices again before sending a test.')
  }
  const record = isRecord(body) ? body : {}
  const connectionId = typeof record.connectionId === 'string' ? record.connectionId : ''
  const entity = store.data.discovery.find((item) => item.connectionId === connectionId)
  if (!entity) throw new HttpError(404, 'not_found', 'That device is not in the latest discovery.')
  const device = materialize(entity, {
    id: `trial:${connectionId}`,
    name: entity.name,
    room: 'Test',
    category: entity.suggestedCategory,
    confirmation: entity.confirmation,
    favorite: false,
  })
  const command = commands.submit({
    device: withPendingCapability(store, device, typeof record.capability === 'string' ? record.capability : ''),
    id: readId(record.id),
    capability: typeof record.capability === 'string' ? record.capability : '',
    arguments: isRecord(record.arguments) ? record.arguments : {},
    sequence:
      typeof record.sequence === 'number'
        ? record.sequence
        : (store.data.trialSequences[connectionId] ?? 0) + 1,
    trial: { adapterId: entity.simulated ? 'demo' : 'home_assistant', connectionId, category: entity.suggestedCategory },
  })
  return { command }
}

export function createDevice(store: Store, body: unknown): DeviceRecord {
  const record = isRecord(body) ? body : {}
  const connectionId = typeof record.connectionId === 'string' ? record.connectionId : ''
  if (!freshDiscovery(store)) throw new HttpError(409, 'model_mismatch', 'Discover devices again before saving.')
  const entity = store.data.discovery.find((item) => item.connectionId === connectionId)
  if (!entity) throw new HttpError(404, 'not_found', 'That device is not in the latest discovery.')
  if (!entity.allowedCategories.includes(readCategory(record.category, entity))) {
    throw new HttpError(400, 'model_mismatch', 'That category does not match this integration.')
  }
  const category = readCategory(record.category, entity)
  const confirmation = record.confirmation === 'state' ? 'state' : 'transmission_only'
  if (confirmation === 'state' && entity.confirmation === 'transmission_only' && record.acknowledgeMeasuredState !== true) {
    throw new HttpError(
      400,
      'confirmation_required',
      'This integration is treated as one-way unless you confirm the appliance itself reports state.',
    )
  }
  if (store.data.devices.some((device) => device.connectionId === connectionId)) {
    throw new HttpError(409, 'model_mismatch', 'That device is already in the library.')
  }
  if (entity.simulated) {
    if (record.acknowledgeDemo !== true) {
      throw new HttpError(400, 'demo_required', 'Confirm that demo devices do not control a real appliance.')
    }
  } else if (record.userConfirmed !== true) {
    throw new HttpError(400, 'confirmation_required', 'Save it only after you have seen the appliance respond.')
  }
  if (!entity.simulated) {
    const test = store.data.commands.find((item) => item.id === record.testCommandId)
    const fresh = test ? Date.now() - Date.parse(test.createdAt) < 15 * 60 * 1000 : false
    if (!test || !fresh || test.trial?.connectionId !== connectionId || !['transmitted', 'appliance_confirmed'].includes(test.status)) {
      throw new HttpError(400, 'confirmation_required', 'Run one successful test on this device before saving it.')
    }
  }
  const profile = typeof record.profileId === 'string' ? store.data.profiles.find((item) => item.id === record.profileId) ?? null : null
  if (profile && profile.category !== category) throw new HttpError(400, 'model_mismatch', 'That profile is for a different device category.')
  if (profile?.protocol === 'ha_remote' && entity.domain !== 'remote' && !entity.simulated) {
    throw new HttpError(400, 'unsupported_capability', 'Named remote commands need a Home Assistant remote entity.')
  }
  const device = materialize(entity, {
    id: crypto.randomUUID(),
    name: clip(record.name, entity.name, 40),
    room: clip(record.room, 'Home', 40),
    category,
    confirmation,
    favorite: record.favorite === true,
  })
  device.capabilities = mergeCapabilities(entity.capabilities, profile, confirmation)
  device.profileId = profile?.id ?? null
  device.profileStatus = entity.simulated ? 'experimental' : 'user_confirmed'
  device.userConfirmedAt = entity.simulated ? null : new Date().toISOString()
  device.testCommandId = typeof record.testCommandId === 'string' ? record.testCommandId : null
  device.sortIndex = store.data.devices.reduce((max, item) => Math.max(max, item.sortIndex), -1) + 1
  if (entity.simulated) {
    device.state = emptyState('Demo preview. No appliance was contacted.')
  }
  store.mutate((data) => {
    data.devices.push(device)
  })
  return device
}

export function submitSaved(store: Store, commands: CommandService, device: DeviceRecord, body: unknown): CommandRecord {
  const record = isRecord(body) ? body : {}
  const capability = typeof record.capability === 'string' ? record.capability : ''
  return commands.submit({
    device: withPendingCapability(store, device, capability),
    id: readId(record.id),
    capability,
    arguments: isRecord(record.arguments) ? record.arguments : {},
    sequence: typeof record.sequence === 'number' ? record.sequence : device.lastSequence + 1,
  })
}

export function patchDevice(store: Store, id: string, body: unknown): DeviceRecord {
  const device = requireDevice(store, id)
  const record = isRecord(body) ? body : {}
  store.mutate((data) => {
    const current = data.devices.find((item) => item.id === id)
    if (!current) return
    if (typeof record.name === 'string' && record.name.trim()) current.name = record.name.trim().slice(0, 40)
    if (typeof record.room === 'string' && record.room.trim()) current.room = record.room.trim().slice(0, 40)
    if (typeof record.favorite === 'boolean') current.favorite = record.favorite
    if (record.move === 'up' || record.move === 'down') moveDevice(data.devices, id, record.move)
  })
  return store.data.devices.find((item) => item.id === device.id) ?? device
}

export function requireDevice(store: Store, id: string): DeviceRecord {
  const device = store.data.devices.find((item) => item.id === id)
  if (!device) throw new HttpError(404, 'not_found', 'That remote is not on this gateway.')
  return device
}

export function withPendingCapability(store: Store, device: DeviceRecord, capability: string): DeviceRecord {
  if (device.capabilities.some((item) => item.id === capability && item.available)) return device
  const pending = store.data.pendingLearns.find(
    (item) => item.deviceId === device.id && item.capability === capability && Date.now() - Date.parse(item.at) < 10 * 60 * 1000,
  )
  if (!pending) return device
  const repeat = repeatFor(capability, 'resend_frame')
  const added: Capability = {
    id: capability,
    label: labelFor(capability),
    kind: 'discrete',
    confirmation: 'transmission_only',
    idempotent: false,
    available: true,
    ...(repeat ? { repeat } : {}),
  }
  return { ...device, capabilities: [...device.capabilities, added] }
}

export function materialize(
  entity: DiscoveryEntity,
  input: { id: string; name: string; room: string; category: DeviceRecord['category']; confirmation: DeviceRecord['confirmation']; favorite: boolean },
): DeviceRecord {
  const state = presentState(entity.state.values, input.confirmation, entity.state.observedAt)
  return {
    id: input.id,
    name: input.name,
    room: input.room,
    category: input.category,
    adapterId: entity.simulated ? 'demo' : 'home_assistant',
    connectionId: entity.connectionId,
    profileId: null,
    confirmation: input.confirmation,
    simulated: entity.simulated,
    favorite: input.favorite,
    sortIndex: 0,
    learnSupported: entity.learnSupported,
    profileStatus: 'untested',
    userConfirmedAt: null,
    testCommandId: null,
    capabilities: entity.capabilities.map((capability) => ({ ...capability, confirmation: input.confirmation })),
    state,
    lastSequence: 0,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  }
}

function freshDiscovery(store: Store): boolean {
  return Boolean(store.data.discoveryAt && Date.now() - Date.parse(store.data.discoveryAt) < DISCOVERY_MS)
}

function readCategory(value: unknown, entity: DiscoveryEntity): DeviceRecord['category'] {
  if (typeof value === 'string' && entity.allowedCategories.includes(value as DeviceRecord['category'])) {
    return value as DeviceRecord['category']
  }
  return entity.suggestedCategory
}

function readId(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value)) return value
  return crypto.randomUUID()
}

function clip(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) return fallback.slice(0, max)
  return value.trim().slice(0, max)
}

function moveDevice(devices: DeviceRecord[], id: string, direction: 'up' | 'down'): void {
  const ordered = devices.slice().sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name))
  const index = ordered.findIndex((device) => device.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= ordered.length) return
  const [item] = ordered.splice(index, 1)
  if (!item) return
  ordered.splice(target, 0, item)
  ordered.forEach((device, position) => {
    device.sortIndex = position
  })
}
