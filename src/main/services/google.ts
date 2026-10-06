import type { Db } from '../db'
import { now } from '../db'
import type { GoogleCalendarInfo, GoogleEvent } from '../../shared/api'
import { getSetting, setSetting } from './settings'
import { createEvent, getEvent, removeEvent, updateEvent } from './calendar'
import { isDate } from './doc'

/*
 * Google Calendar sync
 * --------------------
 * - Plannr events ⇄ a "Plannr" calendar in the user's Google account (two-way). Each Google event carries
 *   extendedProperties.private.plannrId; events.google_id / google_synced_at track what's been synced.
 *   Conflicts: the most recent edit wins.
 * - Other chosen Google calendars are copied read-only into google_events (a window around today) for display.
 * The Google HTTP API is injected (GoogleApi), so all of this is unit-tested against a fake.
 */

export interface GTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  start?: GTime
  end?: GTime
  updated?: string
  htmlLink?: string
  extendedProperties?: { private?: Record<string, string> }
  recurrence?: string[]
  /** Set on each occurrence of a repeating event (single-events listing) */
  recurringEventId?: string
}

export interface GCalendar {
  id: string
  summary: string
  backgroundColor?: string
  primary?: boolean
  accessRole?: string
}

export interface GoogleApi {
  listCalendars(): Promise<GCalendar[]>
  createCalendar(summary: string, timeZone: string): Promise<GCalendar>
  listEvents(calendarId: string, params: Record<string, string>): Promise<GEvent[]>
  insertEvent(calendarId: string, body: Partial<GEvent>): Promise<GEvent>
  patchEvent(calendarId: string, eventId: string, body: Partial<GEvent>): Promise<GEvent>
  deleteEvent(calendarId: string, eventId: string): Promise<void>
}

/** HTTP errors from the API carry the status so "already gone" (404/410) can be treated as success. */
export class GoogleHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}
const gone = (err: unknown): boolean => err instanceof GoogleHttpError && (err.status === 404 || err.status === 410)

export interface SyncResult {
  pushed: number
  pulled: number
  external: number
}

const NOTES_FOOTER = '\n\n— From Plannr'
const PLANNR_CALENDAR = 'Plannr'

// ---------- Time conversion ----------

const pad = (n: number): string => String(n).padStart(2, '0')
const localDateOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTimeOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDateOf(new Date(y, m - 1, d + days))
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return h >= 23 ? '23:59' : `${pad(h + 1)}:${pad(m)}`
}

/** Google start/end → Plannr's local date + optional times. All-day ends are exclusive in Google. */
export function fromGoogleTimes(start?: GTime, end?: GTime): { date: string; endDate: string | null; startTime: string | null; endTime: string | null } | null {
  if (start?.date && isDate(start.date)) {
    const lastDay = end?.date && isDate(end.date) ? addDaysISO(end.date, -1) : start.date
    return { date: start.date, endDate: lastDay > start.date ? lastDay : null, startTime: null, endTime: null }
  }
  if (start?.dateTime) {
    const s = new Date(start.dateTime)
    if (Number.isNaN(s.getTime())) return null
    const e = end?.dateTime ? new Date(end.dateTime) : null
    const sameDay = e && localDateOf(e) === localDateOf(s)
    return { date: localDateOf(s), endDate: null, startTime: localTimeOf(s), endTime: e && sameDay ? localTimeOf(e) : null }
  }
  return null
}

function toGoogleTimes(ev: { date: string; startTime: string | null; endTime: string | null }, timeZone: string): { start: GTime; end: GTime } {
  if (!ev.startTime) return { start: { date: ev.date }, end: { date: addDaysISO(ev.date, 1) } }
  const end = ev.endTime && ev.endTime > ev.startTime ? ev.endTime : addHour(ev.startTime)
  return {
    start: { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone },
    end: { dateTime: `${ev.date}T${end}:00`, timeZone }
  }
}

// ---------- Settings ----------

export const selectedCalendarIds = (db: Db): string[] | null => {
  const v = getSetting(db, 'google.calendars')
  return Array.isArray(v) ? (v as string[]) : null
}

