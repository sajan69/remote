import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { emptyState, labelFor, parseProfile, repeatFor, type Capability, type CommandRecord, type DeviceRecord } from '@remote/protocol'
import { WebSocketServer } from 'ws'
import { executeDevice } from './adapters/execute.ts'
import { demoCatalog } from './adapters/demo.ts'
import { describeEntity, presentState, type DiscoveryEntity, type HaEntity } from './adapters/ha-map.ts'
import { HomeAssistant } from './adapters/ha.ts'
import type { AppConfig } from './config.ts'
import { CommandError, CommandService } from './commands.ts'
import { AdapterError, HttpError } from './errors.ts'
import { Hub } from './hub.ts'
import { mergeCapabilities } from './profiles.ts'
import { redact } from './redact.ts'
import { generatePairingCode, hashSecret, normalizeCode, Store, timingSafeHexEqual, type Session } from './store.ts'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const DISCOVERY_MS = 10 * 60 * 1000
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
}

export interface AppHandle {
  server: http.Server
  store: Store
  pairingCode: string | null
  close: () => Promise<void>
}

export async function createApp(config: AppConfig): Promise<AppHandle> {
  const store = await Store.open(config.dataDir, config.pairingCode)
  const hub = new Hub()
  const ha = new HomeAssistant({
    resolve: () =>
      config.haBaseUrl && config.haToken ? { baseUrl: config.haBaseUrl, token: config.haToken } : null,
    onState: (entity) => applyHaState(store, hub, entity),
  })
  const commands = new CommandService({
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    deadlineMs: config.deadlineMs,
    coalesceMs: config.coalesceMs,
    store,
    hub,
    execute: (device, command) => executeDevice(store, ha, config.irRaw, device, command),
    onTerminal: (command) => {
      recordDiagnostic(
        store,
        command.error?.code ?? 'command_failed',
        command.error?.message ?? 'A command failed.',
        command.deviceId.startsWith('trial:') ? undefined : command.deviceId,
      )
    },
  })
  const limits = new Map<string, number[]>()
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const httpError = error instanceof HttpError ? error : error instanceof CommandError
        ? new HttpError(error.status, error.code, error.message)
        : new HttpError(500, 'internal_error', 'Something went wrong on the gateway.')
      if (!(error instanceof HttpError) && !(error instanceof CommandError)) console.error(error)
      send(res, httpError.status, { error: httpError.code, message: httpError.message })
    })
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://gateway.local')
    if (url.pathname !== '/api/events' || !originAllowed(req, config)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (!sessionFrom(req, store)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.add(ws)
      ws.send(JSON.stringify({ type: 'devices' }))
    })
  })
  ha.start()

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://gateway.local')
    const method = req.method ?? 'GET'
    if (method === 'OPTIONS') {
      send(res, 204, null)
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      await serveStatic(config.staticDir, url.pathname, res)
      return
    }
    if (!originAllowed(req, config)) {
      throw new HttpError(403, 'origin_rejected', 'This browser origin is not allowed to use the gateway.')
    }
    res.setHeader('cache-control', 'no-store')
    if (method !== 'GET' && req.headers['x-remote-client'] !== '1') {
      throw new HttpError(403, 'origin_rejected', 'The request is missing its client header.')
    }

    if (method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { status: 'ok', version: config.version })
      return
    }
    if (method === 'POST' && url.pathname === '/api/pair') {
      limit(limits, `pair:${clientIp(req, config.trustProxy)}`, 5, 10 * 60 * 1000)
      const body = await readJson(req, 4000)
      const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
      const normalized = normalizeCode(code)
      const candidate = normalized ?? 'AAAA-AAAA'
      const matches = timingSafeHexEqual(hashSecret(candidate, store.data.pairingSalt), store.data.pairingHash)
      if (!normalized || !matches) {
        recordDiagnostic(store, 'pairing_rejected', 'A pairing attempt was rejected.')
        throw new HttpError(401, 'pairing_rejected', 'That pairing code was not accepted.')
      }
      const label = isRecord(body) && typeof body.label === 'string' ? body.label.trim().slice(0, 40) : 'Browser'
      const token = crypto.randomBytes(32).toString('base64url')
      const session: Session = {
        id: crypto.randomUUID(),
        tokenHash: hashSecret(token),
        label: label || 'Browser',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
      }
      store.mutate((data) => {
        data.sessions.push(session)
        data.sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        if (data.sessions.length > 20) data.sessions.splice(0, data.sessions.length - 20)
      })
      res.setHeader('set-cookie', cookie(token, config.cookieSecure, SESSION_MS / 1000))
      send(res, 200, { paired: true, label: session.label, expiresAt: session.expiresAt })
      return
    }

    const session = sessionFrom(req, store)
    if (!session) throw new HttpError(401, 'pairing_required', 'Pair the gateway to continue.')
    limit(limits, `use:${session.id}`, 150, 10_000)

    if (method === 'GET' && url.pathname === '/api/session') {
      send(res, 200, { paired: true, label: session.label, expiresAt: session.expiresAt })
      return
    }
    if (method === 'DELETE' && url.pathname === '/api/session') {
      store.mutate((data) => {
        data.sessions = data.sessions.filter((item) => item.id !== session.id)
      })
      res.setHeader('set-cookie', cookie('', config.cookieSecure, 0))
      send(res, 200, { paired: false })
      return
    }
    if (method === 'POST' && url.pathname === '/api/sessions/revoke-all') {
      store.mutate((data) => {
        data.sessions = []
      })
      res.setHeader('set-cookie', cookie('', config.cookieSecure, 0))
      send(res, 200, { paired: false })
      return
    }
    if (method === 'GET' && url.pathname === '/api/status') {
      send(res, 200, statusBody(config, store, ha))
      return
    }
    if (method === 'GET' && url.pathname === '/api/devices') {
      send(res, 200, { devices: store.data.devices, demoEnabled: store.data.demoEnabled })
      return
    }
    if (method === 'POST' && url.pathname === '/api/discovery') {
      send(res, 200, { entities: await refreshDiscovery(store, ha) })
      return
    }
    if (method === 'GET' && url.pathname === '/api/discovery') {
      send(res, 200, { entities: store.data.discovery, discoveredAt: store.data.discoveryAt })
      return
    }
    if (method === 'POST' && url.pathname === '/api/trial') {
      const body = await readJson(req, 16_000)
      send(res, 202, await trial(store, commands, body))
      return
    }
    if (method === 'POST' && url.pathname === '/api/demo') {
      const body = await readJson(req, 2000)
      const enabled = isRecord(body) && body.enabled === true
      setDemo(store, hub, enabled)
      send(res, 200, { demoEnabled: store.data.demoEnabled, devices: store.data.devices })
      return
    }
    if (method === 'POST' && url.pathname === '/api/refresh') {
      await refreshAll(store, ha, hub)
      send(res, 200, { devices: store.data.devices })
      return
    }
    if (method === 'GET' && url.pathname === '/api/profiles') {
      send(res, 200, { profiles: store.data.profiles })
      return
    }
    if (method === 'POST' && url.pathname === '/api/profiles') {
      const body = await readJson(req, 70_000)
      const profile = parseProfile(body, { id: crypto.randomUUID(), forceExperimental: true })
      store.mutate((data) => {
        if (data.profiles.length >= 50) return
        data.profiles.push(profile)
      })
      if (!store.data.profiles.some((item) => item.id === profile.id)) {
        throw new HttpError(400, 'payload_too_large', 'The gateway already has 50 profiles.')
      }
      send(res, 201, { profile })
      return
    }
    if (method === 'GET' && url.pathname === '/api/diagnostics') {
      send(res, 200, { entries: store.data.diagnostics })
      return
    }
    if (method === 'GET' && url.pathname === '/api/export') {
      send(res, 200, {
        exportedAt: new Date().toISOString(),
        demoEnabled: store.data.demoEnabled,
        devices: store.data.devices,
        profiles: store.data.profiles,
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/reset') {
      const body = await readJson(req, 2000)
      if (!isRecord(body) || body.confirm !== 'reset local gateway') {
        throw new HttpError(400, 'invalid_command', 'Type “reset local gateway” to confirm.')
      }
      const pairingCode = resetData(store, config.dataDir)
      hub.publish({ type: 'devices' })
      res.setHeader('set-cookie', cookie('', config.cookieSecure, 0))
      send(res, 200, { reset: true, pairingCode })
      return
    }

    if (method === 'POST' && url.pathname === '/api/devices') {
      const body = await readJson(req, 16_000)
      const device = createDevice(store, body)
      hub.publish({ type: 'devices' })
      send(res, 201, { device })
      return
    }

    const deviceMatch = url.pathname.match(/^\/api\/devices\/([a-zA-Z0-9_-]{8,80})(?:\/(commands|refresh|learn|learned))?$/)
    const commandMatch = url.pathname.match(/^\/api\/commands\/([a-zA-Z0-9_-]{8,80})$/)
    const profileMatch = url.pathname.match(/^\/api\/profiles\/([a-zA-Z0-9_-]{8,80})$/)

    if (deviceMatch && method === 'PATCH' && !deviceMatch[2]) {
      const body = await readJson(req, 8000)
      const device = patchDevice(store, deviceMatch[1] ?? '', body)
      hub.publish({ type: 'devices' })
      send(res, 200, { device })
      return
    }
    if (deviceMatch && method === 'DELETE' && !deviceMatch[2]) {
      const id = deviceMatch[1] ?? ''
      store.mutate((data) => {
        data.devices = data.devices.filter((device) => device.id !== id)
      })
      hub.publish({ type: 'devices' })
      send(res, 200, { removed: true })
      return
    }
    if (deviceMatch && method === 'POST' && deviceMatch[2] === 'commands') {
      const device = requireDevice(store, deviceMatch[1] ?? '')
      const body = await readJson(req, 16_000)
      const command = submitSaved(store, commands, device, body)
      send(res, 202, { command })
      return
    }
    if (deviceMatch && method === 'POST' && deviceMatch[2] === 'refresh') {
      const device = requireDevice(store, deviceMatch[1] ?? '')
      await refreshOne(store, ha, device)
      hub.publish({ type: 'state', deviceId: device.id, state: device.state })
      send(res, 200, { device })
      return
    }
    if (deviceMatch && method === 'POST' && deviceMatch[2] === 'learn') {
      const device = requireDevice(store, deviceMatch[1] ?? '')
      const body = await readJson(req, 4000)
      send(res, 200, await learn(store, ha, config, device, body, req))
      return
    }
    if (deviceMatch && method === 'POST' && deviceMatch[2] === 'learned') {
      const device = requireDevice(store, deviceMatch[1] ?? '')
      const body = await readJson(req, 8000)
      saveLearned(store, device, body)
      hub.publish({ type: 'devices' })
      send(res, 200, { device })
      return
    }
    if (commandMatch && method === 'GET') {
      const command = store.data.commands.find((item) => item.id === commandMatch[1])
      if (!command) throw new HttpError(404, 'not_found', 'That command is not on this gateway.')
      send(res, 200, { command })
      return
    }
    if (commandMatch && method === 'DELETE') {
      send(res, 200, { command: commands.cancel(commandMatch[1] ?? '') })
      return
    }
    if (profileMatch && method === 'DELETE') {
      const id = profileMatch[1] ?? ''
      if (store.data.devices.some((device) => device.profileId === id)) {
        throw new HttpError(409, 'profile_in_use', 'A device is still using this profile.')
      }
      store.mutate((data) => {
        data.profiles = data.profiles.filter((profile) => profile.id !== id)
      })
      send(res, 200, { removed: true })
      return
    }

    throw new HttpError(404, 'not_found', 'That gateway route does not exist.')
  }

  return {
    server,
    store,
    pairingCode: store.pairingCode,
    close: async () => {
      ha.stop()
      hub.close()
      wss.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await store.flush()
    },
  }
}

