import type {
  Capability,
  Category,
  CommandRecord,
  ConfirmationMode,
  DeviceRecord,
  DeviceState,
} from '@remote/protocol';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DiscoveryEntity {
  connectionId: string;
  name: string;
  domain: string;
  suggestedCategory: Category;
  allowedCategories: Category[];
  confirmation: ConfirmationMode;
  capabilities: Capability[];
  unsupported: Array<{ id: string; label: string; reason: string }>;
  state: DeviceState;
  learnSupported: boolean;
  simulated: boolean;
}

export interface GatewayStatus {
  version: string;
  demoEnabled: boolean;
  homeAssistant: {
    configured: boolean;
    baseUrl: string | null;
    reachable: boolean;
    message: string;
  };
  irRaw: { configured: boolean };
  sessions: number;
}

let inFlight = 0;

export function commandsActive(): boolean {
  return inFlight > 0;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = init.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-remote-client', '1');
  if (init.body) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'gateway_unreachable', 'The gateway is unreachable. Nothing was queued.');
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string; message?: string }) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error ?? 'request_failed',
      body.message ?? 'The gateway request failed.',
    );
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string; version: string }>('/api/health'),
  session: () => request<{ paired: boolean; label: string; expiresAt: string }>('/api/session'),
  pair: (code: string) =>
    request<{ paired: boolean }>('/api/pair', {
      method: 'POST',
      body: JSON.stringify({ code, label: 'This phone' }),
    }),
  signOut: () => request<{ paired: boolean }>('/api/session', { method: 'DELETE' }),
  revokeAll: () =>
    request<{ paired: boolean }>('/api/sessions/revoke-all', { method: 'POST', body: '{}' }),
  status: () => request<GatewayStatus>('/api/status'),
  devices: () => request<{ devices: DeviceRecord[]; demoEnabled: boolean }>('/api/devices'),
  discover: () =>
    request<{ entities: DiscoveryEntity[] }>('/api/discovery', { method: 'POST', body: '{}' }),
  trial: (body: Record<string, unknown>) =>
    request<{ command: CommandRecord }>('/api/trial', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createDevice: (body: Record<string, unknown>) =>
    request<{ device: DeviceRecord }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchDevice: (id: string, body: Record<string, unknown>) =>
    request<{ device: DeviceRecord }>(`/api/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeDevice: (id: string) =>
    request<{ removed: boolean }>(`/api/devices/${id}`, { method: 'DELETE' }),
  command: async (id: string, body: Record<string, unknown>) => {
    inFlight += 1;
    try {
      return await request<{ command: CommandRecord }>(`/api/devices/${id}/commands`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } finally {
      inFlight -= 1;
    }
  },
  cancel: (id: string) =>
    request<{ command: CommandRecord }>(`/api/commands/${id}`, { method: 'DELETE' }),
  refreshAll: () =>
    request<{ devices: DeviceRecord[] }>('/api/refresh', { method: 'POST', body: '{}' }),
  refreshOne: (id: string) =>
    request<{ device: DeviceRecord }>(`/api/devices/${id}/refresh`, { method: 'POST', body: '{}' }),
  demo: (enabled: boolean) =>
    request<{ demoEnabled: boolean; devices: DeviceRecord[] }>('/api/demo', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  learn: (id: string, body: Record<string, unknown>) =>
    request<{ captured: boolean; capability: string; commandName: string }>(
      `/api/devices/${id}/learn`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  saveLearned: (id: string, body: Record<string, unknown>) =>
    request<{ device: DeviceRecord }>(`/api/devices/${id}/learned`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  profiles: () => request<{ profiles: unknown[] }>('/api/profiles'),
  importProfile: (profile: unknown) =>
    request('/api/profiles', { method: 'POST', body: JSON.stringify(profile) }),
  diagnostics: () =>
    request<{ entries: Array<{ id: string; at: string; code: string; message: string }> }>(
      '/api/diagnostics',
    ),
  exportConfig: () => request<Record<string, unknown>>('/api/export'),
  reset: (confirm: string) =>
    request<{ pairingCode: string }>('/api/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),
};

export function eventsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/events`;
}
