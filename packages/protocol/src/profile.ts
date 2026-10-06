import { CATEGORIES, type Category, type Profile, type ProfileCommand } from './types.ts'

const MAX_PROFILE_CHARS = 65_536
const STATUSES = new Set(['user_confirmed', 'experimental', 'learned', 'unsupported'])
const PROTOCOLS = new Set(['ha_remote', 'nec', 'raw', 'ac_state_v1'])

export function parseProfile(input: unknown, options?: { id?: string; forceExperimental?: boolean }): Profile {
  const encoded = JSON.stringify(input)
  if (encoded.length > MAX_PROFILE_CHARS) {
    throw new Error('That profile is too large.')
  }
  if (!isRecord(input)) throw new Error('A profile must be an object.')

  const name = readText(input.name, 'Name', 80)
  const category = readCategory(input.category)
  const provenance = readText(input.provenance, 'Provenance', 400)
  const licence = readText(input.licence, 'Licence', 400)
  const protocol = readProtocol(input.protocol)
  const version = input.version
  if (version !== 1) throw new Error('Only profile version 1 is supported.')

  let status = typeof input.status === 'string' ? input.status : ''
  if (!STATUSES.has(status)) throw new Error('Profile status is missing or unknown.')
  if (options?.forceExperimental) status = 'experimental'
  if (status === 'unsupported') throw new Error('An unsupported profile cannot be imported.')

  const commands = readCommands(input.commands, protocol)
  const ac = protocol === 'ac_state_v1' ? readAc(input.ac) : null
  if (protocol === 'ac_state_v1' && Object.keys(commands).length > 0) {
    throw new Error('A protocol-aware air-conditioner profile uses its encoder, not captured buttons.')
  }

  const tested = Array.isArray(input.testedCapabilities)
    ? input.testedCapabilities.filter((item): item is string => typeof item === 'string').slice(0, 80)
    : []

  return {
    id: options?.id ?? readId(input.id),
    name,
    category,
    brand: optionalText(input.brand, 80),
    model: optionalText(input.model, 80),
    status: status as Profile['status'],
    provenance,
    licence,
    protocol,
    version: 1,
    commands,
    ac,
    testedCapabilities: tested,
  }
}

function readCommands(value: unknown, protocol: Profile['protocol']): Record<string, ProfileCommand> {
  if (!isRecord(value)) throw new Error('Profile commands must be an object.')
  const entries = Object.entries(value)
  if (entries.length > 80) throw new Error('A profile can contain at most 80 commands.')
  const commands: Record<string, ProfileCommand> = {}
  for (const [key, raw] of entries) {
    if (!/^[a-z0-9_]{1,40}$/.test(key)) throw new Error(`Command name ${key} is not allowed.`)
    commands[key] = readCommand(raw, protocol)
  }
  return commands
}

function readCommand(value: unknown, protocol: Profile['protocol']): ProfileCommand {
  if (!isRecord(value)) throw new Error('Each command must be an object.')
  if (protocol === 'ha_remote') {
    const command = readText(value.command, 'Command', 80)
    const device = optionalText(value.device, 80)
    return device ? { type: 'ha_remote', command, device } : { type: 'ha_remote', command }
  }
  if (protocol === 'nec') {
    if (!isByte(value.address) || !isByte(value.command)) {
      throw new Error('NEC commands need an address and command from 0 to 255.')
    }
    return { type: 'nec', address: value.address, command: value.command }
  }
  if (protocol === 'raw') {
    const carrierHz = value.carrierHz
    const timings = value.timingsUs
    if (typeof carrierHz !== 'number' || carrierHz < 20000 || carrierHz > 60000) {
      throw new Error('Raw commands need a carrier between 20 kHz and 60 kHz.')
    }
    if (!Array.isArray(timings) || timings.length < 2 || timings.length > 512) {
      throw new Error('Raw timings must contain between 2 and 512 numbers.')
    }
    if (timings.some((item) => !Number.isInteger(item) || item < 1 || item > 100_000)) {
      throw new Error('Each raw timing must be an integer from 1 to 100000 microseconds.')
    }
    return { type: 'raw', carrierHz, timingsUs: timings as number[] }
  }
  throw new Error('This protocol does not store individual button commands.')
}

function readAc(value: unknown): Profile['ac'] {
  if (!isRecord(value)) throw new Error('An air-conditioner profile needs temperature and mode limits.')
  const min = value.min
  const max = value.max
  const step = value.step
  if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number') {
    throw new Error('Temperature limits must be numbers.')
  }
  if (min < 0 || max > 40 || min > max || step <= 0 || step > 5) {
    throw new Error('Temperature limits are out of range.')
  }
  return {
    min,
    max,
    step,
    modes: readList(value.modes, 'modes'),
    fans: readList(value.fans, 'fans'),
    swings: readList(value.swings, 'swings'),
  }
}

function readList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error(`Profile ${name} are missing.`)
  }
  if (value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 40)) {
    throw new Error(`Profile ${name} contain an invalid entry.`)
  }
  return value as string[]
}

function readCategory(value: unknown): Category {
  if (typeof value !== 'string' || !CATEGORIES.includes(value as Category)) {
    throw new Error('Profile category is missing or unknown.')
  }
  return value as Category
}

function readProtocol(value: unknown): Profile['protocol'] {
  if (typeof value !== 'string' || !PROTOCOLS.has(value)) {
    throw new Error('Profile protocol is missing or unknown.')
  }
  return value as Profile['protocol']
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new Error('Profile id must be 8 to 80 letters, numbers, dashes, or underscores.')
  }
  return value
}

function readText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.length > max) {
    throw new Error(`${label} must be between 3 and ${max} characters.`)
  }
  return value.trim()
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > max) throw new Error('A text field is too long.')
  return value.trim()
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
