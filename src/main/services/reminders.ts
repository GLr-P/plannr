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

// ---------- Bills & subscriptions ----------

export interface MoneyReminder {
  recurringId: string
  key: string
  title: string
  body: string
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/**
 * "X days before" (9 AM) and "day of" (8 AM) reminders for active bills/subscriptions with reminders on.
 * Auto-pay charges are recorded the day after the due date, so auto-pay items get both reminders too.
 */
export function dueMoneyReminders(db: Db, now = new Date(), lookbackMs = LOOKBACK_MS): MoneyReminder[] {
  const rows = db
    .prepare('SELECT id, kind, name, amount_cents, next_due, autopay, remind_days FROM recurring WHERE deleted_at IS NULL AND active = 1 AND remind_days >= 0')
    .all() as { id: string; kind: 'bill' | 'subscription'; name: string; amount_cents: number; next_due: string; autopay: number; remind_days: number }[]
  const logged = db.prepare('SELECT 1 FROM reminder_log WHERE event_id = ? AND reminder_key = ?')
  const out: MoneyReminder[] = []
  for (const r of rows) {
    const [y, m, d] = r.next_due.split('-').map(Number)
    const name = r.name || (r.kind === 'subscription' ? 'Subscription' : 'Bill')
    const slots: { key: string; at: Date; body: string }[] = []
    if (r.remind_days > 0) {
      const when = r.remind_days === 1 ? 'tomorrow' : `in ${r.remind_days} days`
      const body =
        r.kind === 'subscription'
          ? `Renews ${when} · ${dollars(r.amount_cents)}${r.autopay ? ' will be charged' : ''}`
          : `${r.autopay ? 'Auto-pays' : 'Due'} ${when} · ${dollars(r.amount_cents)}`
      slots.push({ key: `money-before@${r.next_due}`, at: new Date(y, m - 1, d - r.remind_days, 9, 0), body })
    }
    slots.push({
      key: `money-dayof@${r.next_due}`,
      at: new Date(y, m - 1, d, 8, 0),
      body: `${r.kind === 'subscription' ? 'Renews' : r.autopay ? 'Auto-pays' : 'Due'} today · ${dollars(r.amount_cents)}`
    })
    for (const s of slots) {
      const age = now.getTime() - s.at.getTime()
      if (age < 0 || age > lookbackMs || logged.get(r.id, s.key)) continue
      out.push({ recurringId: r.id, key: s.key, title: name, body: s.body })
    }
  }
  return out
}