async function refreshDiscovery(store: Store, ha: HomeAssistant): Promise<DiscoveryEntity[]> {
  const entities: DiscoveryEntity[] = []
  if (ha.current()) entities.push(...(await ha.getStates()).map(describeEntity).filter((item): item is DiscoveryEntity => item !== null))
  else if (!store.data.demoEnabled) {
    throw new HttpError(503, 'gateway_unreachable', 'Home Assistant is not configured on the gateway.')
  }
  if (store.data.demoEnabled) entities.push(...demoCatalog())
  store.mutate((data) => {
    data.discovery = entities
    data.discoveryAt = new Date().toISOString()
  })
  return entities
}

async function trial(store: Store, commands: CommandService, body: unknown): Promise<{ command: CommandRecord }> {
  if (!freshDiscovery(store)) {
    throw new HttpError(409, 'model_mismatch', 'Discover devices again before sending a test.')
  }
  const record = isRecord(body) ? body : {}
  const connectionId = typeof record.connectionId === 'string' ? record.connectionId : ''
  const entity = store.data.discovery.find((item) => item.connectionId === connectionId)
  if (!entity) throw new HttpError(404, 'not_found', 'That device is not in the latest discovery.')
  const device = materialize(entity, {
    id: `trial:${connectionId}`,
    name: entity.name,
    room: 'Test',
    category: entity.suggestedCategory,
    confirmation: entity.confirmation,
    favorite: false,
  })
  const command = commands.submit({
    device: withPendingCapability(store, device, typeof record.capability === 'string' ? record.capability : ''),
    id: readId(record.id),
    capability: typeof record.capability === 'string' ? record.capability : '',
    arguments: isRecord(record.arguments) ? record.arguments : {},
    sequence:
      typeof record.sequence === 'number'
        ? record.sequence
        : (store.data.trialSequences[connectionId] ?? 0) + 1,
    trial: { adapterId: entity.simulated ? 'demo' : 'home_assistant', connectionId, category: entity.suggestedCategory },
  })
  return { command }
}

