import type { Db } from '../db'
import { now } from '../db'
import type { Backlink, EntityType } from '../../shared/api'

export interface LinkTarget {
  type: EntityType
  id: string
}

/** Replaces all outgoing links of a source. */
export function setLinks(db: Db, srcType: EntityType, srcId: string, targets: LinkTarget[]): void {
  db.prepare('DELETE FROM links WHERE src_type = ? AND src_id = ?').run(srcType, srcId)
  const insert = db.prepare('INSERT OR IGNORE INTO links (src_type, src_id, dst_type, dst_id, created_at) VALUES (?, ?, ?, ?, ?)')
  const t = now()
  for (const target of targets) {
    if (target.id !== srcId) insert.run(srcType, srcId, target.type, target.id, t)
  }
}

export function deleteLinksOf(db: Db, id: string): void {
  db.prepare('DELETE FROM links WHERE src_id = ? OR dst_id = ?').run(id, id)
}

/** Everything (notes, tickets) that links to `id`, most recently edited first. */
export function backlinks(db: Db, id: string): Backlink[] {
  const rows = db
    .prepare(
      `SELECT 'note' AS type, n.id AS id, n.title AS title, n.updated_at AS updated_at
       FROM links l JOIN notes n ON n.id = l.src_id
       WHERE l.dst_id = ? AND l.src_type = 'note' AND n.deleted_at IS NULL
       UNION ALL
       SELECT 'ticket', t.id, ticket_no(t.number) || CASE WHEN t.device <> '' THEN ' · ' || t.device ELSE '' END, t.updated_at
       FROM links l JOIN tickets t ON t.id = l.src_id
       WHERE l.dst_id = ? AND l.src_type = 'ticket' AND t.deleted_at IS NULL
       ORDER BY updated_at DESC`
    )
    .all(id, id) as { type: EntityType; id: string; title: string }[]
  return rows.map((r) => ({ type: r.type, id: r.id, title: r.title }))
}
