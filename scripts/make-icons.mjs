// 外部ライブラリなしでアプリアイコン(PNG)を生成する
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const t = Buffer.concat([Buffer.from(type), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(t))
  return Buffer.concat([len, t, sum])
}

function render(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  const S = size / 512
  const box = (x, y, x0, y0, x1, y1) => x >= x0 * S && x < x1 * S && y >= y0 * S && y < y1 * S
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1)
    for (let x = 0; x < size; x++) {
      // 背景の淡いグラデーション
      const dx = x / size - 0.5
      const dy = y / size - 0.5
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.7)
      let c = [11 + 10 * glow, 15 + 60 * glow, 20 + 75 * glow]
      // 角ブラケット
      const t = 16
      const a = 72
      const b = 140
      const e = 512 - a
      const bracket =
        box(x, y, a, a, b, a + t) || box(x, y, a, a, a + t, b) ||
        box(x, y, e - (b - a), e - t, e, e) || box(x, y, e - t, e - (b - a), e, e)
      if (bracket) c = [34, 211, 238]
      // ダンベル
      const db =
        box(x, y, 196, 244, 316, 268) ||
        box(x, y, 170, 186, 200, 326) || box(x, y, 312, 186, 342, 326) ||
        box(x, y, 134, 212, 164, 300) || box(x, y, 348, 212, 378, 300)
      if (db) c = [230, 237, 243]
      raw[row + 1 + x * 3] = c[0]
      raw[row + 2 + x * 3] = c[1]
      raw[row + 3 + x * 3] = c[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  writeFileSync(new URL(`../public/icons/${name}.png`, import.meta.url), render(size))
}