function createDevice(store: Store, body: unknown): DeviceRecord {
  const record = isRecord(body) ? body : {}
  const connectionId = typeof record.connectionId === 'string' ? record.connectionId : ''
  if (!freshDiscovery(store)) throw new HttpError(409, 'model_mismatch', 'Discover devices again before saving.')
  const entity = store.data.discovery.find((item) => item.connectionId === connectionId)
  if (!entity) throw new HttpError(404, 'not_found', 'That device is not in the latest discovery.')
  if (!entity.allowedCategories.includes(readCategory(record.category, entity))) {
    throw new HttpError(400, 'model_mismatch', 'That category does not match this integration.')
  }
  const category = readCategory(record.category, entity)
  const confirmation = record.confirmation === 'state' ? 'state' : 'transmission_only'
  if (confirmation === 'state' && entity.confirmation === 'transmission_only' && record.acknowledgeMeasuredState !== true) {
    throw new HttpError(
      400,
      'confirmation_required',
      'This integration is treated as one-way unless you confirm the appliance itself reports state.',
    )
  }
  if (store.data.devices.some((device) => device.connectionId === connectionId)) {
    throw new HttpError(409, 'model_mismatch', 'That device is already in the library.')
  }
  if (entity.simulated) {
    if (record.acknowledgeDemo !== true) {
      throw new HttpError(400, 'demo_required', 'Confirm that demo devices do not control a real appliance.')
    }
  } else if (record.userConfirmed !== true) {
    throw new HttpError(400, 'confirmation_required', 'Save it only after you have seen the appliance respond.')
  }
  if (!entity.simulated) {
    const test = store.data.commands.find((item) => item.id === record.testCommandId)
    const fresh = test ? Date.now() - Date.parse(test.createdAt) < 15 * 60 * 1000 : false
    if (!test || !fresh || test.trial?.connectionId !== connectionId || !['transmitted', 'appliance_confirmed'].includes(test.status)) {
      throw new HttpError(400, 'confirmation_required', 'Run one successful test on this device before saving it.')
    }
  }
  const profile = typeof record.profileId === 'string' ? store.data.profiles.find((item) => item.id === record.profileId) ?? null : null
  if (profile && profile.category !== category) throw new HttpError(400, 'model_mismatch', 'That profile is for a different device category.')
  if (profile?.protocol === 'ha_remote' && entity.domain !== 'remote' && !entity.simulated) {
    throw new HttpError(400, 'unsupported_capability', 'Named remote commands need a Home Assistant remote entity.')
  }
  const device = materialize(entity, {
    id: crypto.randomUUID(),
    name: clip(record.name, entity.name, 40),
    room: clip(record.room, 'Home', 40),
    category,
    confirmation,
    favorite: record.favorite === true,
  })
  device.capabilities = mergeCapabilities(entity.capabilities, profile, confirmation)
  device.profileId = profile?.id ?? null
  device.profileStatus = entity.simulated ? 'experimental' : 'user_confirmed'
  device.userConfirmedAt = entity.simulated ? null : new Date().toISOString()
  device.testCommandId = typeof record.testCommandId === 'string' ? record.testCommandId : null
  device.sortIndex = store.data.devices.reduce((max, item) => Math.max(max, item.sortIndex), -1) + 1
  if (entity.simulated) {
    device.state = emptyState('Demo preview. No appliance was contacted.')
  }
  store.mutate((data) => {
    data.devices.push(device)
  })
  return device
}

