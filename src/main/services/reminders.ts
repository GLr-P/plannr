import type { Db } from '../db'
import { REMINDER_SCHEDULE, type EntityType, type ReminderKind } from '../../shared/api'
import { localDate } from './doc'
import { listEvents } from './calendar'

export interface DueReminder {
  eventId: string
  key: string
  title: string
  body: string
  linkType: EntityType | null
  linkId: string | null
  date: string
}

/** Reminders missed while Plannr wasn't running still fire if they're less than this old. */
export const LOOKBACK_MS = 12 * 60 * 60 * 1000

/** "15:00" → "3:00 PM" (fixed format; locale formatting varies between machines, e.g. "3:00 p.m."). */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function fireTime(date: string, kind: ReminderKind): Date {
  const [y, m, d] = date.split('-').map(Number)
  const { daysBefore, time } = REMINDER_SCHEDULE[kind]
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d - daysBefore, hh, mm)
}

/** Reminders whose time has come (and haven't been shown yet). */
export function dueReminders(db: Db, now = new Date(), lookbackMs = LOOKBACK_MS): DueReminder[] {
  const day = 86_400_000
  const events = listEvents(db, localDate(new Date(now.getTime() - day)), localDate(new Date(now.getTime() + day)))
  const logged = db.prepare('SELECT 1 FROM reminder_log WHERE event_id = ? AND reminder_key = ?')
  const due: DueReminder[] = []
  for (const e of events) {
    if (e.linkDone) continue // ticket already picked up
    for (const kind of e.reminders) {
      const at = fireTime(e.date, kind).getTime()
      if (at > now.getTime() || now.getTime() - at > lookbackMs) continue
      const key = `${kind}@${e.date}`
      if (logged.get(e.id, key)) continue
      const when = `${kind === 'day_before' ? 'Tomorrow' : 'Today'}${e.startTime ? ` at ${formatTime(e.startTime)}` : ''}`
      due.push({
        eventId: e.id,
        key,
        title: e.title || 'Reminder',
        body: e.linkTitle ? `${when} · ${e.linkTitle}` : when,
        linkType: e.linkType,
        linkId: e.linkId,
        date: e.date
      })
    }
  }
  return due
}

export function markReminderFired(db: Db, eventId: string, key: string): void {
  db.prepare('INSERT OR IGNORE INTO reminder_log (event_id, reminder_key, fired_at) VALUES (?, ?, ?)').run(eventId, key, Date.now())
}
