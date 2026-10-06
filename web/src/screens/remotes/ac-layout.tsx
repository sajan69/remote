import { useRef, useState } from 'react'
import type { Capability, DeviceRecord } from '@remote/protocol'
import { findCapability } from '@remote/protocol'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx'
import { complete, readTemperature, step } from '@/lib/capabilities.ts'
import type { SendCommand } from './slot.tsx'

export function AcLayout({
  device,
  disabled,
  send,
}: {
  device: DeviceRecord
  disabled: boolean
  send: SendCommand
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