function submitSaved(store: Store, commands: CommandService, device: DeviceRecord, body: unknown): CommandRecord {
  const record = isRecord(body) ? body : {}
  const capability = typeof record.capability === 'string' ? record.capability : ''
  return commands.submit({
    device: withPendingCapability(store, device, capability),
    id: readId(record.id),
    capability,
    arguments: isRecord(record.arguments) ? record.arguments : {},
    sequence: typeof record.sequence === 'number' ? record.sequence : device.lastSequence + 1,
  })
}

function patchDevice(store: Store, id: string, body: unknown): DeviceRecord {
  const device = requireDevice(store, id)
  const record = isRecord(body) ? body : {}
  store.mutate((data) => {
    const current = data.devices.find((item) => item.id === id)
    if (!current) return
    if (typeof record.name === 'string' && record.name.trim()) current.name = record.name.trim().slice(0, 40)
    if (typeof record.room === 'string' && record.room.trim()) current.room = record.room.trim().slice(0, 40)
    if (typeof record.favorite === 'boolean') current.favorite = record.favorite
    if (record.move === 'up' || record.move === 'down') moveDevice(data.devices, id, record.move)
  })
  return store.data.devices.find((item) => item.id === device.id) ?? device
}

async function refreshAll(store: Store, ha: HomeAssistant, hub: Hub): Promise<void> {
  const linked = store.data.devices.filter((device) => device.adapterId === 'home_assistant')
  if (linked.length === 0) return
  if (!ha.current()) throw new HttpError(503, 'gateway_unreachable', 'Home Assistant is not configured on the gateway.')
  for (const device of linked) await refreshOne(store, ha, device)
  hub.publish({ type: 'devices' })
}

