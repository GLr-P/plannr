import { describe, expect, it, beforeAll, vi } from 'vitest'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

// The phone's sync service with the browser stand-ins: files from the PC arrive in the phone's file store.
vi.mock('node:fs', async () => await import('../../src/web/shims/fs'))
vi.mock('node:path', async () => await import('../../src/web/shims/path'))

const { DatabaseSync, useSqlite } = await import('../../src/web/shims/sqlite')
const fs = await import('../../src/web/shims/fs')
const { migrate } = await import('../../src/main/db')
const { SyncService } = await import('../../src/main/sync/service')
const { fakeServer } = await import('../support/d1')
type Db = import('../../src/main/db').Db

beforeAll(async () => {
  useSqlite(await sqlite3InitModule())
  fs.useFileStore(new DatabaseSync(':memory:'))
})

describe('files on the phone', () => {
  it('downloads a PC attachment (stored with a Windows path) into the phone file store', async () => {
    const srv = fakeServer()
    const fetcher = (url: string, init: RequestInit) => srv.fetch(url.replace('https://sync.test', ''), init)
    const mk = (dir: string) => {
      const db = new DatabaseSync(':memory:') as unknown as Db
      migrate(db)
      let key: string | null = null
      return { db, svc: new SyncService(db, dir, () => undefined, { fetch: fetcher, getKey: () => key, putKey: (k) => (key = k) }) }
    }
    const pc = mk('/pc')
    const id = '38c7c82c-cd85-4849-8d31-5a99394e4ef0'
    const t = Date.now()
    pc.db
      .prepare("INSERT INTO files (id, name, mime, size, sha256, rel_path, created_at, updated_at) VALUES (?, 'board.png', 'image/png', 3, 'x', ?, ?, ?)")
      .run(id, `attachments\\38\\${id}.png`, t, t)
    fs.writeFileSync(`/pc/attachments/38/${id}.png`, new Uint8Array([7, 7, 7]))
    await pc.svc.setup('https://sync.test', 'owner-secret')
    expect(pc.svc.status().error).toBeNull()
    const phone = mk('/phone')
    await phone.svc.join(pc.svc.link()!)
    await expect.poll(() => phone.svc.status().filesWaiting).toBe(0)
    await new Promise((r) => setTimeout(r, 50))
    expect(fs.existsSync(`/phone/attachments/38/${id}.png`)).toBe(true)
  })
})
