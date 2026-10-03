import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { PhotoKind, TicketPhoto } from '../../shared/api'
import { fileUrl } from './files'
import { touchTicket } from './tickets'

const KINDS = new Set<PhotoKind>(['before', 'after'])

function assertKind(kind: PhotoKind): void {
  if (!KINDS.has(kind)) throw new Error(`Unknown photo kind: ${kind}`)
}

export function listPhotos(db: Db, ticketId: string): TicketPhoto[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.ticket_id, p.file_id, p.kind, f.name FROM ticket_photos p JOIN files f ON f.id = p.file_id
       WHERE p.ticket_id = ? AND p.deleted_at IS NULL ORDER BY p.sort, p.created_at`
    )
    .all(ticketId) as { id: string; ticket_id: string; file_id: string; kind: PhotoKind; name: string }[]
  return rows.map((r) => ({ id: r.id, ticketId: r.ticket_id, fileId: r.file_id, kind: r.kind, name: r.name, url: fileUrl(r.file_id) }))
}

export function addPhotos(db: Db, ticketId: string, fileIds: string[], kind: PhotoKind): TicketPhoto[] {
  assertKind(kind)
  return tx(db, () => {
    let { next } = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM ticket_photos WHERE ticket_id = ?').get(ticketId) as { next: number }
    const insert = db.prepare('INSERT INTO ticket_photos (id, ticket_id, file_id, kind, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const t = now()
    for (const fileId of fileIds) insert.run(newId(), ticketId, fileId, kind, next++, t, t)
    touchTicket(db, ticketId)
    return listPhotos(db, ticketId)
  })
}

export function removePhoto(db: Db, id: string): void {
  tx(db, () => {
    const row = db.prepare('SELECT ticket_id FROM ticket_photos WHERE id = ?').get(id) as { ticket_id: string } | undefined
    db.prepare('UPDATE ticket_photos SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
    if (row) touchTicket(db, row.ticket_id)
  })
}

export function setPhotoKind(db: Db, id: string, kind: PhotoKind): void {
  assertKind(kind)
  db.prepare('UPDATE ticket_photos SET kind = ?, updated_at = ? WHERE id = ?').run(kind, now(), id)
}
