import type { Db } from '../db'
import type { EntityType, ReminderKind } from '../../shared/api'
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

/** When a reminder pops up for an event on `date` (starting at `startTime`, or all day). */
export function fireTime(date: string, kind: ReminderKind, startTime: string | null = null): Date {
  const [y, m, d] = date.split('-').map(Number)
  if (kind === 'day_of') return new Date(y, m - 1, d, 8, 0)
  if (kind === 'day_before') return new Date(y, m - 1, d - 1, 9, 0)
  if (kind === 'week_before') return new Date(y, m - 1, d - 7, 9, 0)
  const minutes = Number(kind.slice('before:'.length)) || 0
  if (!startTime) {
    // A "minutes before" reminder on an event that became all-day: whole days before at 9 AM, else the morning of
    const days = Math.floor(minutes / 1440)
    return days > 0 ? new Date(y, m - 1, d - days, 9, 0) : new Date(y, m - 1, d, 8, 0)
  }
  const [hh, mm] = startTime.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm - minutes)
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The notification's text: when the event is, from the moment the reminder fires. */
export function whenText(kind: ReminderKind, date: string, startTime: string | null): string {
  const at = startTime ? ` at ${formatTime(startTime)}` : ''
  if (kind === 'day_of') return `Today${at}`
  if (kind === 'day_before') return `Tomorrow${at}`
  if (kind === 'week_before') return `In a week (${new Date(`${date}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})${at}`
  const minutes = Number(kind.slice('before:'.length)) || 0
  if (!startTime) return minutes >= 1440 ? (minutes < 2880 ? 'Tomorrow' : `In ${plural(Math.floor(minutes / 1440), 'day')}`) : 'Today'
  if (minutes === 0) return `Starting now (${formatTime(startTime)})`
  if (minutes < 60) return `In ${plural(minutes, 'minute')}${at}`
  if (minutes < 1440) return `In ${plural(Math.round(minutes / 60), 'hour')}${at}`
  return minutes < 2880 ? `Tomorrow${at}` : `In ${plural(Math.floor(minutes / 1440), 'day')}${at}`
}

/** Reminders whose time has come (and haven't been shown yet). */
export function dueReminders(db: Db, now = new Date(), lookbackMs = LOOKBACK_MS): DueReminder[] {
  const day = 86_400_000
  // Events from yesterday to 8 days ahead: far enough for "a week before" reminders
  const events = listEvents(db, localDate(new Date(now.getTime() - day)), localDate(new Date(now.getTime() + 8 * day)))
  const logged = db.prepare('SELECT 1 FROM reminder_log WHERE event_id = ? AND reminder_key = ?')
  const due: DueReminder[] = []
  for (const e of events) {
    if (e.linkDone) continue // ticket already picked up
    for (const kind of e.reminders) {
      const at = fireTime(e.date, kind, e.startTime).getTime()
      if (at > now.getTime() || now.getTime() - at > lookbackMs) continue
      const key = `${kind}@${e.date}`
      if (logged.get(e.id, key)) continue
      // Caught up after Plannr was closed and the event has already begun: say so rather than "In 15 minutes"
      const started = e.startTime && now.getTime() >= fireTime(e.date, 'before:0', e.startTime).getTime()
      const when = started ? `Started at ${formatTime(e.startTime!)}` : whenText(kind, e.date, e.startTime)
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

// ---------- Warranties, free trials and deliveries ----------

export interface OtherReminder {
  id: string
  key: string
  title: string
  body: string
  target: { type: 'ticket'; id: string } | { money: string } | { packages: true }
}

/**
 * A warranty ending (8 AM that day), a free trial about to charge (9 AM three days before, and 8 AM on the day),
 * a package arriving today (8 AM).
 */
export function dueOtherReminders(db: Db, now = new Date(), lookbackMs = LOOKBACK_MS): OtherReminder[] {
  const logged = db.prepare('SELECT 1 FROM reminder_log WHERE event_id = ? AND reminder_key = ?')
  const out: OtherReminder[] = []
  const at = (date: string, daysBefore: number, hour: number): Date => {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d - daysBefore, hour, 0)
  }
  const push = (r: OtherReminder, when: Date): void => {
    const age = now.getTime() - when.getTime()
    if (age < 0 || age > lookbackMs || logged.get(r.id, r.key)) return
    out.push(r)
  }
  const tickets = db
    .prepare("SELECT t.id, t.number, t.device, t.warranty_until, c.name AS customer FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.deleted_at IS NULL AND t.warranty_until IS NOT NULL")
    .all() as { id: string; number: number; device: string; warranty_until: string; customer: string | null }[]
  for (const t of tickets)
    push(
      { id: t.id, key: `warranty@${t.warranty_until}`, title: 'Warranty ends today', body: [t.customer, t.device].filter(Boolean).join(' · ') || `Ticket ${t.number}`, target: { type: 'ticket', id: t.id } },
      at(t.warranty_until, 0, 8)
    )
  const trials = db
    .prepare('SELECT id, name, amount_cents, trial_ends FROM recurring WHERE deleted_at IS NULL AND active = 1 AND trial_ends IS NOT NULL')
    .all() as { id: string; name: string; amount_cents: number; trial_ends: string }[]
  for (const r of trials) {
    const money = `${(r.amount_cents / 100).toFixed(2)}`
    push({ id: r.id, key: `trial-before@${r.trial_ends}`, title: `${r.name || 'Free trial'}: trial ends in 3 days`, body: `Cancel before ${r.trial_ends} or ${money} will be charged`, target: { money: r.id } }, at(r.trial_ends, 3, 9))
    push({ id: r.id, key: `trial-dayof@${r.trial_ends}`, title: `${r.name || 'Free trial'}: trial ends today`, body: `${money} will be charged after today`, target: { money: r.id } }, at(r.trial_ends, 0, 8))
  }
  const parcels = db
    .prepare("SELECT id, label, number, expected FROM packages WHERE deleted_at IS NULL AND delivered_at IS NULL AND expected IS NOT NULL AND status != 'delivered'")
    .all() as { id: string; label: string; number: string; expected: string }[]
  for (const p of parcels) push({ id: p.id, key: `package@${p.expected}`, title: 'Package arriving today', body: p.label || p.number, target: { packages: true } }, at(p.expected, 0, 8))
  return out
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