async function refreshOne(store: Store, ha: HomeAssistant, device: DeviceRecord): Promise<void> {
  if (device.simulated) return
  let entity: HaEntity | null
  try {
    entity = await ha.getState(device.connectionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Home Assistant did not refresh this device.'
    recordDiagnostic(store, 'gateway_unreachable', message, device.id)
    throw new HttpError(503, 'gateway_unreachable', message)
  }
  store.mutate((data) => {
    const current = data.devices.find((item) => item.id === device.id)
    if (!current) return
    if (!entity) {
      current.state = emptyState('This entity is no longer available in Home Assistant.')
      current.capabilities = current.capabilities.map((capability) => ({
        ...capability,
        available: false,
        unavailableReason: 'The Home Assistant entity is unavailable.',
      }))
      return
    }
    const described = describeEntity(entity)
    if (!described) return
    const profile = current.profileId ? data.profiles.find((item) => item.id === current.profileId) ?? null : null
    current.capabilities = mergeCapabilities(described.capabilities, profile, current.confirmation)
    current.learnSupported = described.learnSupported
    const next = presentState(described.state.values, current.confirmation, described.state.observedAt)
    next.lastCommandId = current.state.lastCommandId
    current.state = next
    device.state = next
    device.capabilities = current.capabilities
  })
}

async function learn(
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

function saveLearned(store: Store, device: DeviceRecord, body: unknown): void {
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

function setDemo(store: Store, hub: Hub, enabled: boolean): void {
  store.mutate((data) => {
    data.demoEnabled = enabled
    if (enabled) {
      for (const entity of demoCatalog()) {
        if (data.devices.some((device) => device.connectionId === entity.connectionId)) continue
        const device = materialize(entity, {
          id: crypto.randomUUID(),
          name: entity.name,
          room: 'Preview',
          category: entity.suggestedCategory,
          confirmation: 'transmission_only',
          favorite: false,
        })
        device.sortIndex = data.devices.reduce((max, item) => Math.max(max, item.sortIndex), -1) + 1
        device.profileStatus = 'experimental'
        device.state = emptyState('Demo preview. No appliance was contacted.')
        data.devices.push(device)
      }
      data.discovery = [...data.discovery.filter((item) => !item.simulated), ...demoCatalog()]
      data.discoveryAt = new Date().toISOString()
    } else {
      data.devices = data.devices.filter((device) => !device.simulated)
      data.discovery = data.discovery.filter((item) => !item.simulated)
    }
  })
  hub.publish({ type: 'demo', enabled })
  hub.publish({ type: 'devices' })
}

function materialize(
  entity: DiscoveryEntity,
  input: { id: string; name: string; room: string; category: DeviceRecord['category']; confirmation: DeviceRecord['confirmation']; favorite: boolean },
): DeviceRecord {
  const state = presentState(entity.state.values, input.confirmation, entity.state.observedAt)
  return {
    id: input.id,
    name: input.name,
    room: input.room,
    category: input.category,
    adapterId: entity.simulated ? 'demo' : 'home_assistant',
    connectionId: entity.connectionId,
    profileId: null,
    confirmation: input.confirmation,
    simulated: entity.simulated,
    favorite: input.favorite,
    sortIndex: 0,
    learnSupported: entity.learnSupported,
    profileStatus: 'untested',
    userConfirmedAt: null,
    testCommandId: null,
    capabilities: entity.capabilities.map((capability) => ({ ...capability, confirmation: input.confirmation })),
    state,
    lastSequence: 0,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  }
}

function withPendingCapability(store: Store, device: DeviceRecord, capability: string): DeviceRecord {
  if (device.capabilities.some((item) => item.id === capability && item.available)) return device
  const pending = store.data.pendingLearns.find(
    (item) => item.deviceId === device.id && item.capability === capability && Date.now() - Date.parse(item.at) < 10 * 60 * 1000,
  )
  if (!pending) return device
  const repeat = repeatFor(capability, 'resend_frame')
  const added: Capability = {
    id: capability,
    label: labelFor(capability),
    kind: 'discrete',
    confirmation: 'transmission_only',
    idempotent: false,
    available: true,
    ...(repeat ? { repeat } : {}),
  }
  return { ...device, capabilities: [...device.capabilities, added] }
}

function applyHaState(store: Store, hub: Hub, entity: HaEntity): void {
  const described = describeEntity(entity)
  if (!described) return
  const updates: Array<{ id: string; state: DeviceRecord['state'] }> = []
  store.mutate((data) => {
    for (const device of data.devices) {
      if (device.adapterId !== 'home_assistant' || device.connectionId !== entity.entity_id) continue
      const next = presentState(described.state.values, device.confirmation, described.state.observedAt)
      next.lastCommandId = device.state.lastCommandId
      if (JSON.stringify(device.state.values) === JSON.stringify(next.values) && device.state.confidence === next.confidence) {
        continue
      }
      device.state = next
      updates.push({ id: device.id, state: next })
    }
    const index = data.discovery.findIndex((item) => item.connectionId === entity.entity_id)
    if (index >= 0) data.discovery[index] = described
  })
  for (const update of updates) hub.publish({ type: 'state', deviceId: update.id, state: update.state })
}

function resetData(store: Store, dataDir: string): string {
  const pairingCode = generatePairingCode()
  const pairingSalt = crypto.randomBytes(16).toString('hex')
  store.mutate((data) => {
    data.pairingSalt = pairingSalt
    data.pairingHash = hashSecret(pairingCode, pairingSalt)
    data.sessions = []
    data.devices = []
    data.commands = []
    data.profiles = []
    data.diagnostics = []
    data.discovery = []
    data.discoveryAt = null
    data.demoEnabled = false
    data.pendingLearns = []
    data.trialSequences = {}
  })
  fs.writeFileSync(path.join(dataDir, 'pairing-code.txt'), `${pairingCode}\n`, { mode: 0o600 })
  return pairingCode
}

function statusBody(config: AppConfig, store: Store, ha: HomeAssistant) {
  const current = ha.current()
  return {
    version: config.version,
    demoEnabled: store.data.demoEnabled,
    homeAssistant: current
      ? { configured: true, baseUrl: current.baseUrl, reachable: ha.status.reachable, message: ha.status.message }
      : { configured: false, baseUrl: null, reachable: false, message: ha.status.message },
    irRaw: { configured: Boolean(config.irRaw) },
    sessions: store.data.sessions.length,
  }
}

function recordDiagnostic(store: Store, code: string, message: string, deviceId?: string): void {
  store.mutate((data) => {
    data.diagnostics.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      code,
      message: redact(message),
      ...(deviceId ? { deviceId } : {}),
    })
    if (data.diagnostics.length > 200) data.diagnostics.splice(0, data.diagnostics.length - 200)
  })
}

function moveDevice(devices: DeviceRecord[], id: string, direction: 'up' | 'down'): void {
  const ordered = devices.slice().sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name))
  const index = ordered.findIndex((device) => device.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= ordered.length) return
  const [item] = ordered.splice(index, 1)
  if (!item) return
  ordered.splice(target, 0, item)
  ordered.forEach((device, position) => {
    device.sortIndex = position
  })
}

