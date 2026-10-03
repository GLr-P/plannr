import type { Db } from '../db'
import { tx } from '../db'
import { getSetting, setSetting } from './settings'
import { reindex as reindexNote } from './notes'
import { reindexCustomer } from './customers'
import { reindexTicket } from './tickets'

/** Bump when what gets indexed changes; the index is then rebuilt once on next start. */
export const SEARCH_INDEX_VERSION = 3

/** Refills the full-text index from the real tables (it's derived data, safe to rebuild any time). */
export function rebuildSearchIndex(db: Db): void {
  tx(db, () => {
    db.exec('DELETE FROM search_index')
    const sources = [
      ['notes', reindexNote],
      ['customers', reindexCustomer],
      ['tickets', reindexTicket]
    ] as const
    for (const [table, reindex] of sources) {
      const rows = db.prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL`).all() as { id: string }[]
      for (const { id } of rows) reindex(db, id)
    }
    setSetting(db, 'searchIndexVersion', SEARCH_INDEX_VERSION)
  })
}

export function ensureSearchIndex(db: Db): void {
  if (getSetting(db, 'searchIndexVersion') !== SEARCH_INDEX_VERSION) rebuildSearchIndex(db)
}
