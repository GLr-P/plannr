import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, openDb, type Db } from '../../src/main/db'
import * as vault from '../../src/main/services/vault'

const FAST = { N: 2 ** 10, r: 8, p: 1 } // cheap KDF for tests; the app uses DEFAULT_KDF

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('encryption primitives', () => {
  it('round-trips and detects tampering, wrong keys and swapped context', () => {
    const key = randomBytes(32)
    const sealed = vault.seal(key, Buffer.from('hunter2'), 'item-1')
    expect(vault.open(key, sealed, 'item-1').toString()).toBe('hunter2')
    expect(() => vault.open(randomBytes(32), sealed, 'item-1')).toThrow()
    expect(() => vault.open(key, sealed, 'item-2')).toThrow() // ciphertext bound to its item
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 1] ^= 1
    expect(() => vault.open(key, tampered, 'item-1')).toThrow()
    // Same plaintext encrypts differently each time (random IV)
    expect(vault.seal(key, Buffer.from('x')).equals(vault.seal(key, Buffer.from('x')))).toBe(false)
  })

  it('recovery keys are 32 base32 chars in groups and tolerate typing variations', () => {
    const k = vault.generateRecoveryKey()
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(vault.normalizeRecoveryKey(` ${k.toLowerCase().replace(/-/g, ' ')} `)).toBe(k.replace(/-/g, ''))
    expect(vault.normalizeRecoveryKey('o0-Il')).toBe('0011')
  })
})

describe('vault setup and unlocking', () => {
  it('sets up once, unlocks with the right passcode only', async () => {
    expect(vault.isVaultSetUp(db)).toBe(false)
    await expect(vault.setupVault(db, '12345', FAST)).rejects.toThrow(/at least 6/)
    const { dek, recoveryKey } = await vault.setupVault(db, 'blue-horse-42', FAST)
    expect(vault.isVaultSetUp(db)).toBe(true)
    await expect(vault.setupVault(db, 'another-pass', FAST)).rejects.toThrow(/already/)
    expect((await vault.unlockWithPasscode(db, 'blue-horse-42'))!.equals(dek)).toBe(true)
    expect(await vault.unlockWithPasscode(db, 'blue-horse-43')).toBeNull()
    expect((await vault.unlockWithRecoveryKey(db, recoveryKey.toLowerCase()))!.equals(dek)).toBe(true)
    expect(await vault.unlockWithRecoveryKey(db, vault.generateRecoveryKey())).toBeNull()
  })

  it('changing the passcode keeps items readable; the old passcode stops working', async () => {
    const { dek } = await vault.setupVault(db, 'first-pass', FAST)
    const item = vault.createItem(db, dek, 'login')
    vault.updateItem(db, dek, item.id, { title: 'Bank', fields: { password: 'p@ss' } })
    await vault.setPasscode(db, dek, 'second-pass', FAST)
    expect(await vault.unlockWithPasscode(db, 'first-pass')).toBeNull()
    const again = (await vault.unlockWithPasscode(db, 'second-pass'))!
    expect(vault.getItem(db, again, item.id)!.fields.password).toBe('p@ss')
  })
})

describe('vault items', () => {
  it('creates, updates, lists (sorted, with subtitles) and deletes', async () => {
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    const login = vault.createItem(db, dek, 'login')
    expect(login.fields).toEqual({ username: '', password: '', url: '', notes: '' })
    vault.updateItem(db, dek, login.id, { title: 'zoho mail', fields: { username: 'me@nanotech.com', password: 'hunter2', bogus: 'x' } })
    const card = vault.createItem(db, dek, 'card')
    vault.updateItem(db, dek, card.id, { title: 'Business Visa', fields: { number: '4111 1111 1111 1234' } })
    const note = vault.createItem(db, dek, 'note')
    vault.updateItem(db, dek, note.id, { title: 'Alarm code', fields: { notes: 'Front door 4321\nBack 1111' } })

    expect(vault.getItem(db, dek, login.id)!.fields).toEqual({ username: 'me@nanotech.com', password: 'hunter2', url: '', notes: '' })
    expect(vault.listItems(db, dek).map((i) => [i.title, i.subtitle])).toEqual([
      ['Alarm code', 'Front door 4321'],
      ['Business Visa', '•••• 1234'],
      ['zoho mail', 'me@nanotech.com']
    ])
    vault.removeItem(db, card.id)
    expect(vault.listItems(db, dek)).toHaveLength(2)
    expect(vault.getItem(db, dek, card.id)).toBeNull()
  })

  it('nothing readable reaches the database file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plannr-vault-'))
    const file = join(dir, 'plannr.db')
    const fileDb = openDb(file)
    const { dek, recoveryKey } = await vault.setupVault(fileDb, 'blue-horse-42', FAST)
    const item = vault.createItem(fileDb, dek, 'login')
    vault.updateItem(fileDb, dek, item.id, { title: 'SecretBankTitle', fields: { username: 'secret-user@x.com', password: 'Hunter2Password' } })
    fileDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fileDb.close()
    const raw = readFileSync(file).toString('latin1')
    for (const secret of ['SecretBankTitle', 'secret-user', 'Hunter2Password', 'blue-horse-42', recoveryKey.replace(/-/g, '')]) {
      expect(raw.includes(secret), secret).toBe(false)
    }
  })

  it('a locked or wrong key cannot read items', async () => {
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    const item = vault.createItem(db, dek, 'note')
    expect(() => vault.getItem(db, randomBytes(32), item.id)).toThrow()
  })
})
