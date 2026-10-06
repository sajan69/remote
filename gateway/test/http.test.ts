import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@jest/globals';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

test('pairing, origin checks, demo commands, and exports stay honest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-http-'));
  const app = await createApp(
    loadConfig({
      DATA_DIR: dir,
      PUBLIC_ORIGINS: 'http://localhost',
      COOKIE_SECURE: 'false',
      PAIRING_CODE: 'ABCD-EFGH',
      COMMAND_DEADLINE_MS: '2000',
      COALESCE_MS: '0',
      HA_BASE_URL: 'http://homeassistant.local:8123',
      HA_TOKEN: 'super-secret-token-value',
    }),
  );
  await listen(app.server);
  const base = `http://127.0.0.1:${portOf(app.server)}`;
  try {
    const closed = await fetch(`${base}/api/devices`);
    expect(closed.status).toBe(401);

    const badOrigin = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'x-remote-client': '1',
      },
      body: JSON.stringify({ code: 'ABCD-EFGH' }),
    });
    expect(badOrigin.status).toBe(403);

    const wrong = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }),
    });
    expect(wrong.status).toBe(401);

    const paired = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ code: 'ABCD-EFGH' }),
    });
    expect(paired.status).toBe(200);
    const cookie = paired.headers
      .getSetCookie()
      .find((value) => value.startsWith('remote_session='));
    expect(cookie).toBeTruthy();
    if (!cookie) throw new Error('expected a session cookie');
    const session = cookie.split(';')[0] ?? '';

    const demo = await fetch(`${base}/api/demo`, {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: session },
      body: JSON.stringify({ enabled: true }),
    });
    const demoBody = (await demo.json()) as {
      devices: Array<{ id: string; connectionId: string; simulated: boolean }>;
    };
    const tv = demoBody.devices.find((device) => device.connectionId === 'demo:tv');
    expect(tv?.simulated).toBe(true);
    if (!tv) throw new Error('expected a demo tv');

    const sent = await fetch(`${base}/api/devices/${tv.id}/commands`, {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: session },
      body: JSON.stringify({
        id: 'cmd-demo01',
        capability: 'volume_up',
        arguments: {},
        sequence: 1,
      }),
    });
    expect(sent.status).toBe(202);
    await waitFor(async () => {
      const follow = await fetch(`${base}/api/commands/cmd-demo01`, {
        headers: { cookie: session, origin: 'http://localhost' },
      });
      const body = (await follow.json()) as { command: { status: string; simulated: boolean } };
      return body.command.status === 'transmitted' && body.command.simulated;
    });

    const exported = await fetch(`${base}/api/export`, {
      headers: { cookie: session, origin: 'http://localhost' },
    });
    const exportText = await exported.text();
    expect(exportText.includes('super-secret-token-value')).toBe(false);
    expect(exportText.includes('ABCD-EFGH')).toBe(false);
  } finally {
    await app.close();
  }
});

function jsonHeaders(): Record<string, string> {
  return { origin: 'http://localhost', 'content-type': 'application/json', 'x-remote-client': '1' };
}

function listen(server: import('node:http').Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
}

function portOf(server: import('node:http').Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return address.port;
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the command');
}
