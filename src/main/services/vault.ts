import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import { newId, now, tx } from '../db'
import {
  MIN_PASSCODE_LENGTH,
  VAULT_FIELDS,
  type DocJSON,
  type VaultCustomField,
  type VaultFile,
  type VaultItem,
  type VaultItemKind,
  type VaultItemPatch,
  type VaultItemSummary
} from '../../shared/api'
import { extractText } from './doc'

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

/** What's inside each item's ciphertext. v2 added rich notes and custom fields. */
interface Payload {
  v: 2
  kind: VaultItemKind
  title: string
  fields: Record<string, string>
  custom: VaultCustomField[]
  notes: DocJSON | null
}

const KINDS = new Set<VaultItemKind>(['login', 'card', 'note'])

/** Plain text (the old v1 "notes" field) → a document with one paragraph per line. */
function textToDoc(text: string): DocJSON | null {
  if (!text.trim()) return null
  return {
    type: 'doc',
    content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
  }
}

type RawPayload = { v?: number; kind: VaultItemKind; title: string; fields: Record<string, string>; custom?: VaultCustomField[]; notes?: DocJSON | null }

/** Reads any payload version as v2 (older items are rewritten as v2 on their next save). */
function normalize(raw: RawPayload): Payload {
  if (raw.v === 2) return { v: 2, kind: raw.kind, title: raw.title, fields: raw.fields, custom: raw.custom ?? [], notes: raw.notes ?? null }
  const { notes, ...fields } = raw.fields
  return { v: 2, kind: raw.kind, title: raw.title, fields, custom: [], notes: textToDoc(notes ?? '') }
}

type ItemRow = { id: string; data: string; created_at: number; updated_at: number }

function decrypt(dek: Buffer, row: ItemRow): VaultItem {
  const p = normalize(JSON.parse(open(dek, Buffer.from(row.data, 'base64'), row.id).toString('utf8')) as RawPayload)
  return { id: row.id, kind: p.kind, title: p.title, fields: p.fields, custom: p.custom, notes: p.notes, createdAt: row.created_at, updatedAt: row.updated_at }
}

const encrypt = (dek: Buffer, id: string, payload: Payload): string =>
  seal(dek, Buffer.from(JSON.stringify(payload), 'utf8'), id).toString('base64')

function summaryOf(item: VaultItem, files: FileMeta[]): VaultItemSummary {
  const notesText = extractText(item.notes)
  const attachments = files.filter((f) => !f.inline)
  let subtitle = ''
  if (item.kind === 'login') subtitle = item.fields.username ?? ''
  else if (item.kind === 'card') {
    const digits = (item.fields.number ?? '').replace(/\D/g, '')
    subtitle = digits.length >= 4 ? `•••• ${digits.slice(-4)}` : ''
  }
  if (!subtitle) subtitle = notesText.split('\n')[0].slice(0, 60) || attachments.map((f) => f.name).join(', ')
  const searchText = [notesText, ...item.custom.map((c) => (c.secret ? c.label : `${c.label} ${c.value}`)), ...attachments.map((f) => f.name)].join(' ')
  return { id: item.id, kind: item.kind, title: item.title, subtitle, searchText, fileCount: attachments.length, updatedAt: item.updatedAt }
}

export function listItems(db: Db, dek: Buffer): VaultItemSummary[] {
  const rows = db.prepare('SELECT id, data, created_at, updated_at FROM vault_items WHERE deleted_at IS NULL').all() as ItemRow[]
  const filesByItem = new Map<string, FileMeta[]>()
  for (const f of listFileMetas(db, dek)) filesByItem.set(f.itemId, [...(filesByItem.get(f.itemId) ?? []), f])
  return rows
    .map((r) => {
      const item = decrypt(dek, r)
      return summaryOf(item, filesByItem.get(item.id) ?? [])
    })
    .sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿', undefined, { sensitivity: 'base' }))
}

export function getItem(db: Db, dek: Buffer, id: string): VaultItem | null {
  const row = db.prepare('SELECT id, data, created_at, updated_at FROM vault_items WHERE id = ? AND deleted_at IS NULL').get(id) as ItemRow | undefined
  return row ? decrypt(dek, row) : null
}

