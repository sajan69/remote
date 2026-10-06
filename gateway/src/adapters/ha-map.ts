import {
  emptyState,
  labelFor,
  repeatFor,
  type Capability,
  type Category,
  type ConfirmationMode,
  type DeviceState,
  type UnsupportedControl,
} from '@remote/protocol'

export interface HaEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
  last_updated?: string
}

export interface DiscoveryEntity {
  connectionId: string
  name: string
  domain: string
  deviceClass: string | null
  suggestedCategory: Category
  allowedCategories: Category[]
  confirmation: ConfirmationMode
  capabilities: Capability[]
  unsupported: UnsupportedControl[]
  state: DeviceState
  learnSupported: boolean
  simulated: boolean
}

export const MEDIA_FEATURES = {
  PAUSE: 1,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  PLAY: 16384,
} as const

export const CLIMATE_FEATURES = {
  TARGET_TEMPERATURE: 1,
  FAN_MODE: 8,
  SWING_MODE: 32,
  TURN_OFF: 128,
  TURN_ON: 256,
} as const

export const FAN_FEATURES = {
  SET_SPEED: 1,
  OSCILLATE: 2,
  TURN_OFF: 16,
  TURN_ON: 32,
} as const

const SUPPORTED_DOMAINS = new Set(['media_player', 'climate', 'fan', 'light', 'remote'])

export function describeEntity(entity: HaEntity): DiscoveryEntity | null {
  const domain = entity.entity_id.split('.')[0] ?? ''
  if (!SUPPORTED_DOMAINS.has(domain)) return null
  const deviceClass = stringAttr(entity.attributes.device_class)
  const features = numberAttr(entity.attributes.supported_features) ?? 0
  const observedAt = entity.last_updated ?? entity.last_changed ?? null
  const unavailable = entity.state === 'unavailable' || entity.state === 'unknown'
  const category = suggestCategory(domain, deviceClass)
  const confirmation = defaultConfirmation(domain)
  const values = unavailable ? {} : readValues(domain, entity)
  const built = buildCapabilities(domain, entity, features, confirmation)
  return {
    connectionId: entity.entity_id,
    name: stringAttr(entity.attributes.friendly_name) ?? entity.entity_id,
    domain,
    deviceClass,
    suggestedCategory: category.suggested,
    allowedCategories: category.allowed,
    confirmation,
    capabilities: built.capabilities,
    unsupported: built.unsupported,
    state: presentState(values, confirmation, unavailable ? null : observedAt),
    learnSupported: domain === 'remote' && has(features, 1),
    simulated: false,
  }
}

export function presentState(
  values: Record<string, unknown>,
  confirmation: ConfirmationMode,
  observedAt: string | null,
): DeviceState {
  if (Object.keys(values).length === 0) {
    return emptyState('No current state is available.')
  }
  if (confirmation === 'transmission_only') {
    return {
      values,
      source: 'adapter',
      confidence: 'assumed',
      observedAt,
      lastCommandId: null,
      note: 'Reported by the integration. This is not treated as proof for one-way infrared.',
    }
  }
  return {
    values,
    source: 'adapter',
    confidence: 'confirmed',
    observedAt,
    lastCommandId: null,
  }
}

export function defaultConfirmation(domain: string): ConfirmationMode {
  return domain === 'climate' || domain === 'remote' ? 'transmission_only' : 'state'
}

function suggestCategory(
  domain: string,
  deviceClass: string | null,
): { suggested: Category; allowed: Category[] } {
  if (domain === 'climate') return { suggested: 'ac', allowed: ['ac'] }
  if (domain === 'fan') return { suggested: 'fan', allowed: ['fan'] }
  if (domain === 'light') return { suggested: 'light', allowed: ['light'] }
  if (domain === 'remote') {
    return {
      suggested: 'generic',
      allowed: ['tv', 'fan', 'soundbar', 'projector', 'set_top_box', 'generic'],
    }
  }
  const media: Category[] = ['tv', 'soundbar', 'projector', 'set_top_box']
  if (deviceClass === 'speaker' || deviceClass === 'receiver') {
    return { suggested: 'soundbar', allowed: media }
  }
  if (deviceClass === 'projector') return { suggested: 'projector', allowed: media }
  if (deviceClass === 'tv') return { suggested: 'tv', allowed: media }
  return { suggested: 'tv', allowed: media }
}

