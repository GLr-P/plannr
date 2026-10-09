import type { Db } from '../db'
import { newId, now, tx } from '../db'
import {
  DEFAULT_EVENT_REMINDERS,
  formatTicketNumber,
  isReminderKind,
  type Repeat,
  type CalendarEvent,
  type EntityType,
  type EventInput,
  type EventKind,
  type EventReminderDefaults,
  type EventUpdate,
  type ReminderKind
} from '../../shared/api'
import { getSetting } from './settings'
import { isDate } from './doc'

/** The notifications a new event gets: the user's defaults for timed or all-day events. */
export function defaultReminders(db: Db, timed: boolean): ReminderKind[] {
  const saved = getSetting(db, 'eventReminders') as Partial<EventReminderDefaults> | null
  const list = (timed ? saved?.timed : saved?.allDay) ?? (timed ? DEFAULT_EVENT_REMINDERS.timed : DEFAULT_EVENT_REMINDERS.allDay)
  return cleanReminders(list)
}

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
  repeat: Repeat
  repeat_until: string | null
  exdates: string
  updated_at: number
  link_title: string | null
  link_done: number
  link_deleted: number | null
}

const COLS = `e.id, e.title, e.notes, e.date, e.start_time, e.end_time, e.kind, e.link_type, e.link_id, e.reminders, e.repeat, e.repeat_until, e.exdates, e.updated_at,
  CASE e.link_type
    WHEN 'ticket' THEN ticket_no(t.number)
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
    repeat: r.repeat ?? '',
    repeatUntil: r.repeat_until,
    seriesStart: r.date,
    updatedAt: r.updated_at
  }
}

const REPEATS: Repeat[] = ['', 'daily', 'weekly', 'monthly', 'yearly']
const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Dates a repeating series falls on within [from, to]. Monthly on the 31st skips shorter months (as Google does). */
export function occurrenceDates(start: string, repeat: Repeat, until: string | null, from: string, to: string, skip: string[] = []): string[] {
  if (!repeat) return start >= from && start <= to ? [start] : []
  const last = until && until < to ? until : to
  const [y, m, d] = start.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < 100_000; i++) {
    let date: Date
    if (repeat === 'daily') date = new Date(y, m - 1, d + i)
    else if (repeat === 'weekly') date = new Date(y, m - 1, d + 7 * i)
    else if (repeat === 'monthly') {
      date = new Date(y, m - 1 + i, d)
      if (date.getDate() !== d) continue // no such day this month
    } else {
      date = new Date(y + i, m - 1, d)
      if (date.getMonth() !== m - 1) continue // 29 Feb in a non-leap year
    }
    const iso = ymd(date)
    if (iso > last) break
    if (iso >= from && !skip.includes(iso)) out.push(iso)
  }
  return out
}

const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const cleanReminders = (r: unknown[]): ReminderKind[] => [...new Set(r.filter(isReminderKind))]

export function listEvents(db: Db, from: string, to: string): CalendarEvent[] {
  if (!isDate(from) || !isDate(to)) return []
  const rows = db
    .prepare(
      `SELECT ${COLS} ${FROM} WHERE ${VISIBLE} AND (
         (e.repeat = '' AND e.date BETWEEN ? AND ?)
         OR (e.repeat <> '' AND e.date <= ? AND (e.repeat_until IS NULL OR e.repeat_until >= ?)))`
    )
    .all(from, to, to, from) as unknown as EventRow[]
  // Repeating events become one entry per occurrence in the range (same id, that occurrence's date).
  const out: CalendarEvent[] = []
  for (const r of rows) {
    const ev = toEvent(r)
    if (!ev.repeat) out.push(ev)
    else for (const date of occurrenceDates(r.date, r.repeat, r.repeat_until, from, to, JSON.parse(r.exdates) as string[])) out.push({ ...ev, date })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.startTime !== null) - Number(b.startTime !== null) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
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
    JSON.stringify(cleanReminders(input.reminders ?? defaultReminders(db, Boolean(input.startTime)))),
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
  return `${r.name?.trim() || formatTicketNumber(r.number)} pickup`
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
    if (patch.repeat !== undefined && current.kind !== 'pickup') {
      const repeat = REPEATS.includes(patch.repeat) ? patch.repeat : ''
      set('repeat', repeat)
      if (repeat !== current.repeat) set('google_reset', 1) // Google's copy is replaced (a repeat can't be patched away)
      if (!repeat) set('exdates', '[]')
    }
    if (patch.repeatUntil !== undefined) set('repeat_until', isDate(patch.repeatUntil) ? patch.repeatUntil : null)

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

/** Repeating event: leave out one occurrence (the rest of the series stays). */
export function skipOccurrence(db: Db, id: string, date: string): void {
  const row = db.prepare('SELECT exdates FROM events WHERE id = ?').get(id) as { exdates: string } | undefined
  if (!row || !isDate(date)) return
  const skip = [...new Set([...(JSON.parse(row.exdates) as string[]), date])].sort()
  db.prepare('UPDATE events SET exdates = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(skip), now(), id)
}

export function exdatesOf(db: Db, id: string): string[] {
  const row = db.prepare('SELECT exdates FROM events WHERE id = ?').get(id) as { exdates: string } | undefined
  return row ? (JSON.parse(row.exdates) as string[]) : []
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
