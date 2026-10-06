import { emptyState, type DeviceRecord } from '@remote/protocol'
import { demoCatalog } from '../adapters/demo.ts'
import { describeEntity, presentState, type DiscoveryEntity, type HaEntity } from '../adapters/ha-map.ts'
import type { HomeAssistant } from '../adapters/ha.ts'
import type { AppConfig } from '../config.ts'
import { HttpError } from '../errors.ts'
import type { Hub } from '../hub.ts'
import { mergeCapabilities } from '../profiles.ts'
import type { Store } from '../store.ts'
import { recordDiagnostic } from './diagnostics.ts'

export async function refreshDiscovery(store: Store, ha: HomeAssistant): Promise<DiscoveryEntity[]> {
  const entities: DiscoveryEntity[] = []
  if (ha.current()) entities.push(...(await ha.getStates()).map(describeEntity).filter((item): item is DiscoveryEntity => item !== null))
  else if (!store.data.demoEnabled) {
    throw new HttpError(503, 'gateway_unreachable', 'Home Assistant is not configured on the gateway.')
  }
  if (store.data.demoEnabled) entities.push(...demoCatalog())
  store.mutate((data) => {
    data.discovery = entities
    data.discoveryAt = new Date().toISOString()
  })
  return entities
}

export async function refreshAll(store: Store, ha: HomeAssistant, hub: Hub): Promise<void> {
  const linked = store.data.devices.filter((device) => device.adapterId === 'home_assistant')
  if (linked.length === 0) return
  if (!ha.current()) throw new HttpError(503, 'gateway_unreachable', 'Home Assistant is not configured on the gateway.')
  for (const device of linked) await refreshOne(store, ha, device)
  hub.publish({ type: 'devices' })
}

export async function refreshOne(store: Store, ha: HomeAssistant, device: DeviceRecord): Promise<void> {
  if (device.simulated) return
  let entity: HaEntity | null
  try {
    entity = await ha.getState(device.connectionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Home Assistant did not refresh this device.'
    recordDiagnostic(store, 'gateway_unreachable', message, device.id)
    throw new HttpError(503, 'gateway_unreachable', message)
  }
  store.mutate((data) => {
    const current = data.devices.find((item) => item.id === device.id)
    if (!current) return
    if (!entity) {
      current.state = emptyState('This entity is no longer available in Home Assistant.')
      current.capabilities = current.capabilities.map((capability) => ({
        ...capability,
        available: false,
        unavailableReason: 'The Home Assistant entity is unavailable.',
      }))
      return
    }
    const described = describeEntity(entity)
    if (!described) return
    const profile = current.profileId ? data.profiles.find((item) => item.id === current.profileId) ?? null : null
    current.capabilities = mergeCapabilities(described.capabilities, profile, current.confirmation)
    current.learnSupported = described.learnSupported
    const next = presentState(described.state.values, current.confirmation, described.state.observedAt)
    next.lastCommandId = current.state.lastCommandId
    current.state = next
    device.state = next
    device.capabilities = current.capabilities
  })
}

export function applyHaState(store: Store, hub: Hub, entity: HaEntity): void {
  const described = describeEntity(entity)
  if (!described) return
  const updates: Array<{ id: string; state: DeviceRecord['state'] }> = []
  store.mutate((data) => {
    for (const device of data.devices) {
      if (device.adapterId !== 'home_assistant' || device.connectionId !== entity.entity_id) continue
      const next = presentState(described.state.values, device.confirmation, described.state.observedAt)
      next.lastCommandId = device.state.lastCommandId
      if (JSON.stringify(device.state.values) === JSON.stringify(next.values) && device.state.confidence === next.confidence) {
        continue
      }
      device.state = next
      updates.push({ id: device.id, state: next })
    }
    const index = data.discovery.findIndex((item) => item.connectionId === entity.entity_id)
    if (index >= 0) data.discovery[index] = described
  })
  for (const update of updates) hub.publish({ type: 'state', deviceId: update.id, state: update.state })
}

export function statusBody(config: AppConfig, store: Store, ha: HomeAssistant) {
  const current = ha.current()
  return {
    version: config.version,
    demoEnabled: store.data.demoEnabled,
    homeAssistant: current
      ? { configured: true, baseUrl: current.baseUrl, reachable: ha.status.reachable, message: ha.status.message }
      : { configured: false, baseUrl: null, reachable: false, message: ha.status.message },
    irRaw: { configured: Boolean(config.irRaw) },
    sessions: store.data.sessions.length,
  }
}
