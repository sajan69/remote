import type { Category, DeviceRecord } from '@remote/protocol'
import { api } from '../api.ts'
import { Header, confidenceLabel } from '../components.tsx'
import { useGateway } from '../state.tsx'

const LABELS: Record<Category, string> = {
  tv: 'Television',
  ac: 'Air conditioner',
  fan: 'Fan',
  soundbar: 'Soundbar',
  projector: 'Projector',
  set_top_box: 'Set-top box',
  light: 'Light',
  generic: 'Other',
}

export function Library() {
  const gateway = useGateway()
  const last = gateway.devices.find((device) => device.id === gateway.prefs.lastDeviceId) ?? gateway.devices[0]
  const rest = gateway.devices.filter((device) => device.id !== last?.id)
  const ordered = [...rest].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.sortIndex - b.sortIndex)

  return (
    <main className="stack loose">
      <Header title="Remote" />
      {gateway.demoEnabled ? (
        <div className="banner" role="status">
          Demo devices are in this library. They do not control a real appliance.
        </div>
      ) : null}
      {gateway.notice ? <p className="note">{gateway.notice}</p> : null}
      {gateway.devices.length === 0 ? (
        <section className="stack">
          <h2>No remotes yet</h2>
          <p className="muted">Add one when the gateway can see it, or open a labelled preview if you only want to try the layout.</p>
          <a className="hero" href="#/setup">
            <strong>Add a device</strong>
            <span className="muted">The phone does not scan the room by itself.</span>
          </a>
        </section>
      ) : (
        <section className="stack">
          {last ? <DeviceLink device={last} hero /> : null}
          {ordered.map((device) => (
            <DeviceLink key={device.id} device={device} />
          ))}
          <a className="choice" href="#/setup">
            Add a device
          </a>
        </section>
      )}
    </main>
  )
}

function seen(device: DeviceRecord): string {
  if (!device.state.observedAt) return 'No reading yet'
  const date = new Date(device.state.observedAt)
  if (Number.isNaN(date.getTime())) return 'No reading yet'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function DeviceLink({ device, hero = false }: { device: DeviceRecord; hero?: boolean }) {
  return (
    <article className="stack">
      <a className={hero ? 'hero' : 'device-card'} href={`#/remote/${device.id}`}>
        <span className="small muted">{hero ? 'Continue' : device.room}</span>
        <strong>{device.name}</strong>
        <span className="small muted">
          {LABELS[device.category]} · {device.room} · {device.simulated ? 'Preview' : 'Gateway'} · {confidenceLabel(device.state)} · {seen(device)}
        </span>
      </a>
      <div className="row">
        <button type="button" onClick={() => void api.patchDevice(device.id, { move: 'up' })}>
          Move up
        </button>
        <button type="button" onClick={() => void api.patchDevice(device.id, { move: 'down' })}>
          Move down
        </button>
        <button type="button" onClick={() => void api.patchDevice(device.id, { favorite: !device.favorite })}>
          {device.favorite ? 'Unfavourite' : 'Favourite'}
        </button>
      </div>
    </article>
  )
}