function buildCapabilities(
  domain: string,
  entity: HaEntity,
  features: number,
  confirmation: ConfirmationMode,
): { capabilities: Capability[]; unsupported: UnsupportedControl[] } {
  if (domain === 'media_player') return mediaCapabilities(entity, features, confirmation)
  if (domain === 'climate') return climateCapabilities(entity, features, confirmation)
  if (domain === 'fan') return fanCapabilities(entity, features, confirmation)
  if (domain === 'light') return lightCapabilities(entity, confirmation)
  return remoteCapabilities(entity, features, confirmation)
}

function mediaCapabilities(
  entity: HaEntity,
  features: number,
  confirmation: ConfirmationMode,
): { capabilities: Capability[]; unsupported: UnsupportedControl[] } {
  const capabilities: Capability[] = []
  const unsupported: UnsupportedControl[] = []
  if (has(features, MEDIA_FEATURES.TURN_ON)) capabilities.push(discrete('power_on', confirmation))
  else unsupported.push(missing('power_on', 'This entity does not advertise turning on.'))
  if (has(features, MEDIA_FEATURES.TURN_OFF)) capabilities.push(discrete('power_off', confirmation))
  else unsupported.push(missing('power_off', 'This entity does not advertise turning off.'))
  if (has(features, MEDIA_FEATURES.VOLUME_STEP)) {
    capabilities.push(discrete('volume_up', confirmation), discrete('volume_down', confirmation))
  } else if (has(features, 4)) {
    capabilities.push(rangeCap('volume', confirmation, { min: 0, max: 100, step: 1, unit: '%' }, true))
  } else {
    unsupported.push(missing('volume_up', 'This entity does not advertise volume.'))
  }
  if (has(features, MEDIA_FEATURES.VOLUME_MUTE)) {
    capabilities.push(toggle('mute', confirmation))
  } else {
    unsupported.push(missing('mute', 'This entity does not advertise mute.'))
  }
  const sources = stringList(entity.attributes.source_list)
  if (has(features, MEDIA_FEATURES.SELECT_SOURCE) && sources.length > 0) {
    capabilities.push(enumCap('input', confirmation, sources))
  } else {
    unsupported.push(missing('input', 'This entity does not advertise input selection.'))
  }
  if (has(features, MEDIA_FEATURES.PLAY)) capabilities.push(discrete('play', confirmation))
  if (has(features, MEDIA_FEATURES.PAUSE)) capabilities.push(discrete('pause', confirmation))
  if (has(features, MEDIA_FEATURES.STOP)) capabilities.push(discrete('stop', confirmation))
  if (has(features, MEDIA_FEATURES.NEXT_TRACK)) capabilities.push(discrete('next', confirmation))
  if (has(features, MEDIA_FEATURES.PREVIOUS_TRACK)) capabilities.push(discrete('previous', confirmation))
  for (const id of ['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'menu', 'channel_up', 'channel_down']) {
    unsupported.push(
      missing(id, 'Navigation and channel buttons need a remote profile or a bridge that advertises them.'),
    )
  }
  return { capabilities, unsupported }
}

function climateCapabilities(
  entity: HaEntity,
  features: number,
  confirmation: ConfirmationMode,
): { capabilities: Capability[]; unsupported: UnsupportedControl[] } {
  const capabilities: Capability[] = []
  const unsupported: UnsupportedControl[] = []
  const modes = stringList(entity.attributes.hvac_modes).filter((mode) => mode !== 'off')
  const fans = stringList(entity.attributes.fan_modes)
  const swings = stringList(entity.attributes.swing_modes)
  const min = numberAttr(entity.attributes.min_temp)
  const max = numberAttr(entity.attributes.max_temp)
  const step = numberAttr(entity.attributes.target_temp_step) ?? 1
  if (has(features, CLIMATE_FEATURES.TURN_ON)) capabilities.push(discrete('power_on', confirmation))
  else unsupported.push(missing('power_on', 'This climate entity does not advertise turning on.'))
  if (has(features, CLIMATE_FEATURES.TURN_OFF)) capabilities.push(discrete('power_off', confirmation))
  else unsupported.push(missing('power_off', 'This climate entity does not advertise turning off.'))

  const fields: Capability['stateFields'] = []
  if (has(features, CLIMATE_FEATURES.TURN_ON) || has(features, CLIMATE_FEATURES.TURN_OFF)) {
    fields.push({ id: 'power', label: 'Power', kind: 'boolean' })
  }
  if (modes.length > 0) fields.push({ id: 'mode', label: 'Mode', kind: 'enum', values: modes })
  else unsupported.push(missing('mode', 'No operating modes were advertised.'))
  if (has(features, CLIMATE_FEATURES.TARGET_TEMPERATURE) && min !== null && max !== null && min < max) {
    fields.push({ id: 'temperature', label: 'Temperature', kind: 'number', min, max, step, unit: '°C' })
  } else {
    unsupported.push(missing('temperature', 'No target temperature range was advertised.'))
  }
  if (has(features, CLIMATE_FEATURES.FAN_MODE) && fans.length > 0) {
    fields.push({ id: 'fan', label: 'Fan', kind: 'enum', values: fans })
  } else {
    unsupported.push(missing('fan', 'No fan speeds were advertised.'))
  }
  if (has(features, CLIMATE_FEATURES.SWING_MODE) && swings.length > 0) {
    fields.push({ id: 'swing', label: 'Swing', kind: 'enum', values: swings })
  } else {
    unsupported.push(missing('swing', 'No swing settings were advertised.'))
  }
  if (fields.some((field) => field.id === 'temperature' || field.id === 'mode')) {
    capabilities.push({
      id: 'climate.set',
      label: 'Settings',
      kind: 'state',
      confirmation,
      idempotent: true,
      available: true,
      stateFields: fields,
    })
  }
  return { capabilities, unsupported }
}

function fanCapabilities(
  entity: HaEntity,
  features: number,
  confirmation: ConfirmationMode,
): { capabilities: Capability[]; unsupported: UnsupportedControl[] } {
  const capabilities: Capability[] = []
  const unsupported: UnsupportedControl[] = []
  if (has(features, FAN_FEATURES.TURN_ON)) capabilities.push(discrete('power_on', confirmation))
  else unsupported.push(missing('power_on', 'This fan does not advertise turning on.'))
  if (has(features, FAN_FEATURES.TURN_OFF)) capabilities.push(discrete('power_off', confirmation))
  else unsupported.push(missing('power_off', 'This fan does not advertise turning off.'))
  if (has(features, FAN_FEATURES.SET_SPEED)) {
    const step = numberAttr(entity.attributes.percentage_step) ?? 1
    capabilities.push(rangeCap('fan.speed', confirmation, { min: step, max: 100, step, unit: '%' }, true))
  } else {
    unsupported.push(missing('fan.speed', 'This fan does not advertise a speed.'))
  }
  if (has(features, FAN_FEATURES.OSCILLATE)) capabilities.push(toggle('fan.oscillate', confirmation))
  else unsupported.push(missing('fan.oscillate', 'This fan does not advertise oscillation.'))
  return { capabilities, unsupported }
}

function lightCapabilities(
  entity: HaEntity,
  confirmation: ConfirmationMode,
): { capabilities: Capability[]; unsupported: UnsupportedControl[] } {
  const capabilities = [discrete('power_on', confirmation), discrete('power_off', confirmation)]
  const unsupported: UnsupportedControl[] = []
  const modes = stringList(entity.attributes.supported_color_modes)
  const dimmable = modes.some((mode) => mode !== 'onoff')
  if (dimmable) {
    capabilities.push(rangeCap('light.brightness', confirmation, { min: 1, max: 100, step: 1, unit: '%' }, true))
  } else {
    unsupported.push(missing('light.brightness', 'This light does not advertise brightness.'))
  }
  const minKelvin = numberAttr(entity.attributes.min_color_temp_kelvin)
  const maxKelvin = numberAttr(entity.attributes.max_color_temp_kelvin)
  if (modes.includes('color_temp') && minKelvin !== null && maxKelvin !== null && minKelvin < maxKelvin) {
    capabilities.push(
      rangeCap(
        'light.color_temp',
        confirmation,
        { min: minKelvin, max: maxKelvin, step: 50, unit: 'K' },
        true,
      ),
    )
  } else if (modes.includes('color_temp')) {
    unsupported.push(missing('light.color_temp', 'Colour temperature limits were not advertised.'))
  }
  return { capabilities, unsupported }
}

function remoteCapabilities(
  entity: HaEntity,
  features: number,
  confirmation: ConfirmationMode,
): { capabilities: Capability[]; unsupported: UnsupportedControl[] } {
  const capabilities = [discrete('power_on', confirmation), discrete('power_off', confirmation)]
  const unsupported = [
    missing('volume_up', 'Volume buttons appear after you learn or import commands for this bridge.'),
    missing('up', 'Navigation appears after you learn or import commands for this bridge.'),
  ]
  const activities = stringList(entity.attributes.activity_list ?? entity.attributes.current_activity)
  if (has(features, 4) && activities.length > 0) capabilities.push(enumCap('activity', confirmation, activities))
  return { capabilities, unsupported }
}

function readValues(domain: string, entity: HaEntity): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  if (domain === 'media_player') {
    const power = mediaPower(entity.state)
    if (power !== undefined) values.power = power
    if (typeof entity.attributes.is_volume_muted === 'boolean') values.muted = entity.attributes.is_volume_muted
    if (typeof entity.attributes.volume_level === 'number') {
      values.volume = Math.round(entity.attributes.volume_level * 100)
    }
    if (typeof entity.attributes.source === 'string') values.input = entity.attributes.source
    return values
  }
  if (domain === 'climate') {
    values.power = entity.state !== 'off'
    if (entity.state !== 'off') values.mode = entity.state
    if (typeof entity.attributes.temperature === 'number') values.temperature = entity.attributes.temperature
    if (typeof entity.attributes.fan_mode === 'string') values.fan = entity.attributes.fan_mode
    if (typeof entity.attributes.swing_mode === 'string') values.swing = entity.attributes.swing_mode
    if (typeof entity.attributes.current_temperature === 'number') {
      values.roomTemperature = entity.attributes.current_temperature
    }
    return values
  }
  if (domain === 'fan') {
    values.power = entity.state === 'on'
    if (typeof entity.attributes.percentage === 'number') values.percentage = entity.attributes.percentage
    if (typeof entity.attributes.oscillating === 'boolean') values.oscillating = entity.attributes.oscillating
    return values
  }
  if (domain === 'light') {
    values.power = entity.state === 'on'
    if (typeof entity.attributes.brightness === 'number') {
      values.brightness = Math.max(1, Math.round((entity.attributes.brightness / 255) * 100))
    }
    if (typeof entity.attributes.color_temp_kelvin === 'number') {
      values.colorTemp = entity.attributes.color_temp_kelvin
    }
    return values
  }
  if (entity.state === 'on' || entity.state === 'off') values.power = entity.state === 'on'
  return values
}

