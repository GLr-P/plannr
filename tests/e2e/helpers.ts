import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

export const root = resolve(__dirname, '../..')
export const shotsDir = join(root, 'test-results', 'screens')
mkdirSync(shotsDir, { recursive: true })

/** Launches the built app (out/) with an isolated data folder. */
export async function launch(dataDir: string, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE // set by VS Code; would make Electron act as plain Node
  env.PLANNR_DATA_DIR = dataDir
  Object.assign(env, extraEnv)
  const app = await electron.launch({ args: [root], env })
  const page = await app.firstWindow()
  await page.waitForSelector('.sidebar')
  await page.setViewportSize({ width: 1320, height: 820 })
  return { app, page }
}

export const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(shotsDir, `${name}.png`) })

/** Builds a real PNG (soft gradient) so image tests exercise decoding, not just upload. */
export function makePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3
      raw[i] = 60 + Math.round((x / width) * 120)
      raw[i + 1] = 110 + Math.round((y / height) * 90)
      raw[i + 2] = 200
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
