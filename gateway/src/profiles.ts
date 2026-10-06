import {
  labelFor,
  repeatFor,
  type Capability,
  type ConfirmationMode,
  type Profile,
} from '@remote/protocol';

export function capabilitiesForProfile(profile: Profile): Capability[] {
  if (profile.protocol === 'ac_state_v1' && profile.ac) {
    const limits = profile.ac;
    return [
      {
        id: 'climate.set',
        label: 'Settings',
        kind: 'state',
        confirmation: 'transmission_only',
        idempotent: true,
        available: true,
        stateFields: [
          { id: 'power', label: 'Power', kind: 'boolean' },
          { id: 'mode', label: 'Mode', kind: 'enum', values: limits.modes },
          {
            id: 'temperature',
            label: 'Temperature',
            kind: 'number',
            min: limits.min,
            max: limits.max,
            step: limits.step,
            unit: '°C',
          },
          { id: 'fan', label: 'Fan', kind: 'enum', values: limits.fans },
          { id: 'swing', label: 'Swing', kind: 'enum', values: limits.swings },
        ],
      },
    ];
  }

  return Object.keys(profile.commands).map((id) => {
    const repeat = repeatFor(id, profile.protocol === 'nec' ? 'protocol_repeat' : 'resend_frame');
    return {
      id,
      label: labelFor(id),
      kind: 'discrete' as const,
      confirmation: 'transmission_only',
      idempotent: false,
      available: true,
      ...(repeat ? { repeat } : {}),
    };
  });
}

export function mergeCapabilities(
  base: Capability[],
  profile: Profile | null,
  confirmation: ConfirmationMode,
): Capability[] {
  const capabilities = base.map((capability) => ({ ...capability, confirmation }));
  if (!profile) return capabilities;
  for (const capability of capabilitiesForProfile(profile)) {
    const index = capabilities.findIndex((item) => item.id === capability.id);
    if (index >= 0) capabilities[index] = capability;
    else capabilities.push(capability);
  }
  return capabilities;
}
