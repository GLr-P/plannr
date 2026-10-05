import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto'
import type { Db } from '../db'
import { newId, now, tx } from '../db'
import {
  MIN_PASSCODE_LENGTH,
  VAULT_FIELDS,
  type VaultItem,
  type VaultItemKind,
  type VaultItemSummary
} from '../../shared/api'

/*
 * Vault encryption
 * ----------------
 * - A random 256-bit data key (DEK) encrypts every item with AES-256-GCM (authenticated; the item id is bound in as
 *   additional data, so ciphertexts can't be swapped between items).
 * - The DEK is stored only "wrapped": encrypted by a key derived from the passcode with scrypt, and separately by a key
 *   derived from the recovery key. Changing the passcode re-wraps the DEK; items are untouched.
 * - Nothing readable is written to disk: titles, fields and even the item kind are inside the ciphertext.
 */

export interface KdfParams {
  N: number
  r: number
  p: number
}
/** ~0.2 s and 128 MB per attempt on this machine: instant for you, very slow for guessing. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 }

function scrypt(secret: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 512 * 1024 * 1024 }
  return new Promise((resolve, reject) =>
    scryptCallback(secret.normalize('NFKC'), salt, 32, options, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

const IV_BYTES = 12
const TAG_BYTES = 16

/** AES-256-GCM: returns iv | tag | ciphertext. */
export function seal(key: Buffer, plaintext: Buffer, aad?: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (aad) cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct])
}

/** Decrypts `seal` output; throws if the key is wrong or the data was tampered with. */
export function open(key: Buffer, sealed: Buffer, aad?: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV_BYTES))
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  if (aad) decipher.setAAD(Buffer.from(aad))
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])
}

// ---------- Recovery key: 160 random bits as 32 Crockford base32 characters, e.g. 7KQM-2XPA-… ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRecoveryKey(): string {
  const bytes = randomBytes(20)
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

/** Accepts the key typed with or without dashes/spaces, in any case, with O/I/L typos. */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

// ---------- Keys ----------

type KeyId = 'passcode' | 'recovery'

export function isVaultSetUp(db: Db): boolean {
  return Boolean(db.prepare("SELECT 1 FROM vault_keys WHERE id = 'passcode'").get())
}

export function validatePasscode(passcode: string): string | null {
  if (passcode.length < MIN_PASSCODE_LENGTH) return `Use at least ${MIN_PASSCODE_LENGTH} characters.`
  return null
}

async function storeWrappedKey(db: Db, id: KeyId, secret: string, dek: Buffer, params: KdfParams): Promise<void> {
  const salt = randomBytes(16)
  const kek = await scrypt(secret, salt, params)
  const wrapped = seal(kek, dek, `vault-key:${id}`)
  kek.fill(0)
  db.prepare(
    `INSERT INTO vault_keys (id, salt, params, wrapped, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, params = excluded.params, wrapped = excluded.wrapped, updated_at = excluded.updated_at`
  ).run(id, salt.toString('base64'), JSON.stringify(params), wrapped.toString('base64'), now())
}

async function unwrapKey(db: Db, id: KeyId, secret: string): Promise<Buffer | null> {
  const row = db.prepare('SELECT salt, params, wrapped FROM vault_keys WHERE id = ?').get(id) as
    | { salt: string; params: string; wrapped: string }
    | undefined
  if (!row) return null
  const kek = await scrypt(secret, Buffer.from(row.salt, 'base64'), JSON.parse(row.params) as KdfParams)
  try {
    return open(kek, Buffer.from(row.wrapped, 'base64'), `vault-key:${id}`)
  } catch {
    return null // wrong passcode/recovery key
  } finally {
    kek.fill(0)
  }
}

/** First-time setup: creates the data key, wraps it with the passcode and a new recovery key. */
export async function setupVault(db: Db, passcode: string, params = DEFAULT_KDF): Promise<{ dek: Buffer; recoveryKey: string }> {
  if (isVaultSetUp(db)) throw new Error('The vault is already set up')
  const problem = validatePasscode(passcode)
  if (problem) throw new Error(problem)
  const dek = randomBytes(32)
  const recoveryKey = generateRecoveryKey()
  await storeWrappedKey(db, 'passcode', passcode, dek, params)
  await storeWrappedKey(db, 'recovery', normalizeRecoveryKey(recoveryKey), dek, params)
  return { dek, recoveryKey }
}

