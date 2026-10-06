export const CATEGORIES = [
  'tv',
  'ac',
  'fan',
  'soundbar',
  'projector',
  'set_top_box',
  'light',
  'generic',
] as const

export type Category = (typeof CATEGORIES)[number]

export type ConfirmationMode = 'state' | 'transmission_only'

export type Confidence = 'confirmed' | 'assumed' | 'unknown'

export type CommandStatus =
  | 'queued_locally'
  | 'gateway_accepted'
  | 'transmitted'
  | 'appliance_confirmed'
  | 'failed'
  | 'outcome_unknown'

export type CapabilityKind = 'discrete' | 'toggle' | 'range' | 'enum' | 'state'

export interface RepeatSpec {
  intervalMs: number
  mode: 'protocol_repeat' | 'resend_frame'
  maxHoldMs: number
}

export interface RangeSpec {
  min: number
  max: number
  step: number
  unit?: string
}

export interface StateField {
  id: string
  label: string
  kind: 'boolean' | 'number' | 'enum'
  min?: number
  max?: number
  step?: number
  unit?: string
  values?: string[]
}

export interface Capability {
  id: string
  label: string
  kind: CapabilityKind
  confirmation: ConfirmationMode
  idempotent: boolean
  available: boolean
  unavailableReason?: string
  repeat?: RepeatSpec
  range?: RangeSpec
  enumValues?: string[]
  stateFields?: StateField[]
}

export interface UnsupportedControl {
  id: string
  label: string
  reason: string
}

export interface DeviceState {
  values: Record<string, unknown>
  source: 'adapter' | 'last_sent' | 'none'
  confidence: Confidence
  observedAt: string | null
  lastCommandId: string | null
  note?: string
}

export interface CommandError {
  code: string
  message: string
}

export interface CommandRecord {
  id: string
  deviceId: string
  capability: string
  arguments: Record<string, unknown>
  sequence: number
  createdAt: string
  expiresAt: string
  status: CommandStatus
  phase: 'queued' | 'sending' | 'done'
  error?: CommandError
  simulated: boolean
  idempotent: boolean
  trial?: {
    adapterId: string
    connectionId: string
    category: Category
  }
}

export type ProfileStatus = 'user_confirmed' | 'experimental' | 'learned' | 'unsupported'

export type ProfileCommand =
  | { type: 'ha_remote'; command: string; device?: string }
  | { type: 'nec'; address: number; command: number }
  | { type: 'raw'; carrierHz: number; timingsUs: number[] }

export interface AcLimits {
  min: number
  max: number
  step: number
  modes: string[]
  fans: string[]
  swings: string[]
}

export interface Profile {
  id: string
  name: string
  category: Category
  brand: string | null
  model: string | null
  status: ProfileStatus
  provenance: string
  licence: string
  protocol: 'ha_remote' | 'nec' | 'raw' | 'ac_state_v1'
  version: number
  commands: Record<string, ProfileCommand>
  ac: AcLimits | null
  testedCapabilities: string[]
}

export interface DeviceRecord {
  id: string
  name: string
  room: string
  category: Category
  adapterId: 'home_assistant' | 'demo'
  connectionId: string
  profileId: string | null
  confirmation: ConfirmationMode
  simulated: boolean
  favorite: boolean
  sortIndex: number
  learnSupported: boolean
  profileStatus: ProfileStatus | 'untested'
  userConfirmedAt: string | null
  testCommandId: string | null
  capabilities: Capability[]
  state: DeviceState
  lastSequence: number
  createdAt: string
  lastUsedAt: string | null
}

export interface DiagnosticEntry {
  id: string
  at: string
  code: string
  message: string
  deviceId?: string
}

export type PowerPlan =
  | { mode: 'discrete-pair'; on: Capability; off: Capability }
  | { mode: 'single'; capability: Capability; label: string; caution?: string }
  | { mode: 'none'; reason: string }
