import fs from 'node:fs'
import path from 'node:path'

export interface AppConfig {
  port: number
  host: string
  dataDir: string
  staticDir: string | null
  publicOrigins: string[]
  cookieSecure: boolean
  pairingCode: string | null
  haBaseUrl: string | null
  haToken: string | null
  deadlineMs: number
  coalesceMs: number
  learnTimeoutMs: number
  trustProxy: boolean
  irRaw: { domain: string; service: string; entityId: string } | null
  version: string
}

export function loadEnvFile(file = path.resolve('.env')): void {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const irDomain = env.IR_RAW_DOMAIN?.trim() ?? ''
  const irService = env.IR_RAW_SERVICE?.trim() ?? ''
  const irEntity = env.IR_RAW_ENTITY_ID?.trim() ?? ''
  const irReady = irDomain && irService && irEntity
  return {
    port: numberEnv(env.PORT, 8787),
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR?.trim() || './data'),
    staticDir: env.STATIC_DIR?.trim() ? path.resolve(env.STATIC_DIR.trim()) : null,
    publicOrigins: (env.PUBLIC_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieSecure: env.COOKIE_SECURE === 'true',
    pairingCode: blankToNull(env.PAIRING_CODE),
    haBaseUrl: blankToNull(env.HA_BASE_URL),
    haToken: blankToNull(env.HA_TOKEN),
    deadlineMs: numberEnv(env.COMMAND_DEADLINE_MS, 2000),
    coalesceMs: numberEnv(env.COALESCE_MS, 200),
    learnTimeoutMs: numberEnv(env.LEARN_TIMEOUT_MS, 20_000),
    trustProxy: env.TRUST_PROXY === 'true',
    irRaw: irReady ? { domain: irDomain, service: irService, entityId: irEntity } : null,
    version: '1.0.0',
  }
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
