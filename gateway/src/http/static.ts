import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { send } from './response.ts'

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

export async function serveStatic(root: string | null, pathname: string, res: http.ServerResponse): Promise<void> {
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
