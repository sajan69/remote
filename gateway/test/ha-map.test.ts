import { expect, test } from '@jest/globals';
import {
  CLIMATE_FEATURES,
  describeEntity,
  FAN_FEATURES,
  MEDIA_FEATURES,
} from '../src/adapters/ha-map.ts';

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
  });
  expect(described).toBeTruthy();
  if (!described) throw new Error('expected a description');
  expect(described.suggestedCategory).toBe('tv');
  expect(described.confirmation).toBe('state');
  expect(described.capabilities.map((capability) => capability.id)).toEqual([
    'power_on',
    'power_off',
    'volume_up',
    'volume_down',
    'mute',
    'play',
  ]);
  expect(described.state.confidence).toBe('confirmed');
  expect(described.state.values.power).toBe(true);
});

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
  });
  expect(described).toBeTruthy();
  if (!described) throw new Error('expected a description');
  expect(described.confirmation).toBe('transmission_only');
  expect(described.state.confidence).toBe('assumed');
  expect(described.state.values.roomTemperature).toBe(25);
  expect(described.state.values.temperature).toBe(22);
  const settings = described.capabilities.find((capability) => capability.id === 'climate.set');
  expect(settings?.stateFields?.some((field) => field.id === 'temperature')).toBe(true);
  expect(described.unsupported.some((item) => item.id === 'swing')).toBe(true);
});

test('fans and on-off lights do not invent missing controls', () => {
  const fan = describeEntity({
    entity_id: 'fan.desk',
    state: 'on',
    attributes: {
      supported_features: FAN_FEATURES.TURN_ON | FAN_FEATURES.TURN_OFF | FAN_FEATURES.SET_SPEED,
      percentage_step: 10,
    },
  });
  expect(fan).toBeTruthy();
  if (!fan) throw new Error('expected a fan');
  expect(fan.capabilities.find((capability) => capability.id === 'fan.speed')?.range?.step).toBe(
    10,
  );
  expect(fan.unsupported.some((item) => item.id === 'fan.oscillate')).toBe(true);

  const light = describeEntity({
    entity_id: 'light.hall',
    state: 'off',
    attributes: { supported_color_modes: ['onoff'] },
  });
  expect(light).toBeTruthy();
  if (!light) throw new Error('expected a light');
  expect(light.capabilities.some((capability) => capability.id === 'light.brightness')).toBe(false);
  expect(light.state.values.power).toBe(false);
});