function requireDevice(store: Store, id: string): DeviceRecord {
  const device = store.data.devices.find((item) => item.id === id)
  if (!device) throw new HttpError(404, 'not_found', 'That remote is not on this gateway.')
  return device
}

function freshDiscovery(store: Store): boolean {
  return Boolean(store.data.discoveryAt && Date.now() - Date.parse(store.data.discoveryAt) < DISCOVERY_MS)
}

function readCategory(value: unknown, entity: DiscoveryEntity): DeviceRecord['category'] {
  if (typeof value === 'string' && entity.allowedCategories.includes(value as DeviceRecord['category'])) {
    return value as DeviceRecord['category']
  }
  return entity.suggestedCategory
}

function readId(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value)) return value
  return crypto.randomUUID()
}

function clip(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) return fallback.slice(0, max)
  return value.trim().slice(0, max)
}

function sessionFrom(req: http.IncomingMessage, store: Store): Session | null {
  const token = readCookie(req.headers.cookie, 'remote_session')
  if (!token) return null
  const hash = hashSecret(token)
  return (
    store.data.sessions.find(
      (session) => timingSafeHexEqual(session.tokenHash, hash) && Date.parse(session.expiresAt) > Date.now(),
    ) ?? null
  )
}

function originAllowed(req: http.IncomingMessage, config: AppConfig): boolean {
  const origin = req.headers.origin
  if (!origin || Array.isArray(origin)) return !origin
  if (config.publicOrigins.includes(origin)) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function cookie(token: string, secure: boolean, maxAge: number): string {
  const parts = [`remote_session=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function limit(buckets: Map<string, number[]>, key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs)
  if (recent.length >= max) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a moment and try again.')
  recent.push(now)
  buckets.set(key, recent)
}

function readJson(req: http.IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) {
        reject(new HttpError(413, 'payload_too_large', 'That upload is too large.'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      if (size === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new HttpError(400, 'invalid_json', 'The request body was not valid JSON.'))
      }
    })
    req.on('error', () => reject(new HttpError(400, 'invalid_json', 'The request body could not be read.')))
  })
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  if (body === null) {
    res.end()
    return
  }
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function serveStatic(root: string | null, pathname: string, res: http.ServerResponse): Promise<void> {
  if (!root) {
    send(res, 404, { error: 'not_found', message: 'The app is not being served by this gateway process.' })
    return
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.normalize(path.join(root, relative))
  if (!file.startsWith(path.normalize(root + path.sep)) && file !== path.normalize(root)) {
    send(res, 404, { error: 'not_found', message: 'Not found.' })
    return
  }
  let target = file
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    if (path.extname(relative)) {
      send(res, 404, { error: 'not_found', message: 'Not found.' })
      return
    }
    target = path.join(root, 'index.html')
  }
  const extension = path.extname(target)
  const cache = extension === '.html' || path.basename(target) === 'sw.js' || path.basename(target) === 'theme.js'
    ? 'no-cache'
    : relative.startsWith('assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
  res.statusCode = 200
  res.setHeader('content-type', TYPES[extension] ?? 'application/octet-stream')
  res.setHeader('cache-control', cache)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  if (extension === '.html') {
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    )
  }
  fs.createReadStream(target).pipe(res)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
