import { useEffect, useRef, type ReactNode } from 'react'
import type { Capability, CommandRecord, DeviceState } from '@remote/protocol'
import { powerPlan } from '@remote/protocol'
import { go } from './router.ts'

export function commandText(command: CommandRecord | null): string {
  if (!command) return ''
  if (command.simulated) return 'Demo preview. No appliance was contacted.'
  if (command.status === 'queued_locally' || command.status === 'gateway_accepted') return 'Sending.'
  if (command.status === 'transmitted') return 'Sent. The appliance has not confirmed it.'
  if (command.status === 'appliance_confirmed') return 'The device confirmed that command.'
  if (command.status === 'outcome_unknown') {
    return command.error?.message ?? 'It is unclear whether that was sent. It was not retried.'
  }
  return command.error?.message ?? 'That command was not sent.'
}

export function confidenceLabel(state: DeviceState): string {
  if (state.confidence === 'confirmed') return 'Confirmed'
  if (state.confidence === 'assumed') return 'Assumed'
  return 'Unknown'
}

export function Header({ title, back = false, children }: { title: string; back?: boolean; children?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <button type="button" className="icon-button" onClick={() => go('#/')}>
          Back
        </button>
      ) : (
        <a className="icon-button" href="#/gateway">
          Link
        </a>
      )}
      <h1>{title}</h1>
      {children ?? (
        <a className="icon-button" href="#/settings">
          Settings
        </a>
      )}
    </header>
  )
}

export function HoldButton({
  label,
  disabled,
  reason,
  repeat,
  className,
  shortcut,
  onFire,
}: {
  label: string
  disabled?: boolean
  reason?: string
  repeat?: Capability['repeat']
  className?: string
  shortcut?: string
  onFire: (isRepeat: boolean) => Promise<void>
}) {
  const timer = useRef<number | null>(null)
  const busy = useRef(false)
  const stopRef = useRef<(() => void) | null>(null)

  function clear() {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    stopRef.current?.()
    stopRef.current = null
  }

  useEffect(() => clear, [])
  useEffect(() => {
    if (disabled) clear()
  }, [disabled])

  async function fire(isRepeat: boolean) {
    if (disabled || busy.current) return
    busy.current = true
    try {
      await onFire(isRepeat)
    } finally {
      busy.current = false
    }
  }

  function begin(event: { preventDefault: () => void; button?: number }) {
    if (disabled || (event.button !== undefined && event.button !== 0)) return
    event.preventDefault()
    clear()
    void fire(false)
    if (!repeat) return
    const started = Date.now()
    const maxHold = repeat.maxHoldMs
    const interval = repeat.intervalMs
    timer.current = window.setInterval(() => {
      if (Date.now() - started > maxHold || document.hidden) {
        clear()
        return
      }
      void fire(true)
    }, interval)
    const end = () => clear()
    stopRef.current = () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      document.removeEventListener('visibilitychange', onHide)
    }
    const onHide = () => {
      if (document.hidden) end()
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    document.addEventListener('visibilitychange', onHide)
  }

  const aria = reason ? `${label}. Unavailable. ${reason}` : label
  if (!repeat) {
    return (
      <button type="button" className={className} disabled={disabled} aria-label={aria} title={reason} onClick={() => void fire(false)}>
        {label}
      </button>
    )
  }
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={aria}
      aria-keyshortcuts={shortcut}
      title={reason}
      onPointerDown={begin}
      onKeyDown={(event) => {
        if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
        begin(event)
      }}
      onKeyUp={clear}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  )
}

export function PowerControls({
  deviceCapabilities,
  state,
  disabled,
  onFire,
}: {
  deviceCapabilities: Capability[]
  state: DeviceState
  disabled?: boolean
  onFire: (capability: string) => Promise<void>
}) {
  const plan = powerPlan(deviceCapabilities, state)
  if (plan.mode === 'none') return <p className="small muted">{plan.reason}</p>
  if (plan.mode === 'discrete-pair') {
    return (
      <div className="power-pair">
        <button type="button" className="power" disabled={disabled} onClick={() => void onFire('power_on')}>
          On
        </button>
        <button type="button" className="power" disabled={disabled} onClick={() => void onFire('power_off')}>
          Off
        </button>
      </div>
    )
  }
  return (
    <div className="stack">
      <button type="button" className="power" disabled={disabled} onClick={() => void onFire(plan.capability.id)}>
        {plan.label}
      </button>
      {plan.caution ? <p className="small muted">{plan.caution}</p> : null}
    </div>
  )
}

export function StatusLine({ state, online, ready }: { state?: DeviceState; online: boolean; ready: boolean }) {
  const confidence = state ? confidenceLabel(state) : 'Unknown'
  const tone = !online || !ready ? 'bad' : state?.confidence === 'confirmed' ? 'good' : 'warn'
  return (
    <div className="spread">
      <span className={`pill ${online ? 'good' : 'bad'}`}>{online ? 'Gateway connected' : 'Gateway disconnected'}</span>
      <span className={`pill ${tone}`}>{ready ? confidence : 'Controls paused'}</span>
    </div>
  )
}
