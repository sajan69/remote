import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceRecord } from '@remote/protocol';
import { expect, test } from '@jest/globals';
import { CommandService, type ExecuteResult } from '../src/commands.ts';
import { Hub } from '../src/hub.ts';
import { Store } from '../src/store.ts';

test('commands keep order, collapse duplicate ids, expire, and do not replay an unknown result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-commands-'));
  const store = await Store.open(dir, 'TEST-CODE');
  const device = sampleDevice();
  store.mutate((data) => {
    data.devices.push(device);
  });
  const calls: string[] = [];
  const service = new CommandService({
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    deadlineMs: 2000,
    coalesceMs: 0,
    store,
    hub: new Hub(),
    execute: async (_device, command) => {
      calls.push(command.id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (command.id === 'cmd-unknown') {
        const result: ExecuteResult = {
          kind: 'unknown',
          code: 'transmission_timeout',
          message: 'Unclear.',
        };
        return result;
      }
      return { kind: 'transmitted', confirmed: true, statePatch: { power: true } };
    },
  });

  service.submit(input(device, 'cmd-first0', 1));
  service.submit(input(device, 'cmd-second', 2));
  const duplicate = service.submit(input(device, 'cmd-first0', 1));
  expect(duplicate.id).toBe('cmd-first0');
  await service.whenIdle();
  expect(calls).toEqual(['cmd-first0', 'cmd-second']);

  const unknown = service.submit(input(device, 'cmd-unknown', 3));
  await service.whenIdle();
  expect(unknown.status).toBe('outcome_unknown');
  expect(calls.filter((id) => id === 'cmd-unknown')).toHaveLength(1);
  expect(store.data.devices[0]?.state.confidence).toBe('confirmed');
});

test('a deadline of zero drops the command before transmission', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-expire-'));
  const store = await Store.open(dir, 'TEST-CODE');
  const device = sampleDevice();
  store.mutate((data) => data.devices.push(device));
  let calls = 0;
  const service = new CommandService({
    now: () => Date.now(),
    delay: () => Promise.resolve(),
    deadlineMs: 0,
    coalesceMs: 0,
    store,
    hub: new Hub(),
    execute: () => {
      calls += 1;
      return Promise.resolve({ kind: 'transmitted' });
    },
  });
  const command = service.submit(input(device, 'cmd-expire', 1));
  await service.whenIdle();
  expect(calls).toBe(0);
  expect(command.status).toBe('failed');
  expect(command.error?.code).toBe('expired');
});

test('rapid air-conditioner updates send only the latest complete state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-coalesce-'));
  const store = await Store.open(dir, 'TEST-CODE');
  const device = sampleDevice();
  device.capabilities.push({
    id: 'climate.set',
    label: 'Settings',
    kind: 'state',
    confirmation: 'transmission_only',
    idempotent: true,
    available: true,
    stateFields: [
      { id: 'power', label: 'Power', kind: 'boolean' },
      { id: 'temperature', label: 'Temperature', kind: 'number', min: 16, max: 30, step: 1 },
    ],
  });
  store.mutate((data) => data.devices.push(device));
  const sent: number[] = [];
  const service = new CommandService({
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    deadlineMs: 2000,
    coalesceMs: 40,
    store,
    hub: new Hub(),
    execute: (_device, command) => {
      sent.push(Number(command.arguments.temperature));
      return Promise.resolve({
        kind: 'transmitted',
        statePatch: { temperature: command.arguments.temperature },
      });
    },
  });
  service.submit(climate(device, 'cmd-temp16', 1, 16));
  service.submit(climate(device, 'cmd-temp17', 2, 17));
  service.submit(climate(device, 'cmd-temp18', 3, 18));
  await service.whenIdle();
  expect(sent).toEqual([18]);
  expect(store.data.commands.find((command) => command.id === 'cmd-temp16')?.error?.code).toBe(
    'coalesced',
  );
  expect(store.data.devices[0]?.state.values.temperature).toBe(18);
  expect(store.data.devices[0]?.state.confidence).toBe('assumed');
});

function sampleDevice(): DeviceRecord {
  return {
    id: 'device-test',
    name: 'Test TV',
    room: 'Lab',
    category: 'tv',
    adapterId: 'demo',
    connectionId: 'demo:tv',
    profileId: null,
    confirmation: 'state',
    simulated: false,
    favorite: false,
    sortIndex: 0,
    learnSupported: false,
    profileStatus: 'untested',
    userConfirmedAt: null,
    testCommandId: null,
    capabilities: [
      {
        id: 'power_on',
        label: 'On',
        kind: 'discrete',
        confirmation: 'state',
        idempotent: false,
        available: true,
      },
    ],
    state: {
      values: {},
      source: 'none',
      confidence: 'unknown',
      observedAt: null,
      lastCommandId: null,
    },
    lastSequence: 0,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

function input(device: DeviceRecord, id: string, sequence: number) {
  return { device, id, capability: 'power_on', arguments: {}, sequence };
}

function climate(device: DeviceRecord, id: string, sequence: number, temperature: number) {
  return {
    device,
    id,
    capability: 'climate.set',
    arguments: { power: true, temperature },
    sequence,
  };
}
