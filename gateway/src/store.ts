import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandRecord, DeviceRecord, DiagnosticEntry, Profile } from '@remote/protocol';
import type { DiscoveryEntity } from './adapters/ha-map.ts';

export interface Session {
  id: string;
  tokenHash: string;
  label: string;
  createdAt: string;
  expiresAt: string;
}

export interface PendingLearn {
  id: string;
  deviceId: string;
  capability: string;
  commandName: string;
  at: string;
}

interface HomeAssistantConfig {
  baseUrl: string;
  token: string;
}

interface Persisted {
  schemaVersion: 1;
  pairingSalt: string;
  pairingHash: string;
  sessions: Session[];
  devices: DeviceRecord[];
  commands: CommandRecord[];
  profiles: Profile[];
  diagnostics: DiagnosticEntry[];
  integrations: { homeAssistant?: HomeAssistantConfig };
  discovery: DiscoveryEntity[];
  discoveryAt: string | null;
  demoEnabled: boolean;
  pendingLearns: PendingLearn[];
  trialSequences: Record<string, number>;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Store {
  readonly data: Persisted;
  readonly pairingCode: string | null;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    data: Persisted,
    pairingCode: string | null,
  ) {
    this.data = data;
    this.pairingCode = pairingCode;
  }

  static async open(dataDir: string, configuredCode: string | null): Promise<Store> {
    await fs.promises.mkdir(dataDir, { recursive: true });
    const file = path.join(dataDir, 'gateway.json');
    const codeFile = path.join(dataDir, 'pairing-code.txt');
    const data = fs.existsSync(file) ? readPersisted(file) : fresh();
    const pairingCode = reconcilePairingCode(data, codeFile, configuredCode);
    const store = new Store(file, data, pairingCode);
    store.persist();
    await store.flush();
    return store;
  }

  mutate(fn: (data: Persisted) => void): void {
    fn(this.data);
    this.persist();
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  private persist(): void {
    const snapshot = structuredClone(this.data);
    const file = this.file;
    this.writeChain = this.writeChain.then(() => atomicWrite(file, snapshot));
  }
}

export function hashSecret(value: string, salt = ''): string {
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

export function timingSafeHexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function generatePairingCode(): string {
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function reconcilePairingCode(
  data: Persisted,
  codeFile: string,
  configuredCode: string | null,
): string | null {
  const configured = normalizeCode(configuredCode);
  if (configured) {
    data.pairingSalt = crypto.randomBytes(16).toString('hex');
    data.pairingHash = hashSecret(configured, data.pairingSalt);
    fs.writeFileSync(codeFile, `${configured}\n`, { mode: 0o600 });
    return configured;
  }
  const fromFile = fs.existsSync(codeFile)
    ? normalizeCode(fs.readFileSync(codeFile, 'utf8'))
    : null;
  if (fromFile && timingSafeHexEqual(hashSecret(fromFile, data.pairingSalt), data.pairingHash)) {
    return fromFile;
  }
  if (!data.pairingHash) {
    const generated = generatePairingCode();
    data.pairingSalt = crypto.randomBytes(16).toString('hex');
    data.pairingHash = hashSecret(generated, data.pairingSalt);
    fs.writeFileSync(codeFile, `${generated}\n`, { mode: 0o600 });
    return generated;
  }
  return null;
}

export function normalizeCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 8) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function fresh(): Persisted {
  return {
    schemaVersion: 1,
    pairingSalt: '',
    pairingHash: '',
    sessions: [],
    devices: [],
    commands: [],
    profiles: [],
    diagnostics: [],
    integrations: {},
    discovery: [],
    discoveryAt: null,
    demoEnabled: false,
    pendingLearns: [],
    trialSequences: {},
  };
}

function readPersisted(file: string): Persisted {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    throw new Error(`Gateway data at ${file} is not valid JSON. It was left unchanged.`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error(`Gateway data at ${file} is an unsupported schema. It was left unchanged.`);
  }
  const base = fresh();
  return {
    ...base,
    ...(parsed as unknown as Persisted),
    schemaVersion: 1,
    integrations: isRecord(parsed.integrations) ? parsed.integrations : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function atomicWrite(file: string, data: Persisted): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}