function mediaPower(state: string): boolean | undefined {
  if (state === 'off' || state === 'standby') return false
  if (['on', 'idle', 'playing', 'paused', 'buffering'].includes(state)) return true
  return undefined
}

function discrete(id: string, confirmation: ConfirmationMode): Capability {
  const repeat = repeatFor(id, 'resend_frame')
  return {
    id,
    label: labelFor(id),
    kind: 'discrete',
    confirmation,
    idempotent: false,
    available: true,
    ...(repeat ? { repeat } : {}),
  }
}

function toggle(id: string, confirmation: ConfirmationMode): Capability {
  return {
    id,
    label: labelFor(id),
    kind: 'toggle',
    confirmation,
    idempotent: false,
    available: true,
  }
}

function rangeCap(
  id: string,
  confirmation: ConfirmationMode,
  range: NonNullable<Capability['range']>,
  idempotent: boolean,
): Capability {
  return {
    id,
    label: labelFor(id),
    kind: 'range',
    confirmation,
    idempotent,
    available: true,
    range,
  }
}

function enumCap(id: string, confirmation: ConfirmationMode, values: string[]): Capability {
  return {
    id,
    label: labelFor(id),
    kind: 'enum',
    confirmation,
    idempotent: true,
    available: true,
    enumValues: values.slice(0, 40),
  }
}

function missing(id: string, reason: string): UnsupportedControl {
  return { id, label: labelFor(id), reason }
}

function has(mask: number, bit: number): boolean {
  return (mask & bit) === bit
}

function stringAttr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberAttr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length < 80)
}