export function setSelectedCalendars(db: Db, ids: string[]): void {
  setSetting(db, 'google.calendars', ids)
  // Drop cached events from calendars no longer shown
  const keep = new Set(ids)
  const cached = db.prepare('SELECT DISTINCT calendar_id FROM google_events').all() as { calendar_id: string }[]
  for (const { calendar_id } of cached) if (!keep.has(calendar_id)) db.prepare('DELETE FROM google_events WHERE calendar_id = ?').run(calendar_id)
}

export function listGoogleEvents(db: Db, from: string, to: string): GoogleEvent[] {
  const calendars = new Map(((getSetting(db, 'google.calendarList') as GoogleCalendarInfo[] | null) ?? []).map((c) => [c.id, c]))
  const rows = db
    .prepare(
      `SELECT * FROM google_events WHERE date <= ? AND COALESCE(end_date, date) >= ? ORDER BY date, start_time IS NOT NULL, start_time`
    )
    .all(to, from) as { calendar_id: string; event_id: string; title: string; date: string; end_date: string | null; start_time: string | null; end_time: string | null; html_link: string }[]
  return rows.map((r) => ({
    id: `google:${r.calendar_id}:${r.event_id}`,
    calendarName: calendars.get(r.calendar_id)?.name ?? '',
    color: calendars.get(r.calendar_id)?.color ?? '',
    title: r.title,
    date: r.date,
    endDate: r.end_date,
    startTime: r.start_time,
    endTime: r.end_time,
    htmlLink: r.html_link
  }))
}

/** Forget everything synced (on disconnect). Plannr's own events stay; they'll be re-uploaded if reconnected. */
export function clearGoogleData(db: Db): void {
  db.exec('DELETE FROM google_events')
  db.exec('UPDATE events SET google_id = NULL, google_synced_at = NULL')
  for (const key of ['google.plannrCalendarId', 'google.lastPull', 'google.calendarList', 'google.calendars', 'google.lastSyncAt', 'google.error']) setSetting(db, key, null)
}

// ---------- Sync ----------

interface EventSyncRow {
  id: string
  title: string
  notes: string
  date: string
  start_time: string | null
  end_time: string | null
  link_title: string
  updated_at: number
  deleted_at: number | null
  google_id: string | null
  google_synced_at: number | null
  hidden: number
  repeat: string
  repeat_until: string | null
  exdates: string
  google_reset: number
}

async function ensurePlannrCalendar(db: Db, api: GoogleApi, calendars: GCalendar[], timeZone: string): Promise<string> {
  const saved = getSetting(db, 'google.plannrCalendarId') as string | null
  if (saved && calendars.some((c) => c.id === saved)) return saved
  const existing = calendars.find((c) => c.summary === PLANNR_CALENDAR && c.accessRole === 'owner')
  const id = existing?.id ?? (await api.createCalendar(PLANNR_CALENDAR, timeZone)).id
  if (saved !== id) db.exec('UPDATE events SET google_id = NULL, google_synced_at = NULL') // calendar changed: upload again
  setSetting(db, 'google.plannrCalendarId', id)
  return id
}

/** RRULE (+ EXDATE) lines for a repeating event, in Google's format. */
export function recurrenceFor(ev: { repeat: string; repeat_until: string | null; exdates: string; start_time: string | null }, timeZone: string): string[] {
  if (!ev.repeat) return []
  const flat = (d: string): string => d.replace(/-/g, '')
  const until = ev.repeat_until ? `;UNTIL=${flat(ev.repeat_until)}${ev.start_time ? 'T235959Z' : ''}` : ''
  const lines = [`RRULE:FREQ=${ev.repeat.toUpperCase()}${until}`]
  const skip = JSON.parse(ev.exdates) as string[]
  if (skip.length) {
    lines.push(
      ev.start_time
        ? `EXDATE;TZID=${timeZone}:${skip.map((d) => `${flat(d)}T${ev.start_time!.replace(':', '')}00`).join(',')}`
        : `EXDATE;VALUE=DATE:${skip.map(flat).join(',')}`
    )
  }
  return lines
}

function bodyFor(ev: EventSyncRow, timeZone: string): Partial<GEvent> {
  const footer = ev.link_title ? `${NOTES_FOOTER}: ${ev.link_title}` : NOTES_FOOTER
  return {
    summary: ev.title || '(untitled)',
    description: `${ev.notes}${footer}`.trim(),
    ...toGoogleTimes({ date: ev.date, startTime: ev.start_time, endTime: ev.end_time }, timeZone),
    ...(ev.repeat ? { recurrence: recurrenceFor(ev, timeZone) } : {}),
    extendedProperties: { private: { plannrId: ev.id } }
  }
}

