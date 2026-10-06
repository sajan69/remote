import assert from 'node:assert/strict'
import test from 'node:test'
import { CLIMATE_FEATURES, describeEntity, FAN_FEATURES, MEDIA_FEATURES } from '../src/adapters/ha-map.ts'

test('media player controls follow advertised feature bits', () => {
  const described = describeEntity({
    entity_id: 'media_player.lounge_tv',
    state: 'on',
    attributes: {
      friendly_name: 'Lounge TV',
      device_class: 'tv',
      supported_features:
        MEDIA_FEATURES.TURN_ON |
        MEDIA_FEATURES.TURN_OFF |
        MEDIA_FEATURES.VOLUME_STEP |
        MEDIA_FEATURES.VOLUME_MUTE |
        MEDIA_FEATURES.PLAY,
    },
  })
  assert.ok(described)
  assert.equal(described.suggestedCategory, 'tv')
  assert.equal(described.confirmation, 'state')
  assert.deepEqual(
    described.capabilities.map((capability) => capability.id),
    ['power_on', 'power_off', 'volume_up', 'volume_down', 'mute', 'play'],
  )
  assert.equal(described.state.confidence, 'confirmed')
  assert.equal(described.state.values.power, true)
})

test('climate entities stay unconfirmed unless the user opts into measured state', () => {
  const described = describeEntity({
    entity_id: 'climate.bedroom',
    state: 'cool',
    attributes: {
      friendly_name: 'Bedroom',
      supported_features:
        CLIMATE_FEATURES.TARGET_TEMPERATURE |
        CLIMATE_FEATURES.FAN_MODE |
        CLIMATE_FEATURES.TURN_ON |
        CLIMATE_FEATURES.TURN_OFF,
      hvac_modes: ['off', 'cool', 'heat'],
      fan_modes: ['low', 'high'],
      min_temp: 18,
      max_temp: 30,
      target_temp_step: 1,
      temperature: 22,
      current_temperature: 25,
    },
  })
  assert.ok(described)
  assert.equal(described.confirmation, 'transmission_only')
  assert.equal(described.state.confidence, 'assumed')
  assert.equal(described.state.values.roomTemperature, 25)
  assert.equal(described.state.values.temperature, 22)
  const settings = described.capabilities.find((capability) => capability.id === 'climate.set')
  assert.ok(settings?.stateFields?.some((field) => field.id === 'temperature'))
  assert.ok(described.unsupported.some((item) => item.id === 'swing'))
})

test('fans and on-off lights do not invent missing controls', () => {
  const fan = describeEntity({
    entity_id: 'fan.desk',
    state: 'on',
    attributes: { supported_features: FAN_FEATURES.TURN_ON | FAN_FEATURES.TURN_OFF | FAN_FEATURES.SET_SPEED, percentage_step: 10 },
  })
  assert.ok(fan)
  assert.equal(fan.capabilities.find((capability) => capability.id === 'fan.speed')?.range?.step, 10)
  assert.ok(fan.unsupported.some((item) => item.id === 'fan.oscillate'))

  const light = describeEntity({
    entity_id: 'light.hall',
    state: 'off',
    attributes: { supported_color_modes: ['onoff'] },
  })
  assert.ok(light)
  assert.equal(light.capabilities.some((capability) => capability.id === 'light.brightness'), false)
  assert.equal(light.state.values.power, false)
})
