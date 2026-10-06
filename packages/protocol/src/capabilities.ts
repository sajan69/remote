import type { Capability, DeviceState, PowerPlan, StateField } from './types.ts';

const LABELS: Record<string, string> = {
  power_on: 'On',
  power_off: 'Off',
  power_toggle: 'Power',
  volume_up: 'Volume up',
  volume_down: 'Volume down',
  volume: 'Volume',
  mute: 'Mute',
  channel_up: 'Channel up',
  channel_down: 'Channel down',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  ok: 'OK',
  back: 'Back',
  home: 'Home',
  menu: 'Menu',
  input: 'Input',
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  next: 'Next',
  previous: 'Previous',
  activity: 'Activity',
  'climate.set': 'Settings',
  'fan.speed': 'Speed',
  'fan.oscillate': 'Oscillate',
  'light.brightness': 'Brightness',
  'light.color_temp': 'Colour temperature',
};

const REPEAT_IDS = new Set([
  'volume_up',
  'volume_down',
  'channel_up',
  'channel_down',
  'up',
  'down',
  'left',
  'right',
]);

export function labelFor(id: string): string {
  const known = LABELS[id];
  if (known) return known;
  if (/^digit_\d$/.test(id)) return id.slice('digit_'.length);
  return id.replace(/[._]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function repeatFor(
  id: string,
  mode: 'protocol_repeat' | 'resend_frame',
): Capability['repeat'] | undefined {
  if (!REPEAT_IDS.has(id)) return undefined;
  return {
    intervalMs: mode === 'protocol_repeat' ? 120 : 180,
    mode,
    maxHoldMs: 8000,
  };
}

export function findCapability(capabilities: Capability[], id: string): Capability | undefined {
  return capabilities.find((capability) => capability.id === id && capability.available);
}

export function validateArguments(
  capability: Capability,
  args: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  if (!capability.available) {
    return {
      ok: false,
      message:
        capability.unavailableReason ?? `${capability.label} is not available on this device.`,
    };
  }

  const repeat = args.repeat;
  const rest = { ...args };
  delete rest.repeat;

  if (repeat !== undefined) {
    if (!capability.repeat) {
      return { ok: false, message: `${capability.label} does not repeat.` };
    }
    if (typeof repeat !== 'boolean') {
      return { ok: false, message: 'Repeat must be true or false.' };
    }
  }

  if (capability.kind === 'discrete') {
    if (Object.keys(rest).length > 0) {
      return { ok: false, message: `${capability.label} does not take settings.` };
    }
    return { ok: true };
  }

  if (capability.kind === 'toggle') {
    if (typeof rest.value !== 'boolean' || Object.keys(rest).length !== 1) {
      return { ok: false, message: `${capability.label} needs a true or false value.` };
    }
    return { ok: true };
  }

  if (capability.kind === 'range') {
    const range = capability.range;
    if (!range || typeof rest.value !== 'number' || Object.keys(rest).length !== 1) {
      return { ok: false, message: `${capability.label} needs a number.` };
    }
    if (!Number.isFinite(rest.value) || rest.value < range.min || rest.value > range.max) {
      return {
        ok: false,
        message: `${capability.label} must be between ${range.min} and ${range.max}.`,
      };
    }
    if (!onStep(rest.value, range.min, range.step)) {
      return { ok: false, message: `${capability.label} must use steps of ${range.step}.` };
    }
    return { ok: true };
  }

  if (capability.kind === 'enum') {
    if (typeof rest.value !== 'string' || Object.keys(rest).length !== 1) {
      return { ok: false, message: `${capability.label} needs one choice.` };
    }
    if (!capability.enumValues?.includes(rest.value)) {
      return {
        ok: false,
        message: `${rest.value} is not a supported ${capability.label.toLowerCase()}.`,
      };
    }
    return { ok: true };
  }

  const fields = capability.stateFields ?? [];
  const allowed = new Set(fields.map((field) => field.id));
  for (const key of Object.keys(rest)) {
    if (!allowed.has(key)) {
      return { ok: false, message: `${key} is not part of this command.` };
    }
  }
  for (const field of fields) {
    const message = checkField(field, rest[field.id]);
    if (message) return { ok: false, message };
  }
  return { ok: true };
}

function checkField(field: StateField, value: unknown): string | null {
  if (field.kind === 'boolean') {
    return typeof value === 'boolean' ? null : `${field.label} needs a true or false value.`;
  }
  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${field.label} needs a number.`;
    }
    if (field.min !== undefined && value < field.min)
      return `${field.label} is below ${field.min}.`;
    if (field.max !== undefined && value > field.max)
      return `${field.label} is above ${field.max}.`;
    if (
      field.step !== undefined &&
      field.min !== undefined &&
      !onStep(value, field.min, field.step)
    ) {
      return `${field.label} must use steps of ${field.step}.`;
    }
    return null;
  }
  if (typeof value !== 'string' || !field.values?.includes(value)) {
    return `${String(value)} is not a supported ${field.label.toLowerCase()}.`;
  }
  return null;
}

function onStep(value: number, min: number, step: number): boolean {
  if (step <= 0) return false;
  const steps = Math.round((value - min) / step);
  return Math.abs(value - (min + steps * step)) < 1e-6;
}

export function powerPlan(capabilities: Capability[], state: DeviceState): PowerPlan {
  const on = findCapability(capabilities, 'power_on');
  const off = findCapability(capabilities, 'power_off');
  const toggle = findCapability(capabilities, 'power_toggle');
  const power = state.values.power;
  const known = state.confidence === 'confirmed' && typeof power === 'boolean';

  if (on && off) {
    if (known && power === true) return { mode: 'single', capability: off, label: 'Turn off' };
    if (known && power === false) return { mode: 'single', capability: on, label: 'Turn on' };
    return { mode: 'discrete-pair', on, off };
  }

  if (toggle) {
    return {
      mode: 'single',
      capability: toggle,
      label: 'Power toggle',
      caution:
        state.confidence === 'confirmed'
          ? undefined
          : 'This toggles power. The current state is not confirmed, so the unit may turn on or off.',
    };
  }

  if (on) return { mode: 'single', capability: on, label: 'Turn on' };
  if (off) return { mode: 'single', capability: off, label: 'Turn off' };
  return { mode: 'none', reason: 'This device does not advertise a power command.' };
}

export function emptyState(note?: string): DeviceState {
  return {
    values: {},
    source: 'none',
    confidence: 'unknown',
    observedAt: null,
    lastCommandId: null,
    ...(note ? { note } : {}),
  };
}
