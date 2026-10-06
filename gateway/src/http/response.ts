import http from 'node:http'

export function send(res: http.ServerResponse, status: number, body: unknown): void {
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
