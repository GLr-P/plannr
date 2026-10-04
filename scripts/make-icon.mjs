// Generates the app icon (blue rounded square with a white "P") as PNGs and a Windows .ico.
// Run: node scripts/make-icon.mjs   (outputs into resources/)
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const BLUE = [47, 106, 224]

/** Coverage (0..1) of the shape at point (x, y) in unit coordinates. */
function shape(x, y) {
  // Rounded square background
  const r = 0.22
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  const inBg = dx * dx + dy * dy <= r * r
  if (!inBg) return { bg: false, fg: false }
  // Letter P: stem + bowl (ring), bowl centered at (cx, cy)
  const stem = x >= 0.3 && x <= 0.43 && y >= 0.2 && y <= 0.8
  const cx = 0.5
  const cy = 0.395
  const ro = 0.195
  const ri = 0.075
  const d = Math.hypot(x - cx, y - cy)
  const outer = x >= 0.36 && (x <= cx ? Math.abs(y - cy) <= ro : d <= ro)
  const hole = x >= 0.43 && (x <= cx ? Math.abs(y - cy) < ri : d < ri)
  return { bg: true, fg: stem || (outer && !hole) }
}

function render(size) {
  const ss = 4 // supersampling for smooth edges
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = shape((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          if (s.bg) bg++
          if (s.fg) fg++
        }
      }
      const n = ss * ss
      const a = bg / n
      const white = bg ? fg / bg : 0
      const i = (py * size + px) * 4
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BLUE[c] * (1 - white) + 255 * white)
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  return rgba
}

function png(size) {
  const rgba = render(size)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** .ico containing PNG-compressed images (supported since Windows Vista). */
function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: png(s) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ s, data }) => {
    const e = Buffer.alloc(16)
    e[0] = s >= 256 ? 0 : s
    e[1] = s >= 256 ? 0 : s
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

mkdirSync('resources', { recursive: true })
writeFileSync('resources/icon.png', png(256))
writeFileSync('resources/tray.png', png(32))
writeFileSync('resources/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]))
console.log('wrote resources/icon.png, tray.png, icon.ico')
