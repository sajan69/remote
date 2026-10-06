import type { WebSocket } from 'ws'
import type { CommandRecord, DeviceState } from '@remote/protocol'

export type GatewayEvent =
  | { type: 'command'; command: CommandRecord }
  | { type: 'state'; deviceId: string; state: DeviceState }
  | { type: 'devices' }
  | { type: 'demo'; enabled: boolean }

export class Hub {
  private readonly clients = new Set<WebSocket>()

  add(socket: WebSocket): void {
    this.clients.add(socket)
    socket.on('close', () => this.clients.delete(socket))
  }

  publish(event: GatewayEvent): void {
    const payload = JSON.stringify(event)
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload)
    }
  }

  close(): void {
    for (const client of this.clients) client.close()
    this.clients.clear()
  }
}