const notesFrom = (description?: string): string => {
  const d = description ?? ''
  const i = d.indexOf(NOTES_FOOTER.trim())
  return (i >= 0 ? d.slice(0, i) : d).trim()
}

const markSynced = (db: Db, id: string, googleId: string | null): void => {
  db.prepare('UPDATE events SET google_id = ?, google_synced_at = updated_at, google_reset = 0 WHERE id = ?').run(googleId, id)
}

/** Applies changes made in Google (on the Plannr calendar) to Plannr events. */
async function pull(db: Db, api: GoogleApi, calendarId: string): Promise<number> {
  const since = getSetting(db, 'google.lastPull') as string | null
  const params: Record<string, string> = { showDeleted: 'true', singleEvents: 'true', maxResults: '2500' }
  if (since) params.updatedMin = new Date(Date.parse(since) - 60_000).toISOString() // small overlap
  const changes = await api.listEvents(calendarId, params)
  // Next time, ask for changes since the newest one seen, in Google's own clock (the PC's clock may be off).
  const newest = Math.max(...changes.map((g) => (g.updated ? Date.parse(g.updated) : 0)), since ? Date.parse(since) : 0)
  if (newest > 0) setSetting(db, 'google.lastPull', new Date(newest).toISOString())
  let count = 0
  for (const g of changes) {
    // Occurrences of a repeating event: the series is managed in Plannr (pushed as one recurring event).
    if (g.recurringEventId) continue
    const plannrId = g.extendedProperties?.private?.plannrId
    const row = (
      plannrId
        ? db.prepare('SELECT id, updated_at, google_synced_at, deleted_at FROM events WHERE id = ?').get(plannrId)
        : db.prepare('SELECT id, updated_at, google_synced_at, deleted_at FROM events WHERE google_id = ?').get(g.id)
    ) as { id: string; updated_at: number; google_synced_at: number | null; deleted_at: number | null } | undefined

    if (g.status === 'cancelled') {
      // Deleted in Google, unless Plannr edited it after that deletion (then the push step puts it back).
      const editedAfter = row && row.updated_at > (row.google_synced_at ?? 0) && g.updated && row.updated_at > Date.parse(g.updated)
      if (row && row.deleted_at === null && !editedAfter) {
        removeEvent(db, row.id)
        markSynced(db, row.id, null)
        count++
      }
      continue
    }
    const times = fromGoogleTimes(g.start, g.end)
    if (!times) continue
    if (!row) {
      const ev = createEvent(db, { title: g.summary ?? '', notes: notesFrom(g.description), date: times.date, startTime: times.startTime, endTime: times.endTime })
      markSynced(db, ev.id, g.id)
      count++
      continue
    }
    if (row.deleted_at !== null) continue // deleted in Plannr; the push step removes it from Google
    const localChanged = row.updated_at > (row.google_synced_at ?? 0)
    const googleNewer = g.updated ? Date.parse(g.updated) > row.updated_at : true
    if (localChanged && !googleNewer) continue // Plannr's edit is newer; it gets pushed
    const current = getEvent(db, row.id)
    const patch = { title: g.summary ?? '', notes: notesFrom(g.description), date: times.date, startTime: times.startTime, endTime: times.endTime }
    if (
      current &&
      (current.title !== patch.title || current.notes !== patch.notes || current.date !== patch.date || current.startTime !== patch.startTime || current.endTime !== patch.endTime)
    ) {
      updateEvent(db, row.id, patch) // also keeps a ticket's pickup date in step
      count++
    }
    markSynced(db, row.id, g.id)
  }
  return count
}

