import type { AcLimits } from './types.ts'

export const AC_MODES = ['auto', 'cool', 'heat', 'dry', 'fan_only'] as const
export const AC_FANS = ['auto', 'quiet', 'low', 'medium', 'high'] as const
export const AC_SWINGS = ['off', 'vertical', 'horizontal', 'both'] as const

const MODE_INDEX: Record<(typeof AC_MODES)[number], number> = {
  auto: 0,
  cool: 1,
  heat: 2,
  dry: 3,
  fan_only: 4,
}
const FAN_INDEX: Record<(typeof AC_FANS)[number], number> = {
  auto: 0,
  quiet: 1,
  low: 2,
  medium: 3,
  high: 4,
}
const SWING_INDEX: Record<(typeof AC_SWINGS)[number], number> = {
  off: 0,
  vertical: 1,
  horizontal: 2,
  both: 3,
}

export interface AcDesiredState {
  power: boolean
  mode: string
  celsius: number
  fan: string
  swing: string
}

export interface EncodedAcFrame {
  bytes: number[]
  timingsUs: number[]
  carrierHz: number
}

export function encodeAcStateV1(state: AcDesiredState, limits: AcLimits): EncodedAcFrame {
  const mode = assertMember(state.mode, limits.modes, MODE_INDEX, 'mode')
  const fan = assertMember(state.fan, limits.fans, FAN_INDEX, 'fan')
  const swing = assertMember(state.swing, limits.swings, SWING_INDEX, 'swing')
  if (!Number.isFinite(state.celsius) || state.celsius < limits.min || state.celsius > limits.max) {
    throw new Error(`Temperature must be between ${limits.min} and ${limits.max}.`)
  }
  const steps = Math.round((state.celsius - limits.min) / limits.step)
  if (limits.step <= 0 || Math.abs(state.celsius - (limits.min + steps * limits.step)) > 1e-6) {
    throw new Error(`Temperature must use steps of ${limits.step}.`)
  }
  if (!Number.isInteger(state.celsius) || state.celsius < 0 || state.celsius > 255) {
    throw new Error('This encoder stores temperature as a whole number from 0 to 255.')
  }

  const bytes = [
    0xa1,
    0x01,
    state.power ? 1 : 0,
    MODE_INDEX[mode],
    state.celsius,
    FAN_INDEX[fan],
    SWING_INDEX[swing],
    0,
  ]
  bytes[7] = bytes.slice(0, 7).reduce((sum, byte) => sum ^ byte, 0)
  return { bytes, timingsUs: toPulses(bytes), carrierHz: 38000 }
}

export function decodeAcStateV1(bytes: number[]): AcDesiredState {
  if (bytes.length !== 8 || bytes[0] !== 0xa1 || bytes[1] !== 0x01) {
    throw new Error('This is not an ac_state_v1 frame.')
  }
  const checksum = bytes.slice(0, 7).reduce((sum, byte) => sum ^ byte, 0)
  if (checksum !== bytes[7]) throw new Error('The air-conditioner frame checksum does not match.')
  const mode = AC_MODES[bytes[3]]
  const fan = AC_FANS[bytes[5]]
  const swing = AC_SWINGS[bytes[6]]
  if (!mode || !fan || !swing || (bytes[2] !== 0 && bytes[2] !== 1)) {
    throw new Error('The air-conditioner frame contains an unknown field.')
  }
  return {
    power: bytes[2] === 1,
    mode,
    celsius: bytes[4] ?? 0,
    fan,
    swing,
  }
}

function assertMember<T extends string>(
  value: string,
  allowed: string[],
  index: Record<T, number>,
  name: string,
): T {
  if (!allowed.includes(value) || !(value in index)) {
    throw new Error(`${value} is not a supported ${name}.`)
  }
  return value as T
}

function toPulses(bytes: number[]): number[] {
  const timings = [3400, 1700]
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      timings.push(450, (byte >> bit) & 1 ? 1250 : 450)
    }
  }
  timings.push(450)
  return timings
}
