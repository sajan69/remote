import { expect, test } from '@jest/globals';
import {
  decodeAcStateV1,
  encodeAcStateV1,
  encodeNec,
  encodeNecRepeat,
  parseProfile,
  powerPlan,
} from '@remote/protocol';
import type { Capability, DeviceState } from '@remote/protocol';

test('NEC frame uses the header, inverted bytes, and a trailing mark', () => {
  const timings = encodeNec(0x00, 0x00);
  expect(timings.slice(0, 2)).toEqual([9000, 4500]);
  expect(timings.at(-1)).toBe(560);
  expect(timings.length).toBe(67);
  const spaces = timings.filter((_, index) => index > 2 && index % 2 === 1);
  expect(spaces.slice(0, 8)).toEqual(Array(8).fill(560));
  expect(spaces.slice(8, 16)).toEqual(Array(8).fill(1690));
  expect(encodeNecRepeat()).toEqual([9000, 2250, 560]);
  expect(() => encodeNec(256, 1)).toThrow();
});

test('air-conditioner frames round-trip and reject illegal combinations', () => {
  const limits = {
    min: 16,
    max: 30,
    step: 1,
    modes: ['cool', 'heat'],
    fans: ['auto', 'low'],
    swings: ['off', 'vertical'],
  };
  const frame = encodeAcStateV1(
    { power: true, mode: 'cool', celsius: 24, fan: 'low', swing: 'vertical' },
    limits,
  );
  expect(frame.bytes[7]).toBe(frame.bytes.slice(0, 7).reduce((sum, byte) => sum ^ byte, 0));
  expect(decodeAcStateV1(frame.bytes)).toEqual({
    power: true,
    mode: 'cool',
    celsius: 24,
    fan: 'low',
    swing: 'vertical',
  });
  expect(frame.timingsUs[0]).toBe(3400);
  expect(() =>
    encodeAcStateV1({ power: true, mode: 'dry', celsius: 24, fan: 'low', swing: 'off' }, limits),
  ).toThrow();
  expect(() =>
    encodeAcStateV1({ power: true, mode: 'cool', celsius: 31, fan: 'low', swing: 'off' }, limits),
  ).toThrow();
  const broken = [...frame.bytes];
  broken[7] = 0;
  expect(() => decodeAcStateV1(broken)).toThrow();
});

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
  );
  expect(profile.status).toBe('experimental');
  expect(() =>
    parseProfile({
      name: 'Missing licence',
      category: 'tv',
      status: 'experimental',
      provenance: 'Unknown source.',
      protocol: 'ha_remote',
      version: 1,
      commands: {},
    }),
  ).toThrow();
});

test('unknown power is not presented as a single toggle when on and off both exist', () => {
  const on: Capability = {
    id: 'power_on',
    label: 'On',
    kind: 'discrete',
    confirmation: 'transmission_only',
    idempotent: false,
    available: true,
  };
  const off = { ...on, id: 'power_off', label: 'Off' };
  const unknown: DeviceState = {
    values: {},
    source: 'none',
    confidence: 'unknown',
    observedAt: null,
    lastCommandId: null,
  };
  expect(powerPlan([on, off], unknown).mode).toBe('discrete-pair');
  expect(
    powerPlan([on, off], { ...unknown, values: { power: true }, confidence: 'confirmed' }).mode,
  ).toBe('single');
});
