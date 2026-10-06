import { useEffect } from 'react';
import type { DeviceRecord } from '@remote/protocol';
import { findCapability } from '@remote/protocol';
import { Label } from '@/components/ui/label.tsx';
import { Select } from '@/components/ui/select.tsx';
import { Slot, type SendCommand } from './slot.tsx';

const PAD = ['up', 'left', 'ok', 'right', 'down'] as const;

export function TvLayout({
  device,
  disabled,
  send,
}: {
  device: DeviceRecord;
  disabled: boolean;
  send: SendCommand;
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
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      const capability = map[event.key];
      if (!capability || event.repeat || !findCapability(device.capabilities, capability)) return;
      event.preventDefault();
      void send(
        capability,
        capability === 'mute' ? { value: device.state.values.muted !== true } : undefined,
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [device.capabilities, device.state.values.muted, send]);

  const input = findCapability(device.capabilities, 'input');
  const digits = device.capabilities.filter((capability) => /^digit_\d$/.test(capability.id));
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
        <Slot
          id="mute"
          device={device}
          disabled={disabled}
          send={send}
          args={{ value: device.state.values.muted !== true }}
        />
      </div>
      <div className="grid grid-cols-[4.75rem_1fr_4.75rem] items-center gap-3">
        <div className="grid gap-2">
          <Slot
            id="volume_up"
            device={device}
            disabled={disabled}
            send={send}
            label="Vol +"
            icon="up"
          />
          <Slot
            id="volume_down"
            device={device}
            disabled={disabled}
            send={send}
            label="Vol −"
            icon="down"
          />
        </div>
        <div className="grid grid-cols-3 grid-rows-3 gap-2">
          {PAD.map((id) => (
            <div key={id} className={padCell(id)}>
              <Slot id={id} device={device} disabled={disabled} send={send} />
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          <Slot
            id="channel_up"
            device={device}
            disabled={disabled}
            send={send}
            label="Ch +"
            icon="up"
          />
          <Slot
            id="channel_down"
            device={device}
            disabled={disabled}
            send={send}
            label="Ch −"
            icon="down"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['back', 'home', 'menu', 'play', 'pause', 'stop', 'previous', 'next'].map((id) => (
          <Slot
            key={id}
            id={id}
            device={device}
            disabled={disabled}
            send={send}
            hideIfMissing={id !== 'back' && id !== 'home' && id !== 'menu'}
          />
        ))}
      </div>
      {digits.length > 0 ? (
        <details className="rounded-2xl border bg-card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">
            Number keys
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {digits.map((capability) => (
              <Slot
                key={capability.id}
                id={capability.id}
                device={device}
                disabled={disabled}
                send={send}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function padCell(id: (typeof PAD)[number]): string {
  if (id === 'up') return 'col-start-2 row-start-1';
  if (id === 'left') return 'col-start-1 row-start-2';
  if (id === 'ok') return 'col-start-2 row-start-2';
  if (id === 'right') return 'col-start-3 row-start-2';
  return 'col-start-2 row-start-3';
}
