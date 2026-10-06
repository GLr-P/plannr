import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import * as customers from '../../src/main/services/customers'
import * as tickets from '../../src/main/services/tickets'
import * as items from '../../src/main/services/items'
import { getSetting, setSetting } from '../../src/main/services/settings'
import { SyncEngine, type BlobStore, type SyncTransport } from '../../src/main/sync/engine'
import { newSyncKey } from '../../src/shared/sync-crypto'
import { fakeServer } from '../support/d1'

type Server = ReturnType<typeof fakeServer>

function transport(srv: Server, token: () => string): SyncTransport {
  const headers = (): Record<string, string> => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' })
  return {
    json: async (method, path, body) => {
      const r = await srv.fetch(path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) })
      const out = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(out.error ?? `HTTP ${r.status}`)
      return out as never
    },
    putBytes: async (path, bytes) => {
      const r = await srv.fetch(path, { method: 'PUT', headers: { Authorization: `Bearer ${token()}` }, body: bytes as Uint8Array<ArrayBuffer> })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    },
    getBytes: async (path) => {
      const r = await srv.fetch(path, { headers: { Authorization: `Bearer ${token()}` } })
      return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer())
    }
  }
}

const memoryBlobs = (): BlobStore & { data: Map<string, Uint8Array> } => {
  const data = new Map<string, Uint8Array>()
  return {
    data,
    read: async (kind, id) => data.get(`${kind}:${id}`) ?? null,
    write: async (kind, id, _row, bytes) => void data.set(`${kind}:${id}`, bytes),
    has: async (kind, id) => data.has(`${kind}:${id}`)
  }
}

interface Device {
  db: Db
  engine: SyncEngine
  blobs: ReturnType<typeof memoryBlobs>
}

async function device(srv: Server, key: string, name: string): Promise<Device> {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  const blobs = memoryBlobs()
  let token = ''
  const engine = new SyncEngine(db, transport(srv, () => token), blobs, name)
  token = (await engine.init(key)).token
  return { db, engine, blobs }
}

const tick = () => new Promise((r) => setTimeout(r, 5))
let srv: Server
let key: string
let a: Device
let b: Device

beforeEach(async () => {
  srv = fakeServer()
  key = newSyncKey()
  a = await device(srv, key, 'pc-a')
  b = await device(srv, key, 'pc-b')
  await a.engine.createSpace('owner-secret')
})

describe('sync between devices', () => {
  it('a second device receives everything: notes, customers, tickets with their lines, shared settings', async () => {
    const n = notes.createNote(a.db, { title: 'Supplier list' })
    notes.updateNote(a.db, n.id, { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Screens from iFixit' }] }] } })
    const c = customers.createCustomer(a.db, { name: 'Jane Doe', phone: '555-0100' })
    const t = tickets.createTicket(a.db, { customerId: c.id })
    items.addItem(a.db, t.id, { kind: 'labour', description: 'Screen swap', unitCents: 6000 })
    setSetting(a.db, 'business', { name: 'Maple Repair Co.' })
    setSetting(a.db, 'theme', 'dark') // per device: stays here
    a.engine.markAllDirty()
    expect((await a.engine.sync()).pushed).toBeGreaterThan(5)

    await b.engine.sync()
    expect(notes.getNote(b.db, n.id)).toMatchObject({ title: 'Supplier list', preview: 'Screens from iFixit' })
    expect(customers.getCustomer(b.db, c.id)?.name).toBe('Jane Doe')
    expect(items.listItems(b.db, t.id)).toHaveLength(1)
    expect(tickets.getTicket(b.db, t.id)).toMatchObject({ customerId: c.id, priceCents: 6000 })
    expect(getSetting(b.db, 'business')).toEqual({ name: 'Maple Repair Co.' })
    expect(getSetting(b.db, 'theme')).toBeNull()
    expect(b.engine.pendingCount()).toBe(0) // what came in isn't sent back
  })

  it('edits go both ways; deleting a row on one device deletes it on the other', async () => {
    const t = tickets.createTicket(a.db, {})
    const [line] = items.addItem(a.db, t.id, { kind: 'labour', unitCents: 1000 })
    await a.engine.sync()
    await b.engine.sync()
    tickets.updateTicket(b.db, t.id, { device: 'iPad 9' })
    items.removeItem(b.db, line.id)
    await b.engine.sync()
    await a.engine.sync()
    expect(tickets.getTicket(a.db, t.id)?.device).toBe('iPad 9')
    expect(items.listItems(a.db, t.id)).toEqual([])
  })

  it('when both devices change the same thing, the later change wins everywhere', async () => {
    const n = notes.createNote(a.db, { title: 'Draft' })
    await a.engine.sync()
    await b.engine.sync()
    notes.updateNote(b.db, n.id, { title: 'From the phone' })
    await tick()
    notes.updateNote(a.db, n.id, { title: 'From the PC (later)' })
    await b.engine.sync() // B's older change reaches the server first
    await a.engine.sync() // A pulls B's change, keeps its own newer one, and pushes it
    await b.engine.sync()
    expect(notes.getNote(a.db, n.id)?.title).toBe('From the PC (later)')
    expect(notes.getNote(b.db, n.id)?.title).toBe('From the PC (later)')
  })

  it('files travel encrypted: the server never sees their contents; the other device downloads them', async () => {
    const id = '0123456789abcdef0123456789abcdef'
    const t = Date.now()
    a.db.prepare("INSERT INTO files (id, name, mime, size, sha256, rel_path, created_at, updated_at) VALUES (?, 'board.png', 'image/png', 40, 'x', 'attachments/01/x.png', ?, ?)").run(id, t, t)
    const secret = new TextEncoder().encode('Customer passcode is 4417, back cover')
    a.blobs.data.set(`file:${id}`, secret)
    await a.engine.sync()
    const stored = srv.env.DB.prepare('SELECT data FROM blobs').all<{ data: Uint8Array }>()
    const raw = (await stored).results[0].data
    expect(Buffer.from(raw).toString('latin1')).not.toContain('passcode') // sealed
    expect(raw.length).toBe(secret.length + 12 + 16) // IV + contents + tag

    await b.engine.sync()
    const missing = await b.engine.missingBlobs()
    expect(missing.map((m) => m.id)).toEqual([id])
    await b.engine.downloadBlob('file', id, missing[0].row)
    expect(new TextDecoder().decode(b.blobs.data.get(`file:${id}`)!)).toBe('Customer passcode is 4417, back cover')
  })

  it('the server stores only sealed rows, and refuses a wrong code or setup secret', async () => {
    customers.createCustomer(a.db, { name: 'Very Private Name' })
    await a.engine.sync()
    const rows = (await srv.env.DB.prepare('SELECT data FROM changes').all<{ data: string }>()).results
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.map((r) => r.data).join('')).not.toContain('Very Private')

    const stranger = await device(srv, newSyncKey(), 'stranger')
    await expect(stranger.engine.createSpace('wrong')).rejects.toThrow(/Wrong setup code/)
    await expect(stranger.engine.hello()).rejects.toThrow(/Not allowed/)
  })
})
