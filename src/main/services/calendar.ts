import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { CalendarEvent, EntityType, EventInput, EventKind, EventUpdate, ReminderKind } from '../../shared/api'
import { isDate } from './doc'

const REMINDER_KINDS = new Set<ReminderKind>(['day_before', 'day_of'])
export const DEFAULT_REMINDERS: ReminderKind[] = ['day_before', 'day_of']

interface EventRow {
  id: string
  title: string
  notes: string
  date: string
  start_time: string | null
  end_time: string | null
  kind: EventKind
  link_type: EntityType | null
  link_id: string | null
  reminders: string
  updated_at: number
  link_title: string | null
  link_done: number
  link_deleted: number | null
}

const COLS = `e.id, e.title, e.notes, e.date, e.start_time, e.end_time, e.kind, e.link_type, e.link_id, e.reminders, e.updated_at,
  CASE e.link_type
    WHEN 'ticket' THEN printf('NT-%04d', t.number)
      || CASE WHEN t.device <> '' THEN ' · ' || t.device ELSE '' END
      || CASE WHEN tc.name <> '' THEN ' (' || tc.name || ')' ELSE '' END
    WHEN 'customer' THEN COALESCE(NULLIF(c.name, ''), 'Unnamed customer')
    WHEN 'note' THEN COALESCE(NULLIF(n.title, ''), 'Untitled')
  END AS link_title,
  CASE WHEN e.link_type = 'ticket' AND t.status = 'picked_up' THEN 1 ELSE 0 END AS link_done,
  CASE e.link_type WHEN 'ticket' THEN t.deleted_at WHEN 'customer' THEN c.deleted_at WHEN 'note' THEN n.deleted_at END AS link_deleted`

const FROM = `FROM events e
  LEFT JOIN tickets t ON e.link_type = 'ticket' AND t.id = e.link_id
  LEFT JOIN customers tc ON tc.id = t.customer_id
  LEFT JOIN customers c ON e.link_type = 'customer' AND c.id = e.link_id
  LEFT JOIN notes n ON e.link_type = 'note' AND n.id = e.link_id`

/** Pickup events follow their ticket: hidden while the ticket is in the trash. */
const VISIBLE = `e.deleted_at IS NULL AND NOT (e.kind = 'pickup' AND (t.id IS NULL OR t.deleted_at IS NOT NULL))`

function toEvent(r: EventRow): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    kind: r.kind,
    linkType: r.link_type,
    linkId: r.link_id,
    linkTitle: r.link_title ?? '',
    linkDone: r.link_done === 1,
    linkDeleted: r.link_deleted !== null && r.link_deleted !== undefined,
    reminders: JSON.parse(r.reminders) as ReminderKind[],
    updatedAt: r.updated_at
  }
}

const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
const cleanReminders = (r: ReminderKind[]): ReminderKind[] => [...new Set(r.filter((k) => REMINDER_KINDS.has(k)))]

export function listEvents(db: Db, from: string, to: string): CalendarEvent[] {
  if (!isDate(from) || !isDate(to)) return []
  const rows = db
    .prepare(`SELECT ${COLS} ${FROM} WHERE ${VISIBLE} AND e.date BETWEEN ? AND ? ORDER BY e.date, e.start_time IS NOT NULL, e.start_time`)
    .all(from, to) as unknown as EventRow[]
  return rows.map(toEvent)
}

export function getEvent(db: Db, id: string): CalendarEvent | null {
  const r = db.prepare(`SELECT ${COLS} ${FROM} WHERE e.id = ? AND e.deleted_at IS NULL`).get(id) as EventRow | undefined
  return r ? toEvent(r) : null
}

export function eventsForLink(db: Db, linkId: string): CalendarEvent[] {
  const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE ${VISIBLE} AND e.link_id = ? ORDER BY e.date DESC`).all(linkId) as unknown as EventRow[]
  return rows.map(toEvent)
}

export function createEvent(db: Db, input: EventInput, kind: EventKind = 'event'): CalendarEvent {
  if (!isDate(input.date)) throw new Error(`Invalid date: ${input.date}`)
  const id = newId()
  const t = now()
  const start = isTime(input.startTime) ? input.startTime : null
  db.prepare(
    `INSERT INTO events (id, title, notes, date, start_time, end_time, kind, link_type, link_id, reminders, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (input.title ?? '').slice(0, 300),
    (input.notes ?? '').slice(0, 10000),
    input.date,
    start,
    start && isTime(input.endTime) ? input.endTime : null,
    kind,
    input.linkType ?? null,
    input.linkId ?? null,
    JSON.stringify(cleanReminders(input.reminders ?? DEFAULT_REMINDERS)),
    t,
    t
  )
  return getEvent(db, id)!
}

