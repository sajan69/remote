import crypto from 'node:crypto'
import http from 'node:http'
import type { DeviceRecord } from '@remote/protocol'
import type { HomeAssistant } from '../adapters/ha.ts'
import type { AppConfig } from '../config.ts'
import { AdapterError, HttpError } from '../errors.ts'
import { mergeCapabilities } from '../profiles.ts'
import type { Store } from '../store.ts'
import { isRecord } from '../http/request.ts'
import { recordDiagnostic } from './diagnostics.ts'

export async function learn(
  store: Store,
  ha: HomeAssistant,
  config: AppConfig,
  device: DeviceRecord,
  body: unknown,
  req: http.IncomingMessage,
): Promise<{ captured: true; capability: string; commandName: string }> {
  if (device.category === 'ac') {
    throw new HttpError(
      400,
      'unsupported_capability',
      'Air-conditioner state is not learned button by button. Use a climate entity or a protocol-aware profile.',
    )
  }
  if (device.simulated || !device.learnSupported) {
    throw new HttpError(400, 'unsupported_capability', 'This device cannot learn a button. It needs a bridge that supports command learning.')
  }
  const record = isRecord(body) ? body : {}
  const capability = typeof record.capability === 'string' ? record.capability : ''
  const commandName = typeof record.commandName === 'string' ? record.commandName : ''
  if (!/^[a-z0-9_]{1,40}$/.test(capability) || !/^[A-Za-z0-9_-]{1,64}$/.test(commandName)) {
    throw new HttpError(400, 'invalid_command', 'Choose a button name before learning.')
  }
  const controller = new AbortController()
  const onClose = () => controller.abort()
  req.on('close', onClose)
  try {
    await ha.callService(
      'remote',
      'learn_command',
      {
        entity_id: device.connectionId,
        device: device.name,
        command: commandName,
        command_type: 'ir',
        timeout: Math.max(5, Math.round(config.learnTimeoutMs / 1000) - 5),
      },
      config.learnTimeoutMs,
      controller.signal,
    )
  } catch (error) {
    if (controller.signal.aborted || (error instanceof AdapterError && error.code === 'cancelled')) {
      throw new HttpError(400, 'cancelled', 'Learning was stopped before a signal was saved.')
    }
    const message = error instanceof Error ? error.message : 'Learning failed.'
    recordDiagnostic(store, 'transmission_timeout', message, device.id)
    throw new HttpError(502, 'transmission_failed', message)
  } finally {
    req.removeListener('close', onClose)
  }
  store.mutate((data) => {
    data.pendingLearns = data.pendingLearns.filter((item) => item.deviceId !== device.id || item.capability !== capability)
    data.pendingLearns.push({
      id: crypto.randomUUID(),
      deviceId: device.id,
      capability,
      commandName,
      at: new Date().toISOString(),
    })
  })
  return { captured: true, capability, commandName }
}

export function saveLearned(store: Store, device: DeviceRecord, body: unknown): void {
  const record = isRecord(body) ? body : {}
  if (record.userConfirmed !== true) {
    throw new HttpError(400, 'confirmation_required', 'Test the learned button on the appliance before saving it.')
  }
  const capability = typeof record.capability === 'string' ? record.capability : ''
  const pending = store.data.pendingLearns.find((item) => item.deviceId === device.id && item.capability === capability)
  if (!pending || Date.now() - Date.parse(pending.at) > 10 * 60 * 1000) {
    throw new HttpError(400, 'confirmation_required', 'Learn the button again before saving it.')
  }
  const test = store.data.commands.find((item) => item.id === record.testCommandId)
  if (!test || test.deviceId !== device.id || test.capability !== capability || !['transmitted', 'appliance_confirmed'].includes(test.status)) {
    throw new HttpError(400, 'confirmation_required', 'A successful test of this button is required before saving it.')
  }
  if (Date.parse(test.createdAt) < Date.parse(pending.at)) {
    throw new HttpError(400, 'confirmation_required', 'Test the button after it was learned.')
  }
  store.mutate((data) => {
    const current = data.devices.find((item) => item.id === device.id)
    if (!current) return
    let profile = current.profileId ? data.profiles.find((item) => item.id === current.profileId) ?? null : null
    if (!profile || profile.protocol !== 'ha_remote') {
      profile = {
        id: crypto.randomUUID(),
        name: `${current.name} learned`,
        category: current.category,
        brand: null,
        model: null,
        status: 'learned',
        provenance: 'Learned on this gateway from the original remote.',
        licence: 'Household-captured signal. Not a redistributed code database.',
        protocol: 'ha_remote',
        version: 1,
        commands: {},
        ac: null,
        testedCapabilities: [],
      }
      data.profiles.push(profile)
      current.profileId = profile.id
    }
    profile.commands[capability] = { type: 'ha_remote', command: pending.commandName, device: current.name }
    profile.testedCapabilities = [...new Set([...profile.testedCapabilities, capability])]
    profile.status = 'learned'
    current.profileStatus = 'learned'
    current.capabilities = mergeCapabilities(
      current.capabilities.filter((item) => item.id !== capability || item.kind !== 'discrete'),
      profile,
      current.confirmation,
    )
    data.pendingLearns = data.pendingLearns.filter((item) => item.id !== pending.id)
    device.capabilities = current.capabilities
    device.profileId = current.profileId
    device.profileStatus = current.profileStatus
  })
}
