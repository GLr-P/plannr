import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, openDb, type Db } from '../../src/main/db'
import * as vault from '../../src/main/services/vault'
import type { DocJSON } from '../../src/shared/api'

const FAST = { N: 2 ** 10, r: 8, p: 1 } // cheap KDF for tests; the app uses DEFAULT_KDF
const doc = (...lines: string[]): DocJSON => ({
  type: 'doc',
  content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }))
})
const tempDir = (): string => mkdtempSync(join(tmpdir(), 'plannr-vault-'))

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
    expect(login.fields).toEqual({ username: '', password: '', url: '' })
    expect(login.notes).toBeNull()
    expect(login.custom).toEqual([])
    vault.updateItem(db, dek, login.id, { title: 'zoho mail', fields: { username: 'me@nanotech.com', password: 'hunter2', bogus: 'x' } })
    const card = vault.createItem(db, dek, 'card')
    vault.updateItem(db, dek, card.id, { title: 'Business Visa', fields: { number: '4111 1111 1111 1234' } })
    const note = vault.createItem(db, dek, 'note')
    vault.updateItem(db, dek, note.id, { title: 'Alarm code', notes: doc('Front door 4321', 'Back 1111') })

    expect(vault.getItem(db, dek, login.id)!.fields).toEqual({ username: 'me@nanotech.com', password: 'hunter2', url: '' })
    expect(vault.listItems(db, dek).map((i) => [i.title, i.subtitle])).toEqual([
      ['Alarm code', 'Front door 4321'],
      ['Business Visa', '•••• 1234'],
      ['zoho mail', 'me@nanotech.com']
    ])
    vault.removeItem(db, tempDir(), card.id)
    expect(vault.listItems(db, dek)).toHaveLength(2)
    expect(vault.getItem(db, dek, card.id)).toBeNull()
  })

  it('nothing readable reaches the database file', async () => {
    const file = join(tempDir(), 'plannr.db')
    const fileDb = openDb(file)
    const { dek, recoveryKey } = await vault.setupVault(fileDb, 'blue-horse-42', FAST)
    const item = vault.createItem(fileDb, dek, 'login')
    vault.updateItem(fileDb, dek, item.id, {
      title: 'SecretBankTitle',
      fields: { username: 'secret-user@x.com', password: 'Hunter2Password' },
      notes: doc('SecretNoteText'),
      custom: [{ id: 'c', label: 'SecretLabel', value: 'SecretValue', secret: false }]
    })
    fileDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fileDb.close()
    const raw = readFileSync(file).toString('latin1')
    for (const secret of ['SecretBankTitle', 'secret-user', 'Hunter2Password', 'SecretNoteText', 'SecretLabel', 'SecretValue', 'blue-horse-42', recoveryKey.replace(/-/g, '')]) {
      expect(raw.includes(secret), secret).toBe(false)
    }
  })

  it('a locked or wrong key cannot read items', async () => {
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    const item = vault.createItem(db, dek, 'note')
    expect(() => vault.getItem(db, randomBytes(32), item.id)).toThrow()
  })
})

describe('rich notes, custom fields and older items', () => {
  it('stores rich notes and custom fields; vault search text covers them (but not secret values)', async () => {
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    const item = vault.createItem(db, dek, 'login')
    vault.updateItem(db, dek, item.id, {
      title: 'Bank',
      notes: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Branch info' }] }] },
      custom: [
        { id: 'a', label: 'Account #', value: '12345678', secret: false },
        { id: 'b', label: 'Security answer', value: 'Fluffy', secret: true }
      ]
    })
    const got = vault.getItem(db, dek, item.id)!
    expect(got.notes!.content![0].type).toBe('heading')
    expect(got.custom.map((c) => [c.label, c.value, c.secret])).toEqual([
      ['Account #', '12345678', false],
      ['Security answer', 'Fluffy', true]
    ])
    const [summary] = vault.listItems(db, dek)
    expect(summary.searchText).toContain('Branch info')
    expect(summary.searchText).toContain('12345678')
    expect(summary.searchText).toContain('Security answer')
    expect(summary.searchText).not.toContain('Fluffy')
  })

  it('reads items saved by the first vault version (plain-text notes) as rich notes', async () => {
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    const id = 'old-item'
    const v1 = { kind: 'login', title: 'Old', fields: { username: 'u', password: 'p', url: '', notes: 'line one\nline two' } }
    db.prepare('INSERT INTO vault_items (id, data, created_at, updated_at) VALUES (?, ?, 1, 1)').run(
      id,
      vault.seal(dek, Buffer.from(JSON.stringify(v1)), id).toString('base64')
    )
    const item = vault.getItem(db, dek, id)!
    expect(item.fields).toEqual({ username: 'u', password: 'p', url: '' })
    expect(item.notes).toEqual(doc('line one', 'line two'))
    expect(item.custom).toEqual([])
  })
})

describe('vault files', () => {
  it('encrypts files at rest, reads them back, hides inline images from attachments, and deletes with the item', async () => {
    const dir = tempDir()
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    const item = vault.createItem(db, dek, 'note')
    const content = Buffer.from('%PDF-1.4 TOP-SECRET-INSURANCE-POLICY-NUMBER')
    const pdf = vault.addFile(db, dir, dek, item.id, { name: 'Insurance policy.pdf', mime: 'application/pdf', data: content })
    vault.addFile(db, dir, dek, item.id, { name: 'pasted.png', mime: 'image/png', data: new Uint8Array([1, 2]), inline: true })

    expect(pdf.url).toBe(`plannr-vault://file/${pdf.id}/Insurance%20policy.pdf`)
    expect(vault.listFiles(db, dek, item.id).map((f) => f.name)).toEqual(['Insurance policy.pdf'])
    const back = vault.readFile(db, dir, dek, pdf.id)!
    expect(back.mime).toBe('application/pdf')
    expect(back.data.equals(content)).toBe(true)
    expect(vault.listItems(db, dek)[0]).toMatchObject({ fileCount: 1, searchText: expect.stringContaining('Insurance policy.pdf') })

    // Neither the content nor the file name is readable on disk
    const binPath = join(dir, 'vault', `${pdf.id}.bin`)
    expect(readFileSync(binPath).toString('latin1')).not.toContain('TOP-SECRET')
    const metaRow = db.prepare('SELECT meta FROM vault_files WHERE id = ?').get(pdf.id) as { meta: string }
    expect(Buffer.from(metaRow.meta, 'base64').toString('latin1')).not.toContain('Insurance')
    expect(() => vault.readFile(db, dir, randomBytes(32), pdf.id)).toThrow() // wrong key
    expect(vault.readFile(db, dir, dek, '../plannr.db')).toBeNull()

    vault.removeItem(db, dir, item.id)
    expect(existsSync(binPath)).toBe(false)
    expect(vault.readFile(db, dir, dek, pdf.id)).toBeNull()
  })

  it('rejects files for unknown items', async () => {
    const { dek } = await vault.setupVault(db, 'blue-horse-42', FAST)
    expect(() => vault.addFile(db, tempDir(), dek, 'nope', { name: 'a', mime: 'text/plain', data: new Uint8Array([1]) })).toThrow(/not found/)
  })
})
