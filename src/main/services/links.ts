import type { Db } from '../db'
import { now } from '../db'
import type { EntityType } from '../../shared/api'

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
