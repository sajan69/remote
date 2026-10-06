import http from 'node:http'
import { WebSocketServer } from 'ws'
import { executeDevice } from './adapters/execute.ts'
import { HomeAssistant } from './adapters/ha.ts'
import type { AppConfig } from './config.ts'
import { CommandError, CommandService } from './commands.ts'
import { HttpError } from './errors.ts'
import { Hub } from './hub.ts'
import { send } from './http/response.ts'
import { originAllowed, sessionFrom } from './http/security.ts'
import { dispatch } from './routes/index.ts'
import { recordDiagnostic } from './services/diagnostics.ts'
import { applyHaState } from './services/discovery.ts'
import { Store } from './store.ts'

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
    void dispatch(req, res, { config, store, commands, ha, hub, limits }).catch((error: unknown) => {
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
