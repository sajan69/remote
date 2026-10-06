import type { DeviceRecord } from '@remote/protocol'
import { Button } from '@/components/ui/button.tsx'
import { Label } from '@/components/ui/label.tsx'
import { Select } from '@/components/ui/select.tsx'
import { Slot, type SendCommand } from './slot.tsx'

export function SimpleLayout({
  device,
  disabled,
  send,
}: {
  device: DeviceRecord
  disabled: boolean
  send: SendCommand
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