/** Sends Plannr-side creates/edits/deletes to Google. */
async function push(db: Db, api: GoogleApi, calendarId: string, timeZone: string): Promise<number> {
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.notes, e.date, e.start_time, e.end_time, e.updated_at, e.deleted_at, e.google_id, e.google_synced_at, e.repeat, e.repeat_until, e.exdates, e.google_reset,
         COALESCE(CASE e.link_type
           WHEN 'ticket' THEN ticket_no(t.number) || CASE WHEN tc.name <> '' THEN ' (' || tc.name || ')' ELSE '' END
           WHEN 'customer' THEN c.name WHEN 'note' THEN n.title END, '') AS link_title,
         CASE WHEN e.kind = 'pickup' AND (t.id IS NULL OR t.deleted_at IS NOT NULL) THEN 1 ELSE 0 END AS hidden
       FROM events e
       LEFT JOIN tickets t ON e.link_type = 'ticket' AND t.id = e.link_id
       LEFT JOIN customers tc ON tc.id = t.customer_id
       LEFT JOIN customers c ON e.link_type = 'customer' AND c.id = e.link_id
       LEFT JOIN notes n ON e.link_type = 'note' AND n.id = e.link_id
       WHERE e.updated_at > COALESCE(e.google_synced_at, 0) OR (e.google_id IS NULL AND e.deleted_at IS NULL)`
    )
    .all() as unknown as EventSyncRow[]
  let count = 0
  for (const ev of rows) {
    const removed = ev.deleted_at !== null || ev.hidden === 1
    if (removed) {
      if (ev.google_id) {
        await api.deleteEvent(calendarId, ev.google_id).catch((err) => {
          if (!gone(err)) throw err
        })
        count++
      }
      markSynced(db, ev.id, null)
      continue
    }
    const body = bodyFor(ev, timeZone)
    let googleId = ev.google_id
    if (googleId && ev.google_reset) {
      // Started or stopped repeating: replace Google's copy (a repeat can't be patched away).
      await api.deleteEvent(calendarId, googleId).catch((err) => {
        if (!gone(err)) throw err
      })
      googleId = null
    }
    if (googleId) {
      try {
        await api.patchEvent(calendarId, googleId, body)
      } catch (err) {
        if (!gone(err)) throw err
        googleId = (await api.insertEvent(calendarId, body)).id // deleted in Google meanwhile: recreate
      }
    } else {
      googleId = (await api.insertEvent(calendarId, body)).id
    }
    markSynced(db, ev.id, googleId)
    count++
  }
  return count
}

/** Copies the chosen calendars' events (90 days back, ~13 months ahead) for display. */
async function refreshExternal(db: Db, api: GoogleApi, calendarIds: string[], today: Date): Promise<number> {
  const timeMin = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90).toISOString()
  const timeMax = new Date(today.getFullYear(), today.getMonth() + 13, today.getDate()).toISOString()
  let total = 0
  for (const calendarId of calendarIds) {
    const items = await api.listEvents(calendarId, { timeMin, timeMax, singleEvents: 'true', maxResults: '2500' })
    db.prepare('DELETE FROM google_events WHERE calendar_id = ?').run(calendarId)
    const insert = db.prepare(
      'INSERT OR REPLACE INTO google_events (calendar_id, event_id, title, date, end_date, start_time, end_time, html_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const g of items) {
      if (g.status === 'cancelled') continue
      const t = fromGoogleTimes(g.start, g.end)
      if (!t) continue
      insert.run(calendarId, g.id, g.summary ?? '(no title)', t.date, t.endDate, t.startTime, t.endTime, g.htmlLink ?? '')
      total++
    }
  }
  return total
}

/** One full sync: make sure the Plannr calendar exists, pull, push, refresh the read-only calendars. */
export async function syncGoogle(db: Db, api: GoogleApi, options: { timeZone: string; today?: Date }): Promise<SyncResult> {
  try {
    const calendars = await api.listCalendars()
    const plannrId = await ensurePlannrCalendar(db, api, calendars, options.timeZone)
    setSetting(
      db,
      'google.calendarList',
      calendars
        .filter((c) => c.id !== plannrId)
        .map((c): GoogleCalendarInfo => ({ id: c.id, name: c.summary, color: c.backgroundColor ?? '', primary: Boolean(c.primary) }))
    )
    const pulled = await pull(db, api, plannrId)
    const pushed = await push(db, api, plannrId, options.timeZone)
    const chosen = selectedCalendarIds(db) ?? calendars.filter((c) => c.primary).map((c) => c.id) // default: the main calendar
    const external = await refreshExternal(db, api, chosen.filter((id) => id !== plannrId && calendars.some((c) => c.id === id)), options.today ?? new Date())
    setSetting(db, 'google.lastSyncAt', now())
    setSetting(db, 'google.error', null)
    return { pushed, pulled, external }
  } catch (err) {
    setSetting(db, 'google.error', err instanceof Error ? err.message : String(err))
    throw err
  }
}
