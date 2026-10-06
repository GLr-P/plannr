import { describe, expect, it, beforeAll } from 'vitest'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { DatabaseSync as NodeDatabase } from 'node:sqlite'
import { DatabaseSync, useSqlite } from '../../src/web/shims/sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import * as customers from '../../src/main/services/customers'
import * as tickets from '../../src/main/services/tickets'
import * as items from '../../src/main/services/items'
import { search } from '../../src/main/services/search'
import { SyncEngine, type BlobStore, type SyncTransport } from '../../src/main/sync/engine'
import { newSyncKey } from '../../src/shared/sync-crypto'
import { fakeServer } from '../support/d1'

// The phone runs the same services on SQLite compiled to WebAssembly; this checks them on that engine.
beforeAll(async () => {
  useSqlite(await sqlite3InitModule())
})

const webDb = (): Db => {
  const db = new DatabaseSync(':memory:') as unknown as Db
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

describe('the services on WebAssembly SQLite', () => {
  it('migrates, numbers tickets, totals lines and searches (full-text)', () => {
    const db = webDb()
    const c = customers.createCustomer(db, { name: 'Aiyana Bearchild', phone: '(555) 013-2290' })
    const t = tickets.createTicket(db, { customerId: c.id })
    tickets.updateTicket(db, t.id, { device: 'Galaxy S23 charging port' })
    items.addItem(db, t.id, { kind: 'labour', description: 'Port swap', unitCents: 8000 })
    items.addItem(db, t.id, { kind: 'part', description: 'USB-C port', unitCents: 1500, qty: 2 })
    expect(tickets.getTicket(db, t.id)).toMatchObject({ number: 1, priceCents: 11000, customerName: 'Aiyana Bearchild' })
    expect(tickets.listTickets(db, { query: '5550132290' }).map((x) => x.id)).toEqual([t.id])
    const n = notes.createNote(db, { title: 'Port suppliers' })
    notes.updateNote(db, n.id, {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bulk USB-C ports from Mobilesentrix' }] }] }
    })
    expect(search(db, 'mobilesentrix').map((r) => r.id)).toEqual([n.id])
    expect(
      search(db, 'Bearchild')
        .map((r) => r.type)
        .sort()
    ).toEqual(['customer', 'ticket'])
    expect((db.prepare('SELECT ticket_no(42) AS n').get() as { n: string }).n).toMatch(/42$/)
  })

  it('rolls back a failed transaction and reports changes', () => {
    const db = webDb()
    const r = db.prepare("INSERT INTO settings (key, value) VALUES ('a', '1')").run()
    expect(r.changes).toBe(1)
    expect(db.isTransaction).toBe(false)
    expect(() => tickets.updateTicket(db, 'missing-id', { device: 'x' })).toThrow()
    expect(db.isTransaction).toBe(false)
    expect(() => db.prepare('SELECT nope FROM nowhere')).toThrow()
  })

  it('syncs with a PC (node:sqlite) through the service', async () => {
    const srv = fakeServer()
    const key = newSyncKey()
    const blobs: BlobStore = { read: async () => null, write: async () => undefined, has: async () => true }
    const make = async (db: Db, name: string): Promise<SyncEngine> => {
      let token = ''
      const transport: SyncTransport = {
        json: async (method, path, body) => {
          const r = await srv.fetch(path, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
          })
          return (await r.json()) as never
        },
        putBytes: async () => undefined,
        getBytes: async () => null
      }
      const engine = new SyncEngine(db, transport, blobs, name)
      token = (await engine.init(key)).token
      return engine
    }
    const pcDb = new NodeDatabase(':memory:')
    pcDb.exec('PRAGMA foreign_keys = ON')
    migrate(pcDb)
    const phoneDb = webDb()
    const pc = await make(pcDb, 'pc')
    const phone = await make(phoneDb, 'phone')
    await pc.createSpace('owner-secret')
    const c = customers.createCustomer(pcDb, { name: 'Tomasz Nowak' })
    pc.markAllDirty()
    await pc.sync()
    phone.wipeLocal()
    await phone.sync()
    expect(customers.getCustomer(phoneDb, c.id)?.name).toBe('Tomasz Nowak')
    customers.updateCustomer(phoneDb, c.id, { phone: '555-0199' })
    await phone.sync()
    await pc.sync()
    expect(customers.getCustomer(pcDb, c.id)?.phone).toBe('555-0199')
  })
})
