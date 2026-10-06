import { useEffect } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { api } from '../../api.ts'
import { DemoBanner, Header, PowerControls, StatusLine, commandText } from '../../components.tsx'
import { go, useRoute } from '../../router.ts'
import { useGateway } from '../../state.tsx'
import { AcLayout } from './ac-layout.tsx'
import { DeviceDetails } from './device-details.tsx'
import { SimpleLayout } from './simple-layout.tsx'
import { TvLayout } from './tv-layout.tsx'

export default function RemoteScreen() {
  const route = useRoute()
  const gateway = useGateway()
  const id = route.name === 'remote' ? route.id : ''
  const device = gateway.devices.find((item) => item.id === id)
  const remember = gateway.remember
  useEffect(() => {
    if (id) remember(id)
  }, [id, remember])

  if (!device) {
    return (
      <main className="grid gap-4">
        <Header title="Remote" back />
        <p>That remote is not in the library.</p>
      </main>
    )
  }

  const disabled = !gateway.controlsReady || !gateway.online
  const send = (capability: string, args?: Record<string, unknown>) =>
    gateway.sendCommand(device, capability, args).then(() => undefined)
  const layout = device.category === 'ac' ? 'ac' : device.category === 'tv' || device.category === 'set_top_box' ? 'tv' : 'simple'

  return (
    <main className="grid gap-5">
      <Header title={device.name} back />
      {device.simulated ? <DemoBanner>Demo preview. Nothing on this screen contacts an appliance.</DemoBanner> : null}
      <StatusLine state={device.state} online={gateway.online} ready={gateway.controlsReady} />
      {gateway.notice ? <p className="rounded-2xl border bg-card p-4 text-sm">{gateway.notice}</p> : null}
      <p className="text-sm text-muted-foreground">{device.state.note}</p>
      <p className="min-h-6 text-sm" role="status" aria-live="polite">
        {commandText(gateway.lastCommand?.deviceId === device.id ? gateway.lastCommand : null)}
      </p>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{device.room}</p>
        <PowerControls deviceCapabilities={device.capabilities} state={device.state} disabled={disabled} onFire={(capability) => send(capability)} />
      </div>
      {layout === 'tv' ? <TvLayout device={device} disabled={disabled} send={send} /> : null}
      {layout === 'ac' ? <AcLayout device={device} disabled={disabled} send={send} /> : null}
      {layout === 'simple' ? <SimpleLayout device={device} disabled={disabled} send={send} /> : null}
      <DeviceDetails
        device={device}
        onSaved={(next) => gateway.replaceDevices(gateway.devices.map((item) => (item.id === next.id ? next : item)), gateway.demoEnabled)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void api.refreshOne(device.id).then((result) => gateway.replaceDevices(gateway.devices.map((item) => (item.id === device.id ? result.device : item)), gateway.demoEnabled))}>
          <RefreshCw />
          Refresh state
        </Button>
        {device.learnSupported ? (
          <Button variant="outline" asChild>
            <a href={`#/learn/${device.id}`}>Learn</a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            if (!window.confirm('Remove this remote from the app? The Home Assistant entity and the appliance stay as they are.')) return
            void api.removeDevice(device.id).then(() => go('#/'))
          }}
        >
          <Trash2 />
          Remove
        </Button>
      </div>
    </main>
  )
}
