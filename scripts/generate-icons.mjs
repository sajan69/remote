import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = path.resolve('web/public')

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const center = (size - 1) / 2
  const outer = size * 0.28
  const inner = size * 0.2
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const distance = Math.hypot(dx, dy)
      const stem = Math.abs(dx) < size * 0.035 && dy < -inner && dy > -outer - size * 0.08
      const ring = distance <= outer && distance >= inner && !stem
      const pixel = ring || stem ? [240, 162, 2, 255] : [18, 16, 14, 255]
      const offset = row + 1 + x * 4
      raw[offset] = pixel[0]
      raw[offset + 1] = pixel[1]
      raw[offset + 2] = pixel[2]
      raw[offset + 3] = pixel[3]
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, chunk('IHDR', ihdr(size)), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function ihdr(size) {
  const buffer = Buffer.alloc(13)
  buffer.writeUInt32BE(size, 0)
  buffer.writeUInt32BE(size, 4)
  buffer[8] = 8
  buffer[9] = 6
  return buffer
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuffer, data])) >>> 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

fs.mkdirSync(root, { recursive: true })
fs.writeFileSync(path.join(root, 'icon-192.png'), png(192))
fs.writeFileSync(path.join(root, 'icon-512.png'), png(512))
