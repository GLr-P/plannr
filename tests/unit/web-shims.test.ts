import { describe, expect, it, beforeAll } from 'vitest'
import * as nodeCrypto from 'node:crypto'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as webCrypto from '../../src/web/shims/crypto'
import * as webPath from '../../src/web/shims/path'
import * as webFs from '../../src/web/shims/fs'
import { DatabaseSync, useSqlite } from '../../src/web/shims/sqlite'
import { open, seal } from '../../src/main/services/vault'

// The phone's stand-ins for node:crypto, node:path and node:fs must behave like the real ones.
beforeAll(async () => {
  useSqlite(await sqlite3InitModule())
})

const scryptWith = (impl: typeof webCrypto.scrypt, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => impl('correct horse battery', salt, 32, { N: 1024, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))))

describe('crypto stand-in', () => {
  it('opens what the PC sealed, and the PC opens what it seals (AES-256-GCM with associated data)', () => {
    const key = nodeCrypto.randomBytes(32)
    const sealedOnPc = seal(key, Buffer.from('Alarm code 2468'), 'item:abc')
    const d = webCrypto.createDecipheriv('aes-256-gcm', key, sealedOnPc.subarray(0, 12))
    d.setAuthTag(sealedOnPc.subarray(12, 28))
    d.setAAD(Buffer.from('item:abc'))
    expect(Buffer.concat([d.update(sealedOnPc.subarray(28)), d.final()]).toString()).toBe('Alarm code 2468')

    const iv = webCrypto.randomBytes(12)
    const c = webCrypto.createCipheriv('aes-256-gcm', key, iv)
    c.setAAD(Buffer.from('item:xyz'))
    const ct = Buffer.concat([c.update(Buffer.from('Wi-Fi: shop-guest')), c.final()])
    const sealedOnPhone = Buffer.concat([iv, c.getAuthTag(), ct])
    expect(open(key, sealedOnPhone, 'item:xyz').toString()).toBe('Wi-Fi: shop-guest')
    expect(() => open(key, sealedOnPhone, 'item:other')).toThrow() // bound to its item
  })

  it('refuses tampered data', () => {
    const key = nodeCrypto.randomBytes(32)
    const sealed = seal(key, Buffer.from('secret'))
    sealed[sealed.length - 1] ^= 1
    const d = webCrypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12))
    d.setAuthTag(sealed.subarray(12, 28))
    d.update(sealed.subarray(28))
    expect(() => d.final()).toThrow()
  })

  it('derives the same key from a passcode (scrypt) and the same SHA-256', async () => {
    const salt = nodeCrypto.randomBytes(16)
    expect((await scryptWith(webCrypto.scrypt, salt)).toString('hex')).toBe((await scryptWith(nodeCrypto.scrypt as never, salt)).toString('hex'))
    expect(webCrypto.createHash('sha256').update('plannr').digest('hex')).toBe(nodeCrypto.createHash('sha256').update('plannr').digest('hex'))
    expect(webCrypto.randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('path stand-in', () => {
  it('joins with forward slashes and understands paths made on Windows', () => {
    expect(webPath.join('/data', 'attachments\\ab\\abcd.png')).toBe('/data/attachments/ab/abcd.png')
    expect(webPath.join('/data', 'vault', 'x.bin')).toBe('/data/vault/x.bin')
    expect(webPath.extname('photo.JPG')).toBe('.JPG')
    expect(webPath.dirname('/data/attachments/ab/x.png')).toBe('/data/attachments/ab')
  })
})

describe('file stand-in', () => {
  it('writes, reads, renames and removes files kept in SQLite', () => {
    webFs.useFileStore(new DatabaseSync(':memory:'))
    webFs.writeFileSync('/data/attachments/ab/one.png', new Uint8Array([1, 2, 3]))
    expect(webFs.existsSync('/data/attachments\\ab\\one.png')).toBe(true)
    expect(webFs.existsSync('/data/attachments')).toBe(true) // a folder with something in it
    expect([...(webFs.readFileSync('/data/attachments/ab/one.png') as Buffer)]).toEqual([1, 2, 3])
    webFs.writeFileSync('/data/notes.txt', 'hello')
    expect(webFs.readFileSync('/data/notes.txt', 'utf8')).toBe('hello')
    webFs.renameSync('/data/notes.txt', '/data/renamed.txt')
    expect(webFs.existsSync('/data/notes.txt')).toBe(false)
    webFs.rmSync('/data/attachments', { recursive: true, force: true })
    expect(webFs.existsSync('/data/attachments/ab/one.png')).toBe(false)
    expect(() => webFs.readFileSync('/data/nothing')).toThrow(/ENOENT/)
  })
})