export const unlockWithPasscode = (db: Db, passcode: string): Promise<Buffer | null> => unwrapKey(db, 'passcode', passcode)

export const unlockWithRecoveryKey = (db: Db, recoveryKey: string): Promise<Buffer | null> =>
  unwrapKey(db, 'recovery', normalizeRecoveryKey(recoveryKey))

/** Re-wraps the (already unlocked) data key with a new passcode. Items don't change. */
export async function setPasscode(db: Db, dek: Buffer, passcode: string, params = DEFAULT_KDF): Promise<void> {
  const problem = validatePasscode(passcode)
  if (problem) throw new Error(problem)
  await storeWrappedKey(db, 'passcode', passcode, dek, params)
}

// ---------- Items ----------

interface Payload {
  kind: VaultItemKind
  title: string
  fields: Record<string, string>
}

const KINDS = new Set<VaultItemKind>(['login', 'card', 'note'])

function decrypt(dek: Buffer, row: { id: string; data: string; created_at: number; updated_at: number }): VaultItem {
  const payload = JSON.parse(open(dek, Buffer.from(row.data, 'base64'), row.id).toString('utf8')) as Payload
  return { id: row.id, kind: payload.kind, title: payload.title, fields: payload.fields, createdAt: row.created_at, updatedAt: row.updated_at }
}

const encrypt = (dek: Buffer, id: string, payload: Payload): string =>
  seal(dek, Buffer.from(JSON.stringify(payload), 'utf8'), id).toString('base64')

function summaryOf(item: VaultItem): VaultItemSummary {
  let subtitle = ''
  if (item.kind === 'login') subtitle = item.fields.username ?? ''
  else if (item.kind === 'card') {
    const digits = (item.fields.number ?? '').replace(/\D/g, '')
    subtitle = digits.length >= 4 ? `•••• ${digits.slice(-4)}` : ''
  } else subtitle = (item.fields.notes ?? '').split('\n')[0].slice(0, 60)
  return { id: item.id, kind: item.kind, title: item.title, subtitle, updatedAt: item.updatedAt }
}

export function listItems(db: Db, dek: Buffer): VaultItemSummary[] {
  const rows = db.prepare('SELECT id, data, created_at, updated_at FROM vault_items WHERE deleted_at IS NULL').all() as {
    id: string
    data: string
    created_at: number
    updated_at: number
  }[]
  return rows
    .map((r) => summaryOf(decrypt(dek, r)))
    .sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿', undefined, { sensitivity: 'base' }))
}

export function getItem(db: Db, dek: Buffer, id: string): VaultItem | null {
  const row = db.prepare('SELECT id, data, created_at, updated_at FROM vault_items WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { id: string; data: string; created_at: number; updated_at: number }
    | undefined
  return row ? decrypt(dek, row) : null
}

export function createItem(db: Db, dek: Buffer, kind: VaultItemKind): VaultItem {
  if (!KINDS.has(kind)) throw new Error(`Unknown vault item kind: ${kind}`)
  const id = newId()
  const t = now()
  const fields = Object.fromEntries(VAULT_FIELDS[kind].map((f) => [f.key, '']))
  db.prepare('INSERT INTO vault_items (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, encrypt(dek, id, { kind, title: '', fields }), t, t)
  return getItem(db, dek, id)!
}

export function updateItem(db: Db, dek: Buffer, id: string, patch: { title?: string; fields?: Record<string, string> }): VaultItem {
  return tx(db, () => {
    const item = getItem(db, dek, id)
    if (!item) throw new Error(`Vault item not found: ${id}`)
    const allowed = new Set(VAULT_FIELDS[item.kind].map((f) => f.key))
    const fields = { ...item.fields }
    for (const [k, v] of Object.entries(patch.fields ?? {})) if (allowed.has(k)) fields[k] = String(v).slice(0, 20000)
    const payload: Payload = { kind: item.kind, title: (patch.title ?? item.title).slice(0, 300), fields }
    db.prepare('UPDATE vault_items SET data = ?, updated_at = ? WHERE id = ?').run(encrypt(dek, id, payload), now(), id)
    return getItem(db, dek, id)!
  })
}

/** Deleting wipes the ciphertext too (the row stays as a tombstone for future sync). */
export function removeItem(db: Db, id: string): void {
  db.prepare("UPDATE vault_items SET data = '', deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id)
}
