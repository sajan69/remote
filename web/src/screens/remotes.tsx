import { useEffect, useRef, useState } from 'react'
import type { Capability, DeviceRecord } from '@remote/protocol'
import { findCapability } from '@remote/protocol'
import { api } from '../api.ts'
import { Header, HoldButton, PowerControls, StatusLine, commandText } from '../components.tsx'
import { go, useRoute } from '../router.ts'
import { useGateway } from '../state.tsx'

const PAD = ['up', 'left', 'ok', 'right', 'down'] as const

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
      <main className="stack">
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
    <main className="stack loose">
      <Header title={device.name} back />
      {device.simulated ? <div className="banner">Demo preview. Nothing on this screen contacts an appliance.</div> : null}
      <StatusLine state={device.state} online={gateway.online} ready={gateway.controlsReady} />
      {gateway.notice ? <p className="note">{gateway.notice}</p> : null}
      <p className="small muted">{device.state.note}</p>
      <p className="live" role="status" aria-live="polite">
        {commandText(gateway.lastCommand?.deviceId === device.id ? gateway.lastCommand : null)}
      </p>
      <div className="spread">
        <p className="small muted">{device.room}</p>
        <PowerControls deviceCapabilities={device.capabilities} state={device.state} disabled={disabled} onFire={(capability) => send(capability)} />
      </div>
      {layout === 'tv' ? <TvLayout device={device} disabled={disabled} send={send} /> : null}
      {layout === 'ac' ? <AcLayout device={device} disabled={disabled} send={send} /> : null}
      {layout === 'simple' ? <SimpleLayout device={device} disabled={disabled} send={send} /> : null}
      <DeviceDetails
        device={device}
        onSaved={(next) => gateway.replaceDevices(gateway.devices.map((item) => (item.id === next.id ? next : item)), gateway.demoEnabled)}
      />
      <div className="row">
        <button type="button" onClick={() => void api.refreshOne(device.id).then((result) => gateway.replaceDevices(gateway.devices.map((item) => (item.id === device.id ? result.device : item)), gateway.demoEnabled))}>
          Refresh state
        </button>
        {device.learnSupported ? (
          <a className="icon-button" href={`#/learn/${device.id}`}>
            Learn
          </a>
        ) : null}
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (!window.confirm('Remove this remote from the app? The Home Assistant entity and the appliance stay as they are.')) return
            void api.removeDevice(device.id).then(() => go('#/'))
          }}
        >
          Remove
        </button>
      </div>
    </main>
  )
}

