import {
  emptyState,
  labelFor,
  repeatFor,
  type Capability,
  type Category,
  type DeviceRecord,
} from '@remote/protocol';
import type { ExecuteResult } from '../commands.ts';
import type { DiscoveryEntity } from './ha-map.ts';

export function demoCatalog(): DiscoveryEntity[] {
  return [demoTv(), demoAc(), demoFan()];
}

export function demoResult(
  device: DeviceRecord,
  command: { capability: string; arguments: Record<string, unknown> },
): ExecuteResult {
  const current = device.state.values;
  const args = command.arguments;
  if (command.capability === 'power_on') return sent({ power: true });
  if (command.capability === 'power_off') return sent({ power: false });
  if (command.capability === 'power_toggle') return sent({ power: current.power !== true });
  if (command.capability === 'mute') return sent({ muted: args.value === true });
  if (command.capability === 'volume_up')
    return sent({ volume: clamp(asNumber(current.volume, 20) + 5, 0, 100) });
  if (command.capability === 'volume_down')
    return sent({ volume: clamp(asNumber(current.volume, 20) - 5, 0, 100) });
  if (command.capability === 'channel_up')
    return sent({ channel: clamp(asNumber(current.channel, 1) + 1, 1, 999) });
  if (command.capability === 'channel_down')
    return sent({ channel: clamp(asNumber(current.channel, 1) - 1, 1, 999) });
  if (command.capability === 'input' || command.capability === 'activity')
    return sent({ input: args.value });
  if (command.capability === 'climate.set') return sent({ ...args });
  if (command.capability === 'fan.speed') return sent({ percentage: args.value, power: true });
  if (command.capability === 'fan.oscillate') return sent({ oscillating: args.value === true });
  return sent({});
}

function demoTv(): DiscoveryEntity {
  const ids = [
    'power_on',
    'power_off',
    'volume_up',
    'volume_down',
    'channel_up',
    'channel_down',
    'up',
    'down',
    'left',
    'right',
    'ok',
    'back',
    'home',
    'menu',
    'play',
    'pause',
    'stop',
    'next',
    'previous',
    ...Array.from({ length: 10 }, (_, index) => `digit_${index}`),
  ];
  const capabilities: Capability[] = ids.map((id) => button(id));
  capabilities.push({
    id: 'mute',
    label: 'Mute',
    kind: 'toggle',
    confirmation: 'transmission_only',
    idempotent: false,
    available: true,
  });
  capabilities.push({
    id: 'input',
    label: 'Input',
    kind: 'enum',
    confirmation: 'transmission_only',
    idempotent: true,
    available: true,
    enumValues: ['TV', 'HDMI 1', 'HDMI 2'],
  });
  return entity('demo:tv', 'Demo TV', 'tv', capabilities);
}

function demoAc(): DiscoveryEntity {
  const capabilities: Capability[] = [
    button('power_on'),
    button('power_off'),
    {
      id: 'climate.set',
      label: 'Settings',
      kind: 'state',
      confirmation: 'transmission_only',
      idempotent: true,
      available: true,
      stateFields: [
        { id: 'power', label: 'Power', kind: 'boolean' },
        {
          id: 'mode',
          label: 'Mode',
          kind: 'enum',
          values: ['cool', 'heat', 'dry', 'fan_only', 'auto'],
        },
        {
          id: 'temperature',
          label: 'Temperature',
          kind: 'number',
          min: 16,
          max: 30,
          step: 1,
          unit: '°C',
        },
        { id: 'fan', label: 'Fan', kind: 'enum', values: ['auto', 'low', 'medium', 'high'] },
        { id: 'swing', label: 'Swing', kind: 'enum', values: ['off', 'vertical'] },
      ],
    },
  ];
  return entity('demo:ac', 'Demo air conditioner', 'ac', capabilities);
}

function demoFan(): DiscoveryEntity {
  return entity('demo:fan', 'Demo fan', 'fan', [
    button('power_on'),
    button('power_off'),
    {
      id: 'fan.speed',
      label: 'Speed',
      kind: 'range',
      confirmation: 'transmission_only',
      idempotent: true,
      available: true,
      range: { min: 1, max: 100, step: 1, unit: '%' },
    },
    {
      id: 'fan.oscillate',
      label: 'Oscillate',
      kind: 'toggle',
      confirmation: 'transmission_only',
      idempotent: false,
      available: true,
    },
  ]);
}

function entity(
  connectionId: string,
  name: string,
  category: Category,
  capabilities: Capability[],
): DiscoveryEntity {
  return {
    connectionId,
    name,
    domain: 'demo',
    deviceClass: null,
    suggestedCategory: category,
    allowedCategories: [category],
    confirmation: 'transmission_only',
    capabilities,
    unsupported: [],
    state: emptyState('Demo preview. No appliance was contacted.'),
    learnSupported: false,
    simulated: true,
  };
}

function button(id: string): Capability {
  const repeat = repeatFor(id, 'resend_frame');
  return {
    id,
    label: labelFor(id),
    kind: 'discrete',
    confirmation: 'transmission_only',
    idempotent: false,
    available: true,
    ...(repeat ? { repeat } : {}),
  };
}

function sent(statePatch: Record<string, unknown>): ExecuteResult {
  return Object.keys(statePatch).length > 0
    ? { kind: 'transmitted', statePatch, confirmed: false }
    : { kind: 'transmitted', confirmed: false };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
