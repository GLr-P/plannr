import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Db } from '../db'
import { newId, now } from '../db'
import type { StoredFile } from '../../shared/api'

const MAX_BYTES = 500 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const fileUrl = (id: string): string => `plannr://file/${id}`

/** Copies bytes into Plannr's own attachments folder so links never break if the original moves. */
export function saveFile(db: Db, dataDir: string, input: { name: string; mime: string; data: Uint8Array }): StoredFile {
  if (input.data.byteLength > MAX_BYTES) throw new Error('File is too large (max 500 MB)')
  const id = newId()
  const ext = extname(input.name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)
  const relPath = join('attachments', id.slice(0, 2), id + ext)
  mkdirSync(join(dataDir, 'attachments', id.slice(0, 2)), { recursive: true })
  writeFileSync(join(dataDir, relPath), input.data)
  const sha256 = createHash('sha256').update(input.data).digest('hex')
  const name = input.name.slice(0, 255) || 'file' + ext
  const mime = input.mime || 'application/octet-stream'
  const t = now()
  db.prepare(
    'INSERT INTO files (id, name, mime, size, sha256, rel_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, mime, input.data.byteLength, sha256, relPath, t, t)
  return { id, name, mime, size: input.data.byteLength, url: fileUrl(id) }
}

/** Absolute path for a stored file, or null for unknown/invalid ids. */
export function resolveFilePath(db: Db, dataDir: string, id: string): { path: string; mime: string } | null {
  if (!UUID_RE.test(id)) return null
  const row = db.prepare('SELECT rel_path, mime FROM files WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { rel_path: string; mime: string }
    | undefined
  return row ? { path: join(dataDir, row.rel_path), mime: row.mime } : null
}
