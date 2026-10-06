import { describe, expect, it, beforeAll, vi } from 'vitest'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

// The vault exactly as the phone runs it: the real vault code on the browser stand-ins for crypto, files and SQLite.
vi.mock('node:crypto', async () => await import('../../src/web/shims/crypto'))
vi.mock('node:fs', async () => await import('../../src/web/shims/fs'))
vi.mock('node:path', async () => await import('../../src/web/shims/path'))

const { DatabaseSync, useSqlite } = await import('../../src/web/shims/sqlite')
const { useFileStore } = await import('../../src/web/shims/fs')
const { migrate } = await import('../../src/main/db')
const { VaultCore } = await import('../../src/main/vault-core')
type Db = import('../../src/main/db').Db

beforeAll(async () => {
  useSqlite(await sqlite3InitModule())
  useFileStore(new DatabaseSync(':memory:'))
})

describe('the vault on the phone', () => {
  it('sets up, locks, unlocks with the passcode or recovery key, and keeps items and files', async () => {
    const db = new DatabaseSync(':memory:') as unknown as Db
    migrate(db)
    const vault = new VaultCore(db, '/data', () => undefined)
    const { recoveryKey } = await vault.setup('long enough passcode')
    const item = vault.create('login')
    vault.update(item.id, { title: 'Supplier portal', fields: { username: 'shop', password: 'hunter22' } })
    const file = vault.addFile(item.id, { name: 'invoice.pdf', mime: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]) })
    vault.lock()
    expect(() => vault.list()).toThrow(/locked/)

    expect(await vault.unlock('wrong passcode!!')).toMatchObject({ ok: false })
    expect(await vault.unlock('long enough passcode')).toEqual({ ok: true })
    expect(vault.list().map((i) => i.title)).toEqual(['Supplier portal'])
    expect(vault.fieldValue(item.id, 'password')).toBe('hunter22')
    expect([...vault.readFile(file.id)!.data]).toEqual([37, 80, 68, 70])

    vault.lock()
    expect(await vault.recover(recoveryKey.toLowerCase(), 'a brand new passcode')).toEqual({ ok: true })
    vault.lock()
    expect(await vault.unlock('a brand new passcode')).toEqual({ ok: true })
  }, 30_000)
})
