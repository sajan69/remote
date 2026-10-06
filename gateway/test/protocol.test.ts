import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAcStateV1, encodeAcStateV1, encodeNec, encodeNecRepeat, parseProfile, powerPlan } from '@remote/protocol'
import type { Capability, DeviceState } from '@remote/protocol'

test('NEC frame uses the header, inverted bytes, and a trailing mark', () => {
  const timings = encodeNec(0x00, 0x00)
  assert.deepEqual(timings.slice(0, 2), [9000, 4500])
  assert.equal(timings.at(-1), 560)
  assert.equal(timings.length, 67)
  const spaces = timings.filter((_, index) => index > 2 && index % 2 === 1)
  assert.deepEqual(spaces.slice(0, 8), Array(8).fill(560))
  assert.deepEqual(spaces.slice(8, 16), Array(8).fill(1690))
  assert.deepEqual(encodeNecRepeat(), [9000, 2250, 560])
  assert.throws(() => encodeNec(256, 1))
})

test('air-conditioner frames round-trip and reject illegal combinations', () => {
  const limits = {
    min: 16,
    max: 30,
    step: 1,
    modes: ['cool', 'heat'],
    fans: ['auto', 'low'],
    swings: ['off', 'vertical'],
  }
  const frame = encodeAcStateV1({ power: true, mode: 'cool', celsius: 24, fan: 'low', swing: 'vertical' }, limits)
  assert.equal(frame.bytes[7], frame.bytes.slice(0, 7).reduce((sum, byte) => sum ^ byte, 0))
  assert.deepEqual(decodeAcStateV1(frame.bytes), {
    power: true,
    mode: 'cool',
    celsius: 24,
    fan: 'low',
    swing: 'vertical',
  })
  assert.equal(frame.timingsUs[0], 3400)
  assert.throws(() => encodeAcStateV1({ power: true, mode: 'dry', celsius: 24, fan: 'low', swing: 'off' }, limits))
  assert.throws(() => encodeAcStateV1({ power: true, mode: 'cool', celsius: 31, fan: 'low', swing: 'off' }, limits))
  const broken = [...frame.bytes]
  broken[7] = 0
  assert.throws(() => decodeAcStateV1(broken))
})

test('imported profiles cannot claim confirmation and must name a licence', () => {
  const profile = parseProfile(
    {
      name: 'Living room buttons',
      category: 'tv',
      status: 'user_confirmed',
      provenance: 'Captured from the household remote.',
      licence: 'Household use only.',
      protocol: 'ha_remote',
      version: 1,
      commands: { volume_up: { command: 'volume_up' } },
    },
    { id: 'profile_test_1', forceExperimental: true },
  )
  assert.equal(profile.status, 'experimental')
  assert.throws(() =>
    parseProfile({
      name: 'Missing licence',
      category: 'tv',
      status: 'experimental',
      provenance: 'Unknown source.',
      protocol: 'ha_remote',
      version: 1,
      commands: {},
    }),
  )
})

test('unknown power is not presented as a single toggle when on and off both exist', () => {
  const on: Capability = {
    id: 'power_on',
    label: 'On',
    kind: 'discrete',
    confirmation: 'transmission_only',
    idempotent: false,
    available: true,
  }
  const off = { ...on, id: 'power_off', label: 'Off' }
  const unknown: DeviceState = {
    values: {},
    source: 'none',
    confidence: 'unknown',
    observedAt: null,
    lastCommandId: null,
  }
  assert.equal(powerPlan([on, off], unknown).mode, 'discrete-pair')
  assert.equal(
    powerPlan([on, off], { ...unknown, values: { power: true }, confidence: 'confirmed' }).mode,
    'single',
  )
})
