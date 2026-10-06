/*
 * The node:fs functions Plannr's services use, for the phone web app. Files (attachments, photos, vault files) are
 * kept in their own SQLite database in the browser's private storage, so reads and writes stay synchronous.
 */
import { Buffer } from 'buffer'
import type { DatabaseSync } from './sqlite'

let store: DatabaseSync | null = null

/** Opens the file store (call once at start-up, before using the services). */
export function useFileStore(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, data BLOB NOT NULL, updated_at INTEGER NOT NULL)')
  store = db
}

const s = (): DatabaseSync => {
  if (!store) throw new Error('File store not open')
  return store
}
const key = (p: string): string => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
const enoent = (p: string): Error => Object.assign(new Error(`ENOENT: no such file, '${p}'`), { code: 'ENOENT' })

export function existsSync(p: string): boolean {
  const k = key(p)
  return Boolean(s().prepare('SELECT 1 FROM files WHERE path = ? OR (path >= ? AND path < ?) LIMIT 1').get(k, `${k}/`, `${k}0`))
}

export function mkdirSync(_p: string, _opts?: unknown): void {
  // folders aren't stored: a file's path is enough
}

export function readFileSync(p: string, encoding?: 'utf8' | 'utf-8' | { encoding?: string }): Buffer | string {
  const row = s().prepare('SELECT data FROM files WHERE path = ?').get(key(p)) as { data: Uint8Array } | undefined
  if (!row) throw enoent(p)
  const buf = Buffer.from(row.data)
  const enc = typeof encoding === 'string' ? encoding : encoding?.encoding
  return enc ? buf.toString('utf8') : buf
}

export function writeFileSync(p: string, data: Uint8Array | string): void {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  s()
    .prepare(
      'INSERT INTO files (path, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    )
    .run(key(p), bytes, Date.now())
}

export function renameSync(from: string, to: string): void {
  s().prepare('DELETE FROM files WHERE path = ?').run(key(to))
  if (!s().prepare('UPDATE files SET path = ? WHERE path = ?').run(key(to), key(from)).changes) throw enoent(from)
}

export function copyFileSync(from: string, to: string): void {
  writeFileSync(to, readFileSync(from) as Buffer)
}

export function unlinkSync(p: string): void {
  if (!s().prepare('DELETE FROM files WHERE path = ?').run(key(p)).changes) throw enoent(p)
}

export function rmSync(p: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
  const k = key(p)
  let n = s().prepare('DELETE FROM files WHERE path = ?').run(k).changes
  if (opts.recursive) n += s().prepare('DELETE FROM files WHERE path >= ? AND path < ?').run(`${k}/`, `${k}0`).changes
  if (!n && !opts.force) throw enoent(p)
}

export default { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync, rmSync }