const setTicketPickup = (db: Db, ticketId: string, date: string | null): void => {
  db.prepare('UPDATE tickets SET pickup_on = ?, updated_at = ? WHERE id = ?').run(date, now(), ticketId)
}

function pickupEventOf(db: Db, ticketId: string): { id: string } | undefined {
  return db.prepare("SELECT id FROM events WHERE kind = 'pickup' AND link_id = ? AND deleted_at IS NULL").get(ticketId) as { id: string } | undefined
}

function defaultPickupTitle(db: Db, ticketId: string): string {
  const r = db
    .prepare('SELECT t.number, c.name FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.id = ?')
    .get(ticketId) as { number: number; name: string | null } | undefined
  if (!r) return 'Pickup'
  return `${r.name?.trim() || `NT-${String(r.number).padStart(4, '0')}`} pickup`
}

export function updateEvent(db: Db, id: string, patch: EventUpdate): CalendarEvent {
  return tx(db, () => {
    const current = getEvent(db, id)
    if (!current) throw new Error(`Event not found: ${id}`)
    const sets: string[] = []
    const params: (string | number | null)[] = []
    const set = (col: string, value: string | number | null): void => {
      sets.push(`${col} = ?`)
      params.push(value)
    }
    if (patch.title !== undefined) set('title', patch.title.slice(0, 300))
    if (patch.notes !== undefined) set('notes', patch.notes.slice(0, 10000))
    if (patch.date !== undefined) {
      if (!isDate(patch.date)) throw new Error(`Invalid date: ${patch.date}`)
      set('date', patch.date)
    }
    if (patch.startTime !== undefined) {
      const start = isTime(patch.startTime) ? patch.startTime : null
      set('start_time', start)
      if (!start) set('end_time', null)
    }
    if (patch.endTime !== undefined) set('end_time', isTime(patch.endTime) ? patch.endTime : null)
    if (patch.reminders !== undefined) set('reminders', JSON.stringify(cleanReminders(patch.reminders)))

    let kind = current.kind
    if (patch.kind !== undefined && patch.kind !== current.kind) {
      if (patch.kind === 'pickup' && current.linkType !== 'ticket') throw new Error('Only ticket events can be a pickup')
      kind = patch.kind
      set('kind', kind)
    }
    set('updated_at', now())
    params.push(id)
    db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    // Keep the ticket's pickup date in sync with its pickup event.
    if (current.linkType === 'ticket' && current.linkId) {
      const date = patch.date ?? current.date
      if (kind === 'pickup') {
        if (current.kind !== 'pickup') {
          const other = pickupEventOf(db, current.linkId)
          if (other && other.id !== id) db.prepare('UPDATE events SET deleted_at = ? WHERE id = ?').run(now(), other.id)
        }
        setTicketPickup(db, current.linkId, date)
      } else if (current.kind === 'pickup') {
        setTicketPickup(db, current.linkId, null)
      }
    }
    return getEvent(db, id)!
  })
}

export function removeEvent(db: Db, id: string): void {
  tx(db, () => {
    const current = getEvent(db, id)
    if (!current) return
    db.prepare('UPDATE events SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
    if (current.kind === 'pickup' && current.linkId) setTicketPickup(db, current.linkId, null)
  })
}

/** Called when a ticket's pickup date is edited on the ticket page. */
export function syncPickupFromTicket(db: Db, ticketId: string, date: string | null): void {
  const existing = pickupEventOf(db, ticketId)
  if (!date) {
    if (existing) db.prepare('UPDATE events SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), existing.id)
    return
  }
  if (existing) db.prepare('UPDATE events SET date = ?, updated_at = ? WHERE id = ?').run(date, now(), existing.id)
  else createEvent(db, { title: defaultPickupTitle(db, ticketId), date, linkType: 'ticket', linkId: ticketId }, 'pickup')
}

/**
 * Something was dragged onto a day.
 * Ticket → its pickup date (moves the existing pickup instead of duplicating it).
 * Customer / note → a new event linked to it.
 */
export function dropItem(db: Db, item: { type: EntityType; id: string }, date: string, startTime: string | null = null): CalendarEvent {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`)
  return tx(db, () => {
    if (item.type === 'ticket') {
      const existing = pickupEventOf(db, item.id)
      if (existing) return updateEvent(db, existing.id, { date, startTime })
      const ev = createEvent(db, { title: defaultPickupTitle(db, item.id), date, startTime, linkType: 'ticket', linkId: item.id }, 'pickup')
      setTicketPickup(db, item.id, date)
      return ev
    }
    const title =
      item.type === 'customer'
        ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(item.id) as { name: string } | undefined)?.name
        : (db.prepare('SELECT title FROM notes WHERE id = ?').get(item.id) as { title: string } | undefined)?.title
    return createEvent(db, { title: title?.trim() || (item.type === 'customer' ? 'Customer' : 'Note'), date, startTime, linkType: item.type, linkId: item.id })
  })
}
