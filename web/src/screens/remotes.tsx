import { useEffect, useRef, useState } from 'react'
import type { Capability, DeviceRecord } from '@remote/protocol'
import { findCapability } from '@remote/protocol'
import { ChevronDown, ChevronUp, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Select } from '@/components/ui/select.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx'
import { api } from '../api.ts'
import { DemoBanner, Header, HoldButton, PowerControls, StatusLine, commandText } from '../components.tsx'
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
    <div className="grid gap-4">
      <div className="flex items-end gap-2">
        {input?.enumValues ? (
          <div className="grid flex-1 gap-2">
            <Label htmlFor="tv-input">Input</Label>
            <Select
              id="tv-input"
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
            </Select>
          </div>
        ) : null}
        <Slot id="mute" device={device} disabled={disabled} send={send} args={{ value: device.state.values.muted !== true }} />
      </div>
      <div className="grid grid-cols-[4.75rem_1fr_4.75rem] items-center gap-3">
        <div className="grid gap-2">
          <Slot id="volume_up" device={device} disabled={disabled} send={send} label="Vol +" icon="up" />
          <Slot id="volume_down" device={device} disabled={disabled} send={send} label="Vol −" icon="down" />
        </div>
        <div className="grid grid-cols-3 grid-rows-3 gap-2">
          {PAD.map((id) => (
            <div key={id} className={padCell(id)}>
              <Slot id={id} device={device} disabled={disabled} send={send} />
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          <Slot id="channel_up" device={device} disabled={disabled} send={send} label="Ch +" icon="up" />
          <Slot id="channel_down" device={device} disabled={disabled} send={send} label="Ch −" icon="down" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['back', 'home', 'menu', 'play', 'pause', 'stop', 'previous', 'next'].map((id) => (
          <Slot key={id} id={id} device={device} disabled={disabled} send={send} hideIfMissing={id !== 'back' && id !== 'home' && id !== 'menu'} />
        ))}
      </div>
      {digits.length > 0 ? (
        <details className="rounded-2xl border bg-card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Number keys</summary>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {digits.map((capability) => (
              <Slot key={capability.id} id={capability.id} device={device} disabled={disabled} send={send} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function padCell(id: (typeof PAD)[number]): string {
  if (id === 'up') return 'col-start-2 row-start-1'
  if (id === 'left') return 'col-start-1 row-start-2'
  if (id === 'ok') return 'col-start-2 row-start-2'
  if (id === 'right') return 'col-start-3 row-start-2'
  return 'col-start-2 row-start-3'
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
    <div className="grid gap-4">
      <p className="text-center text-7xl font-semibold tracking-tighter">{shown ?? '—'}</p>
      <p className="text-center text-sm text-muted-foreground">
        {device.state.confidence === 'confirmed' ? 'Setpoint confirmed' : 'Last sent settings, not confirmed'}
        {typeof room === 'number' ? ` · Room sensor ${room}°` : ''}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-16"
          disabled={disabled || !temperature}
          onClick={() => queue({ temperature: step(readTemperature(draftRef.current, shown, temperature), -(temperature?.step ?? 1), temperature) })}
        >
          <Minus />
          Cooler
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-16"
          disabled={disabled || !temperature}
          onClick={() => queue({ temperature: step(readTemperature(draftRef.current, shown, temperature), temperature?.step ?? 1, temperature) })}
        >
          <Plus />
          Warmer
        </Button>
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
    <div className="grid gap-3">
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
            <div key={capability.id} className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" className="h-16" disabled={disabled} onClick={() => void send(capability.id, { value: Math.max(capability.range?.min ?? 0, Number(current) - (capability.range?.step ?? 1)) })}>
                {capability.label} down
              </Button>
              <Button type="button" variant="secondary" className="h-16" disabled={disabled} onClick={() => void send(capability.id, { value: Math.min(capability.range?.max ?? 100, Number(current) + (capability.range?.step ?? 1)) })}>
                {capability.label} up
              </Button>
            </div>
          )
        }
        if (capability.kind === 'toggle') {
          const current =
            capability.id === 'fan.oscillate' ? device.state.values.oscillating === true : device.state.values.muted === true
          return (
            <Button key={capability.id} type="button" variant="secondary" className="h-16" disabled={disabled} onClick={() => void send(capability.id, { value: !current })}>
              {capability.label}
            </Button>
          )
        }
        if (capability.kind === 'enum' && capability.enumValues) {
          return (
            <div key={capability.id} className="grid gap-2">
              <Label htmlFor={capability.id}>{capability.label}</Label>
              <Select id={capability.id} disabled={disabled} onChange={(event) => void send(capability.id, { value: event.target.value })} defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {capability.enumValues.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </div>
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
  icon,
}: {
  id: string
  device: DeviceRecord
  disabled: boolean
  send: (capability: string, args?: Record<string, unknown>) => Promise<void>
  label?: string
  args?: Record<string, unknown>
  hideIfMissing?: boolean
  icon?: 'up' | 'down'
}) {
  const capability = device.capabilities.find((item) => item.id === id)
  if (!capability && hideIfMissing) return null
  const text = label ?? capability?.label ?? id
  return (
    <HoldButton
      label={text}
      className="w-full"
      disabled={disabled || !capability?.available}
      reason={capability ? capability.unavailableReason : 'This device does not advertise this control.'}
      repeat={capability?.repeat}
      onFire={(isRepeat) => send(id, { ...args, ...(isRepeat ? { repeat: true } : {}) })}
    >
      {icon === 'up' ? <ChevronUp /> : null}
      {icon === 'down' ? <ChevronDown /> : null}
    </HoldButton>
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
  const selected = typeof draft[field] === 'string' ? draft[field] : ''
  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <ToggleGroup
        type="single"
        value={selected}
        disabled={disabled}
        onValueChange={(value) => {
          if (value) queue({ [field]: value })
        }}
      >
        {spec.values.map((value) => (
          <ToggleGroupItem key={value} value={value}>
            {value}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">Name and room</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Name and room</SheetTitle>
          <SheetDescription>This only changes the label in the app.</SheetDescription>
        </SheetHeader>
        <form
          className="grid gap-4"
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
          <div className="grid gap-2">
            <Label htmlFor="remote-name">Name</Label>
            <Input id="remote-name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="remote-room">Room</Label>
            <Input id="remote-room" value={room} maxLength={40} onChange={(event) => setRoom(event.target.value)} />
          </div>
          <Button type="submit">Save name and room</Button>
          {message ? <p className="text-sm" role="status">{message}</p> : null}
        </form>
      </SheetContent>
    </Sheet>
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
