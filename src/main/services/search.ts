import type { Db } from '../db'
import type { EntityType, SearchResult } from '../../shared/api'

export function indexEntity(db: Db, type: EntityType, id: string, title: string, body: string, updatedAt: number): void {
  db.prepare('DELETE FROM search_index WHERE id = ?').run(id)
  db.prepare('INSERT INTO search_index (type, id, title, body, updated_at) VALUES (?, ?, ?, ?, ?)').run(type, id, title, body, updatedAt)
}

export function unindexEntity(db: Db, id: string): void {
  db.prepare('DELETE FROM search_index WHERE id = ?').run(id)
}

/**
 * Turns free text into a safe FTS5 query: every word becomes a quoted prefix term, all required.
 * "john@gmail" → "john@gmail"* (a phrase of tokens john, gmail*).
 */
export function buildFtsQuery(input: string): string | null {
  const terms = input
    .normalize('NFKC')
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
  if (terms.length === 0) return null
  return terms.map((t) => `"${t}"*`).join(' ')
}

export function search(db: Db, q: string, opts: { limit?: number; types?: EntityType[] } = {}): SearchResult[] {
  const fts = buildFtsQuery(q)
  if (!fts) return []
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
  const params: (string | number)[] = [fts]
  let typeFilter = ''
  if (opts.types?.length) {
    typeFilter = ` AND type IN (${opts.types.map(() => '?').join(', ')})`
    params.push(...opts.types)
  }
  params.push(limit)
  const rows = db
    .prepare(
      `SELECT type, id, title, updated_at,
              snippet(search_index, 3, char(1), char(2), '…', 12) AS snippet
       FROM search_index
       WHERE search_index MATCH ?${typeFilter}
       ORDER BY bm25(search_index, 0, 0, 8, 1, 0)
       LIMIT ?`
    )
    .all(...params) as { type: EntityType; id: string; title: string; updated_at: number; snippet: string }[]
  return rows.map((r) => ({ type: r.type, id: r.id, title: r.title, snippet: r.snippet, updatedAt: r.updated_at }))
}
