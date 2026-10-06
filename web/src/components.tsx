import { ArrowLeft, Cable, Settings, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Capability, CommandRecord, DeviceState } from '@remote/protocol';
import { powerPlan } from '@remote/protocol';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import { go } from './router.ts';

export function commandText(command: CommandRecord | null): string {
  if (!command) return '';
  if (command.simulated) return 'Demo preview. No appliance was contacted.';
  if (command.status === 'queued_locally' || command.status === 'gateway_accepted')
    return 'Sending.';
  if (command.status === 'transmitted') return 'Sent. The appliance has not confirmed it.';
  if (command.status === 'appliance_confirmed') return 'The device confirmed that command.';
  if (command.status === 'outcome_unknown') {
    return command.error?.message ?? 'It is unclear whether that was sent. It was not retried.';
  }
  return command.error?.message ?? 'That command was not sent.';
}

export function confidenceLabel(state: DeviceState): string {
  if (state.confidence === 'confirmed') return 'Confirmed';
  if (state.confidence === 'assumed') return 'Assumed';
  return 'Unknown';
}

export function DemoBanner({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm"
      role="status"
    >
      <TriangleAlert className="mt-0.5 size-4 text-primary" />
      <p>{children}</p>
    </div>
  );
}

export function Header({
  title,
  back = false,
  settings = true,
  children,
}: {
  title: string;
  back?: boolean;
  settings?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2">
      {back ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => go('#/')}
          aria-label="Back"
        >
          <ArrowLeft />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" asChild>
          <a href="#/gateway" aria-label="Gateway">
            <Cable />
          </a>
        </Button>
      )}
      <h1 className="flex-1 text-center text-lg font-semibold tracking-tight">{title}</h1>
      {children ??
        (settings ? (
          <Button variant="ghost" size="icon" asChild>
            <a href="#/settings" aria-label="Settings">
              <Settings />
            </a>
          </Button>
        ) : (
          <span className="size-12" />
        ))}
    </header>
  );
}

export function HoldButton({
  label,
  disabled,
  reason,
  repeat,
  className,
  shortcut,
  children,
  onFire,
}: {
  label: string;
  disabled?: boolean;
  reason?: string;
  repeat?: Capability['repeat'];
  className?: string;
  shortcut?: string;
  children?: ReactNode;
  onFire: (isRepeat: boolean) => Promise<void>;
}) {
  const timer = useRef<number | null>(null);
  const busy = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);

  function clear() {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stopRef.current?.();
    stopRef.current = null;
  }

  useEffect(() => clear, []);
  useEffect(() => {
    if (disabled) clear();
  }, [disabled]);

  async function fire(isRepeat: boolean) {
    if (disabled || busy.current) return;
    busy.current = true;
    try {
      await onFire(isRepeat);
    } finally {
      busy.current = false;
    }
  }

  function begin(event: { preventDefault: () => void; button?: number }) {
    if (disabled || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    clear();
    void fire(false);
    if (!repeat) return;
    const started = Date.now();
    const maxHold = repeat.maxHoldMs;
    const interval = repeat.intervalMs;
    timer.current = window.setInterval(() => {
      if (Date.now() - started > maxHold || document.hidden) {
        clear();
        return;
      }
      void fire(true);
    }, interval);
    const end = () => clear();
    stopRef.current = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', onHide);
    };
    const onHide = () => {
      if (document.hidden) end();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    document.addEventListener('visibilitychange', onHide);
  }

  const aria = reason ? `${label}. Unavailable. ${reason}` : label;
  const classes = cn('h-16 min-w-12 text-base', className);
  if (!repeat) {
    return (
      <Button
        type="button"
        variant="secondary"
        className={classes}
        disabled={disabled}
        aria-label={aria}
        title={reason}
        onClick={() => void fire(false)}
      >
        {children}
        {label}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="secondary"
      className={classes}
      disabled={disabled}
      aria-label={aria}
      aria-keyshortcuts={shortcut}
      title={reason}
      onPointerDown={begin}
      onKeyDown={(event) => {
        if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
        begin(event);
      }}
      onKeyUp={clear}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
      {label}
    </Button>
  );
}

export function PowerControls({
  deviceCapabilities,
  state,
  disabled,
  onFire,
}: {
  deviceCapabilities: Capability[];
  state: DeviceState;
  disabled?: boolean;
  onFire: (capability: string) => Promise<void>;
}) {
  const plan = powerPlan(deviceCapabilities, state);
  if (plan.mode === 'none') return <p className="text-sm text-muted-foreground">{plan.reason}</p>;
  if (plan.mode === 'discrete-pair') {
    return (
      <div className="grid gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-16 rounded-full border-2 border-primary p-0 text-sm text-primary"
          disabled={disabled}
          onClick={() => void onFire('power_on')}
        >
          On
        </Button>
        <Button
          type="button"
          variant="outline"
          className="size-16 rounded-full border-2 border-primary p-0 text-sm text-primary"
          disabled={disabled}
          onClick={() => void onFire('power_off')}
        >
          Off
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        className="size-16 rounded-full border-2 border-primary p-0 text-sm text-primary"
        disabled={disabled}
        onClick={() => void onFire(plan.capability.id)}
      >
        {plan.label}
      </Button>
      {plan.caution ? (
        <p className="max-w-40 text-xs text-muted-foreground">{plan.caution}</p>
      ) : null}
    </div>
  );
}

export function StatusLine({
  state,
  online,
  ready,
}: {
  state?: DeviceState;
  online: boolean;
  ready: boolean;
}) {
  const confidence = state ? confidenceLabel(state) : 'Unknown';
  const tone = !online || !ready ? 'bad' : state?.confidence === 'confirmed' ? 'good' : 'warn';
  return (
    <div className="flex items-center justify-between gap-2">
      <Badge variant={online ? 'good' : 'bad'}>
        {online ? 'Gateway connected' : 'Gateway disconnected'}
      </Badge>
      <Badge variant={tone}>{ready ? confidence : 'Controls paused'}</Badge>
    </div>
  );
}
