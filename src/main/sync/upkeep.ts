import type { Db } from '../db'
import { tx } from '../db'
import type { DocJSON } from '../../shared/api'
import { reindex as reindexNote } from '../services/notes'
import { reindexCustomer } from '../services/customers'
import { reindexTicket, reindexTicketsOfCustomer } from '../services/tickets'
import { deleteLinksOf, setLinks } from '../services/links'
import { extractMentions } from '../services/doc'
import { loadDisplayPrefs } from '../display'

/**
 * After rows arrive from another device: refresh what this device derives from them (search index, note/ticket links)
 * and reload shared preferences. Derived data never syncs, so each device keeps its own.
 */
export function afterPull(db: Db, touched: Map<string, Set<string>>): void {
  tx(db, () => {
    for (const [tbl, type, reindex] of [
      ['notes', 'note', reindexNote],
      ['tickets', 'ticket', reindexTicket]
    ] as const) {
      for (const id of touched.get(tbl) ?? []) {
        const row = db.prepare(`SELECT content_json FROM ${tbl} WHERE id = ?`).get(id) as { content_json: string | null } | undefined
        if (!row) deleteLinksOf(db, id)
        else setLinks(db, type, id, row.content_json ? extractMentions(JSON.parse(row.content_json) as DocJSON) : [])
        reindex(db, id)
      }
    }
    for (const id of touched.get('customers') ?? []) {
      reindexCustomer(db, id)
      reindexTicketsOfCustomer(db, id) // tickets show the customer's name and phone in search
    }
  })
  if (touched.get('settings')?.has('display')) loadDisplayPrefs(db)
}