export function createItem(db: Db, dek: Buffer, kind: VaultItemKind): VaultItem {
  if (!KINDS.has(kind)) throw new Error(`Unknown vault item kind: ${kind}`)
  const id = newId()
  const t = now()
  const fields = Object.fromEntries(VAULT_FIELDS[kind].map((f) => [f.key, '']))
  const payload: Payload = { v: 2, kind, title: '', fields, custom: [], notes: null }
  db.prepare('INSERT INTO vault_items (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, encrypt(dek, id, payload), t, t)
  return getItem(db, dek, id)!
}

export function updateItem(db: Db, dek: Buffer, id: string, patch: VaultItemPatch): VaultItem {
  return tx(db, () => {
    const item = getItem(db, dek, id)
    if (!item) throw new Error(`Vault item not found: ${id}`)
    const allowed = new Set(VAULT_FIELDS[item.kind].map((f) => f.key))
    const fields = { ...item.fields }
    for (const [k, v] of Object.entries(patch.fields ?? {})) if (allowed.has(k)) fields[k] = String(v).slice(0, 20000)
    const custom = patch.custom
      ? patch.custom.slice(0, 100).map((c) => ({
          id: String(c.id || newId()),
          label: String(c.label ?? '').slice(0, 200),
          value: String(c.value ?? '').slice(0, 20000),
          secret: Boolean(c.secret)
        }))
      : item.custom
    const payload: Payload = {
      v: 2,
      kind: item.kind,
      title: (patch.title ?? item.title).slice(0, 300),
      fields,
      custom,
      notes: patch.notes !== undefined ? patch.notes : item.notes
    }
    db.prepare('UPDATE vault_items SET data = ?, updated_at = ? WHERE id = ?').run(encrypt(dek, id, payload), now(), id)
    return getItem(db, dek, id)!
  })
}

/** Deleting wipes the ciphertext and the item's files (the row stays as a tombstone for future sync). */
export function removeItem(db: Db, dataDir: string, id: string): void {
  tx(db, () => {
    const files = db.prepare('SELECT id FROM vault_files WHERE item_id = ? AND deleted_at IS NULL').all(id) as { id: string }[]
    for (const f of files) removeFile(db, dataDir, f.id)
    db.prepare("UPDATE vault_items SET data = '', deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id)
  })
}

// ---------- Files ----------

export const MAX_VAULT_FILE_BYTES = 200 * 1024 * 1024
/** plannr-vault://file/<id>/<name> — the name is only cosmetic (PDF viewer title, its download button). */
export const vaultFileUrl = (id: string, name = 'file'): string => `plannr-vault://file/${id}/${encodeURIComponent(name)}`

interface FileMeta {
  id: string
  itemId: string
  name: string
  mime: string
  size: number
  inline: boolean
  createdAt: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const filePath = (dataDir: string, id: string): string => join(dataDir, 'vault', `${id}.bin`)

function listFileMetas(db: Db, dek: Buffer, itemId?: string): FileMeta[] {
  const rows = (
    itemId
      ? db.prepare('SELECT id, item_id, meta, created_at FROM vault_files WHERE item_id = ? AND deleted_at IS NULL ORDER BY created_at').all(itemId)
      : db.prepare('SELECT id, item_id, meta, created_at FROM vault_files WHERE deleted_at IS NULL ORDER BY created_at').all()
  ) as { id: string; item_id: string; meta: string; created_at: number }[]
  return rows.map((r) => {
    const m = JSON.parse(open(dek, Buffer.from(r.meta, 'base64'), `file-meta:${r.id}`).toString('utf8')) as Pick<FileMeta, 'name' | 'mime' | 'size' | 'inline'>
    return { ...m, id: r.id, itemId: r.item_id, createdAt: r.created_at }
  })
}

const toVaultFile = (m: FileMeta): VaultFile => ({
  id: m.id,
  itemId: m.itemId,
  name: m.name,
  mime: m.mime,
  size: m.size,
  url: vaultFileUrl(m.id, m.name),
  createdAt: m.createdAt
})

export function addFile(
  db: Db,
  dataDir: string,
  dek: Buffer,
  itemId: string,
  file: { name: string; mime: string; data: Uint8Array; inline?: boolean }
): VaultFile {
  if (!getItem(db, dek, itemId)) throw new Error(`Vault item not found: ${itemId}`)
  if (file.data.byteLength > MAX_VAULT_FILE_BYTES) throw new Error('File is too large (max 200 MB)')
  const id = newId()
  const t = now()
  const meta = {
    name: (file.name || 'file').slice(0, 255),
    mime: file.mime || 'application/octet-stream',
    size: file.data.byteLength,
    inline: Boolean(file.inline)
  }
  mkdirSync(join(dataDir, 'vault'), { recursive: true })
  writeFileSync(filePath(dataDir, id), seal(dek, Buffer.from(file.data), id))
  db.prepare('INSERT INTO vault_files (id, item_id, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    itemId,
    seal(dek, Buffer.from(JSON.stringify(meta)), `file-meta:${id}`).toString('base64'),
    t,
    t
  )
  return toVaultFile({ ...meta, id, itemId, createdAt: t })
}

/** Attachments of an item (inline note images are left out). */
export function listFiles(db: Db, dek: Buffer, itemId: string): VaultFile[] {
  return listFileMetas(db, dek, itemId)
    .filter((m) => !m.inline)
    .map(toVaultFile)
}

/** Decrypts a file into memory. Null for unknown or deleted ids. */
export function readFile(db: Db, dataDir: string, dek: Buffer, id: string): { name: string; mime: string; data: Buffer } | null {
  if (!UUID_RE.test(id)) return null
  const row = db.prepare('SELECT meta FROM vault_files WHERE id = ? AND deleted_at IS NULL').get(id) as { meta: string } | undefined
  if (!row || !existsSync(filePath(dataDir, id))) return null
  const meta = JSON.parse(open(dek, Buffer.from(row.meta, 'base64'), `file-meta:${id}`).toString('utf8')) as { name: string; mime: string }
  return { name: meta.name, mime: meta.mime, data: open(dek, readFileSync(filePath(dataDir, id)), id) }
}

export function removeFile(db: Db, dataDir: string, id: string): void {
  if (!UUID_RE.test(id)) return
  rmSync(filePath(dataDir, id), { force: true })
  db.prepare("UPDATE vault_files SET meta = '', deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id)
}
