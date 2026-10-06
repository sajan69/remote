import type { Capability } from '@remote/protocol'

export function argumentsFor(capability: Pick<Capability, 'kind' | 'range' | 'enumValues' | 'stateFields'>): Record<string, unknown> {
  if (capability.kind === 'toggle') return { value: true }
  if (capability.kind === 'range') return { value: capability.range?.min ?? 1 }
  if (capability.kind === 'enum') return { value: capability.enumValues?.[0] ?? '' }
  if (capability.kind === 'state') return complete(capability, {})
  return {}
}

export function complete(settings: Pick<Capability, 'stateFields'> | undefined, draft: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const field of settings?.stateFields ?? []) {
    if (draft[field.id] !== undefined) next[field.id] = draft[field.id]
    else if (field.kind === 'boolean') next[field.id] = true
    else if (field.kind === 'number') next[field.id] = field.min ?? 0
    else next[field.id] = field.values?.[0]
  }
  return next
}

export function readTemperature(
  draft: Record<string, unknown>,
  shown: number | null,
  field: { min?: number } | undefined,
): number {
  return typeof draft.temperature === 'number' ? draft.temperature : (shown ?? field?.min ?? 16)
}

export function step(value: number, delta: number, field: { min?: number; max?: number } | undefined): number {
  const next = value + delta
  return Math.min(field?.max ?? next, Math.max(field?.min ?? next, next))
}
