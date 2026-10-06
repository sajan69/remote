import { AdapterError } from '../errors.ts'
import { redact } from '../redact.ts'
import type { HaEntity } from './ha-map.ts'

export interface HaCredentials {
  baseUrl: string
  token: string
}

export class HomeAssistant {
  status = {
    configured: false,
    reachable: false,
    message: 'Home Assistant is not configured.',
  }

  private socket: WebSocket | null = null
  private stopped = false
  private backoff = 1000
  private timer: ReturnType<typeof setTimeout> | null = null
  private activeKey = ''

  constructor(
    private readonly deps: {
      resolve: () => HaCredentials | null
      onState: (entity: HaEntity) => void
    },
  ) {}

  start(): void {
    this.arm(0)
  }

  reload(): void {
    this.socket?.close()
    this.arm(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.close()
  }

  current(): HaCredentials | null {
    const credentials = this.deps.resolve()
    this.status.configured = Boolean(credentials)
    if (!credentials && !this.socket) {
      this.status = {
        configured: false,
        reachable: false,
        message: 'Home Assistant is not configured. Set HA_BASE_URL and HA_TOKEN on the gateway.',
      }
    }
    return credentials
  }

  async getStates(): Promise<HaEntity[]> {
    const body = await this.request('/api/states', { method: 'GET' }, 4000)
    if (!Array.isArray(body)) throw new AdapterError('Home Assistant returned an unexpected device list.', 'gateway_unreachable', false)
    return body.filter(isEntity)
  }

  async getState(entityId: string): Promise<HaEntity | null> {
    try {
      const body = await this.request(`/api/states/${encodeURIComponent(entityId)}`, { method: 'GET' }, 4000)
      return isEntity(body) ? body : null
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'not_found') return null
      throw error
    }
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!/^[a-z_]+$/.test(domain) || !/^[a-z_]+$/.test(service)) {
      throw new AdapterError('The gateway refused an unexpected service call.', 'unsupported_capability', false)
    }
    return this.request(`/api/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, timeoutMs, signal)
  }

  private async request(pathname: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const credentials = this.current()
    if (!credentials) {
      throw new AdapterError('Home Assistant is not configured on the gateway.', 'gateway_unreachable', false)
    }
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(1, timeoutMs))
    try {
      if (signal?.aborted) throw new AdapterError('The request was stopped.', 'cancelled', false)
      const response = await fetch(new URL(pathname, ensureSlash(credentials.baseUrl)), {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${credentials.token}`,
          'content-type': 'application/json',
        },
      })
      if (response.status === 401) {
        throw new AdapterError('Home Assistant rejected the access token.', 'permission_denied', false)
      }
      if (response.status === 404) {
        throw new AdapterError('Home Assistant does not have that entity or service.', 'not_found', false)
      }
      if (!response.ok) {
        const text = redact(await response.text())
        throw new AdapterError(
          text ? `Home Assistant refused the command (${response.status}).` : `Home Assistant returned ${response.status}.`,
          'transmission_failed',
          false,
        )
      }
      if (response.status === 204) return null
      const text = await response.text()
      if (!text) return null
      return JSON.parse(text) as unknown
    } catch (error) {
      if (error instanceof AdapterError) throw error
      if (signal?.aborted && !timedOut) throw new AdapterError('The request was stopped.', 'cancelled', false)
      if (controller.signal.aborted) {
        throw new AdapterError(
          'Home Assistant did not answer before the deadline. The command was not retried.',
          'transmission_timeout',
          true,
        )
      }
      const code = readCauseCode(error)
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        throw new AdapterError('Home Assistant is unreachable from the gateway.', 'gateway_unreachable', false)
      }
      throw new AdapterError(
        'The connection to Home Assistant dropped. The command was not retried.',
        'transmission_timeout',
        true,
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private arm(delay: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), delay)
  }

  private connect(): void {
    if (this.stopped) return
    const credentials = this.current()
    if (!credentials) return
    this.activeKey = `${credentials.baseUrl}`
    let url: URL
    try {
      url = new URL('/api/websocket', ensureSlash(credentials.baseUrl))
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    } catch {
      this.status = { configured: true, reachable: false, message: 'The Home Assistant address is not a valid URL.' }
      return
    }
    const socket = new WebSocket(url)
    this.socket = socket
    let authenticated = false
    socket.addEventListener('message', (event) => {
      const message = parseMessage(event.data)
      if (!message) return
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: credentials.token }))
        return
      }
      if (message.type === 'auth_invalid') {
        authenticated = false
        this.status = { configured: true, reachable: false, message: 'Home Assistant rejected the access token.' }
        socket.close()
        this.backoff = 60_000
        return
      }
      if (message.type === 'auth_ok') {
        authenticated = true
        this.backoff = 1000
        this.status = { configured: true, reachable: true, message: 'Connected to Home Assistant.' }
        socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }))
        return
      }
      if (message.type === 'event') {
        const entity = readStateEvent(message)
        if (entity) this.deps.onState(entity)
      }
    })
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null
      if (!authenticated && this.status.message === 'Connected to Home Assistant.') {
        this.status = { ...this.status, reachable: false, message: 'Home Assistant connection closed.' }
      } else if (authenticated) {
        this.status = { configured: true, reachable: false, message: 'Home Assistant connection closed. Reconnecting.' }
      }
      if (!this.stopped && this.deps.resolve()?.baseUrl === this.activeKey) {
        this.arm(this.backoff)
        this.backoff = Math.min(this.backoff * 2, 30_000)
      }
    })
    socket.addEventListener('error', () => {
      this.status = { configured: true, reachable: false, message: 'Home Assistant is unreachable from the gateway.' }
    })
  }
}

function ensureSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

function isEntity(value: unknown): value is HaEntity {
  if (typeof value !== 'object' || value === null) return false
  const entity = value as HaEntity
  return typeof entity.entity_id === 'string' && typeof entity.state === 'string' && typeof entity.attributes === 'object'
}

function readCauseCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined
  const cause = (error as { cause?: { code?: string } }).cause
  return cause?.code
}

function parseMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = JSON.parse(data) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function readStateEvent(message: Record<string, unknown>): HaEntity | null {
  const event = message.event
  if (typeof event !== 'object' || event === null) return null
  const data = (event as { data?: { new_state?: unknown } }).data
  return data && isEntity(data.new_state) ? data.new_state : null
}
