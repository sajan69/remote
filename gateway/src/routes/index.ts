import crypto from 'node:crypto'
import http from 'node:http'
import { parseProfile } from '@remote/protocol'
import type { HomeAssistant } from '../adapters/ha.ts'
import type { AppConfig } from '../config.ts'
import type { CommandService } from '../commands.ts'
import { HttpError } from '../errors.ts'
import type { Hub } from '../hub.ts'
import { isRecord, readJson } from '../http/request.ts'
import { send } from '../http/response.ts'
import { clientIp, cookie, limit, originAllowed, sessionFrom } from '../http/security.ts'
import { serveStatic } from '../http/static.ts'
import { hashSecret, normalizeCode, timingSafeHexEqual, type Session, type Store } from '../store.ts'
import { setDemo } from '../services/demo.ts'
import { createDevice, patchDevice, requireDevice, submitSaved, trial } from '../services/devices.ts'
import { recordDiagnostic } from '../services/diagnostics.ts'
import { refreshAll, refreshDiscovery, refreshOne, statusBody } from '../services/discovery.ts'
import { learn, saveLearned } from '../services/learn.ts'
import { resetData } from '../services/reset.ts'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

export interface RouteContext {
  config: AppConfig
  store: Store
  commands: CommandService
  ha: HomeAssistant
  hub: Hub
  limits: Map<string, number[]>
}

export async function dispatch(req: http.IncomingMessage, res: http.ServerResponse, ctx: RouteContext): Promise<void> {
  const { config, store, commands, ha, hub, limits } = ctx
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
    send(res, 202, trial(store, commands, body))
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