function TvLayout({
  device,
  disabled,
  send,
}: {
  device: DeviceRecord
  disabled: boolean
  send: (capability: string, args?: Record<string, unknown>) => Promise<void>
}) {
  useEffect(() => {
    const map: Record<string, string> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Enter: 'ok',
      Backspace: 'back',
      m: 'mute',
      '+': 'volume_up',
      '=': 'volume_up',
      '-': 'volume_down',
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      const capability = map[event.key]
      if (!capability || event.repeat || !findCapability(device.capabilities, capability)) return
      event.preventDefault()
      void send(capability, capability === 'mute' ? { value: device.state.values.muted !== true } : undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [device.capabilities, device.state.values.muted, send])

  const input = findCapability(device.capabilities, 'input')
  const digits = device.capabilities.filter((capability) => /^digit_\d$/.test(capability.id))
  return (
    <div className="stack">
      <div className="row">
        {input?.enumValues ? (
          <label className="field">
            Input
            <select
              disabled={disabled}
              value={typeof device.state.values.input === 'string' ? device.state.values.input : ''}
              onChange={(event) => void send('input', { value: event.target.value })}
            >
              <option value="" disabled>
                Choose
              </option>
              {input.enumValues.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        ) : null}
        <Slot id="mute" device={device} disabled={disabled} send={send} args={{ value: device.state.values.muted !== true }} />
      </div>
      <div className="tv">
        <div className="side">
          <Slot id="volume_up" device={device} disabled={disabled} send={send} label="Vol +" />
          <Slot id="volume_down" device={device} disabled={disabled} send={send} label="Vol −" />
        </div>
        <div className="pad">
          {PAD.map((id) => (
            <div key={id} className={id}>
              <Slot id={id} device={device} disabled={disabled} send={send} />
            </div>
          ))}
        </div>
        <div className="side">
          <Slot id="channel_up" device={device} disabled={disabled} send={send} label="Ch +" />
          <Slot id="channel_down" device={device} disabled={disabled} send={send} label="Ch −" />
        </div>
      </div>
      <div className="keys">
        {['back', 'home', 'menu', 'play', 'pause', 'stop', 'previous', 'next'].map((id) => (
          <Slot key={id} id={id} device={device} disabled={disabled} send={send} hideIfMissing={id !== 'back' && id !== 'home' && id !== 'menu'} />
        ))}
      </div>
      {digits.length > 0 ? (
        <details>
          <summary>Number keys</summary>
          <div className="keys">
            {digits.map((capability) => (
              <Slot key={capability.id} id={capability.id} device={device} disabled={disabled} send={send} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function AcLayout({
  device,
  disabled,
  send,
}: {
  device: DeviceRecord
  disabled: boolean
  send: (capability: string, args?: Record<string, unknown>) => Promise<void>
}) {
  const settings = findCapability(device.capabilities, 'climate.set')
  const temperature = settings?.stateFields?.find((field) => field.id === 'temperature')
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...device.state.values }))
  const draftRef = useRef(draft)
  const timer = useRef<number | null>(null)
  const current = typeof device.state.values.temperature === 'number' ? device.state.values.temperature : null
  const shown = typeof draft.temperature === 'number' ? draft.temperature : current

  function queue(patch: Record<string, unknown>) {
    const next = { ...complete(settings, draftRef.current), ...patch }
    draftRef.current = next
    setDraft(next)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void send('climate.set', next)
    }, 200)
  }

  const room = device.state.values.roomTemperature
  return (
    <div className="stack">
      <p className="setpoint">{shown ?? '—'}</p>
      <p className="small muted center">
        {device.state.confidence === 'confirmed' ? 'Setpoint confirmed' : 'Last sent settings, not confirmed'}
        {typeof room === 'number' ? ` · Room sensor ${room}°` : ''}
      </p>
      <div className="grid-2">
        <button
          type="button"
          disabled={disabled || !temperature}
          onClick={() => queue({ temperature: step(readTemperature(draftRef.current, shown, temperature), -(temperature?.step ?? 1), temperature) })}
        >
          Cooler
        </button>
        <button
          type="button"
          disabled={disabled || !temperature}
          onClick={() => queue({ temperature: step(readTemperature(draftRef.current, shown, temperature), temperature?.step ?? 1, temperature) })}
        >
          Warmer
        </button>
      </div>
      <Choices field="mode" title="Mode" settings={settings} draft={draft} disabled={disabled} queue={queue} />
      <Choices field="fan" title="Fan" settings={settings} draft={draft} disabled={disabled} queue={queue} />
      <Choices field="swing" title="Swing" settings={settings} draft={draft} disabled={disabled} queue={queue} />
    </div>
  )
}

function SimpleLayout({
  device,
  disabled,
  send,
}: {
  device: DeviceRecord
  disabled: boolean
  send: (capability: string, args?: Record<string, unknown>) => Promise<void>
}) {
  const extras = device.capabilities.filter((capability) => !capability.id.startsWith('power_'))
  return (
    <div className="stack">
      {extras.map((capability) => {
        if (capability.kind === 'range' && capability.range) {
          const key =
            capability.id === 'fan.speed'
              ? 'percentage'
              : capability.id === 'light.brightness'
                ? 'brightness'
                : capability.id === 'light.color_temp'
                  ? 'colorTemp'
                  : capability.id === 'volume'
                    ? 'volume'
                    : 'value'
          const current = typeof device.state.values[key] === 'number' ? device.state.values[key] : capability.range.min
          return (
            <div key={capability.id} className="grid-2">
              <button type="button" disabled={disabled} onClick={() => void send(capability.id, { value: Math.max(capability.range?.min ?? 0, Number(current) - (capability.range?.step ?? 1)) })}>
                {capability.label} down
              </button>
              <button type="button" disabled={disabled} onClick={() => void send(capability.id, { value: Math.min(capability.range?.max ?? 100, Number(current) + (capability.range?.step ?? 1)) })}>
                {capability.label} up
              </button>
            </div>
          )
        }
        if (capability.kind === 'toggle') {
          const current =
            capability.id === 'fan.oscillate' ? device.state.values.oscillating === true : device.state.values.muted === true
          return (
            <button key={capability.id} type="button" disabled={disabled} onClick={() => void send(capability.id, { value: !current })}>
              {capability.label}
            </button>
          )
        }
        if (capability.kind === 'enum' && capability.enumValues) {
          return (
            <label key={capability.id} className="field">
              {capability.label}
              <select disabled={disabled} onChange={(event) => void send(capability.id, { value: event.target.value })} defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {capability.enumValues.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )
        }
        return <Slot key={capability.id} id={capability.id} device={device} disabled={disabled} send={send} />
      })}
    </div>
  )
}

function Slot({
  id,
  device,
  disabled,
  send,
  label,
  args,
  hideIfMissing = false,
}: {
  id: string
  device: DeviceRecord
  disabled: boolean
  send: (capability: string, args?: Record<string, unknown>) => Promise<void>
  label?: string
  args?: Record<string, unknown>
  hideIfMissing?: boolean
}) {
  const capability = device.capabilities.find((item) => item.id === id)
  if (!capability && hideIfMissing) return null
  return (
    <HoldButton
      label={label ?? capability?.label ?? id}
      disabled={disabled || !capability?.available}
      reason={capability ? capability.unavailableReason : 'This device does not advertise this control.'}
      repeat={capability?.repeat}
      onFire={(isRepeat) => send(id, { ...args, ...(isRepeat ? { repeat: true } : {}) })}
    />
  )
}

function Choices({
  field,
  title,
  settings,
  draft,
  disabled,
  queue,
}: {
  field: string
  title: string
  settings: Capability | undefined
  draft: Record<string, unknown>
  disabled: boolean
  queue: (patch: Record<string, unknown>) => void
}) {
  const spec = settings?.stateFields?.find((item) => item.id === field)
  if (!spec?.values) return null
  return (
    <div className="stack">
      <h2>{title}</h2>
      <div className="chips">
        {spec.values.map((value) => (
          <button key={value} type="button" disabled={disabled} aria-pressed={draft[field] === value} onClick={() => queue({ [field]: value })}>
            {value}
          </button>
        ))}
      </div>
    </div>
  )
}

function DeviceDetails({ device, onSaved }: { device: DeviceRecord; onSaved: (device: DeviceRecord) => void }) {
  const [name, setName] = useState(device.name)
  const [room, setRoom] = useState(device.room)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setName(device.name)
    setRoom(device.room)
  }, [device.name, device.room])
  return (
    <details className="note">
      <summary>Name and room</summary>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          void api
            .patchDevice(device.id, { name, room })
            .then((result) => {
              onSaved(result.device)
              setMessage('Saved.')
            })
            .catch(() => setMessage('The name was not saved.'))
        }}
      >
        <label className="field">
          Name
          <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          Room
          <input value={room} maxLength={40} onChange={(event) => setRoom(event.target.value)} />
        </label>
        <button type="submit">Save name and room</button>
        {message ? <p className="small" role="status">{message}</p> : null}
      </form>
    </details>
  )
}

function readTemperature(
  draft: Record<string, unknown>,
  shown: number | null,
  field: { min?: number } | undefined,
): number {
  return typeof draft.temperature === 'number' ? draft.temperature : (shown ?? field?.min ?? 16)
}

function complete(settings: Capability | undefined, draft: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const field of settings?.stateFields ?? []) {
    if (draft[field.id] !== undefined) next[field.id] = draft[field.id]
    else if (field.kind === 'boolean') next[field.id] = true
    else if (field.kind === 'number') next[field.id] = field.min ?? 0
    else next[field.id] = field.values?.[0]
  }
  return next
}

function step(value: number, delta: number, field: { min?: number; max?: number } | undefined): number {
  const next = value + delta
  return Math.min(field?.max ?? next, Math.max(field?.min ?? next, next))
}
