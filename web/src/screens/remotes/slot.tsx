import type { DeviceRecord } from '@remote/protocol'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { HoldButton } from '../../components.tsx'

export type SendCommand = (capability: string, args?: Record<string, unknown>) => Promise<void>

export function Slot({
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
  send: SendCommand
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
