import crypto from 'node:crypto'
import { emptyState } from '@remote/protocol'
import { demoCatalog } from '../adapters/demo.ts'
import type { Hub } from '../hub.ts'
import type { Store } from '../store.ts'
import { materialize } from './devices.ts'

export function setDemo(store: Store, hub: Hub, enabled: boolean): void {
  store.mutate((data) => {
    data.demoEnabled = enabled
    if (enabled) {
      for (const entity of demoCatalog()) {
        if (data.devices.some((device) => device.connectionId === entity.connectionId)) continue
        const device = materialize(entity, {
          id: crypto.randomUUID(),
          name: entity.name,
          room: 'Preview',
          category: entity.suggestedCategory,
          confirmation: 'transmission_only',
          favorite: false,
        })
        device.sortIndex = data.devices.reduce((max, item) => Math.max(max, item.sortIndex), -1) + 1
        device.profileStatus = 'experimental'
        device.state = emptyState('Demo preview. No appliance was contacted.')
        data.devices.push(device)
      }
      data.discovery = [...data.discovery.filter((item) => !item.simulated), ...demoCatalog()]
      data.discoveryAt = new Date().toISOString()
    } else {
      data.devices = data.devices.filter((device) => !device.simulated)
      data.discovery = data.discovery.filter((item) => !item.simulated)
    }
  })
  hub.publish({ type: 'demo', enabled })
  hub.publish({ type: 'devices' })
}
