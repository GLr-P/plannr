import type { Db } from '../db'
import { newId, now, tx } from '../db'
import {
  DEFAULT_CATEGORIES,
  FREQUENCIES,
  formatTicketNumber,
  type Frequency,
  type MoneyOccurrence,
  type MoneySummary,
  type RecurringItem,
  type RecurringKind,
  type RecurringPatch,
  type Transaction,
  type TransactionFilter,
  type TransactionInput,
  type UnpaidTicket
} from '../../shared/api'
import { isDate, likeTerm, localDate } from './doc'

const FREQ_IDS = new Set<string>(FREQUENCIES.map((f) => f.id))

// ---------- Dates ----------

const parse = (d: string): [number, number, number] => d.split('-').map(Number) as [number, number, number]
const fmt = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const daysInMonth = (y: number, m: number): number => new Date(y, m, 0).getDate()

export function addDays(date: string, days: number): string {
  const [y, m, d] = parse(date)
  const dt = new Date(y, m - 1, d + days)
  return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/** Next due date after `date`. Monthly-type schedules keep their day of month (31st → Feb 28 → Mar 31). */
export function advance(date: string, frequency: Frequency, anchorDay: number): string {
  if (frequency === 'weekly') return addDays(date, 7)
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : frequency === 'yearly' ? 12 : 0
  if (months === 0) return date
  const [y, m] = parse(date)
  const total = m - 1 + months
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12) + 1
  return fmt(ny, nm, Math.min(anchorDay, daysInMonth(ny, nm)))
}

/** Average cost per month (weekly ×52/12, quarterly ÷3, yearly ÷12, one-time 0). */
export function monthlyCost(amountCents: number, frequency: Frequency): number {
  const factor = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 }[frequency]
  return Math.round(amountCents * factor)
}

// ---------- Recurring (bills & subscriptions) ----------

interface RecurringRow {
  id: string
  kind: RecurringKind
  name: string
  amount_cents: number
  frequency: Frequency
  next_due: string
  anchor_day: number
  category: string
  autopay: number
  remind_days: number
  url: string
  notes: string
  active: number
  cancelled_on: string | null
  due_set_on: string | null
  updated_at: number
}

const toItem = (r: RecurringRow): RecurringItem => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  amountCents: r.amount_cents,
  frequency: r.frequency,
  nextDue: r.next_due,
  category: r.category,
  autopay: r.autopay === 1,
  remindDays: r.remind_days,
  url: r.url,
  notes: r.notes,
  active: r.active === 1,
  cancelledOn: r.cancelled_on,
  updatedAt: r.updated_at
})

function getRow(db: Db, id: string): RecurringRow {
  const r = db.prepare('SELECT * FROM recurring WHERE id = ? AND deleted_at IS NULL').get(id) as RecurringRow | undefined
  if (!r) throw new Error(`Bill/subscription not found: ${id}`)
  return r
}

/** Active first (soonest due first), then cancelled. */
export function listRecurring(db: Db): RecurringItem[] {
  const rows = db.prepare('SELECT * FROM recurring WHERE deleted_at IS NULL ORDER BY active DESC, next_due, name COLLATE NOCASE').all()
  return (rows as unknown as RecurringRow[]).map(toItem)
}

export function getRecurring(db: Db, id: string): RecurringItem {
  return toItem(getRow(db, id))
}

export function createRecurring(db: Db, kind: RecurringKind, today = localDate()): RecurringItem {
  const id = newId()
  const t = now()
  db.prepare(
    `INSERT INTO recurring (id, kind, next_due, anchor_day, autopay, due_set_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, kind, today, parse(today)[2], kind === 'subscription' ? 1 : 0, today, t, t)
  return getRecurring(db, id)
}

export function updateRecurring(db: Db, id: string, patch: RecurringPatch, today = localDate()): RecurringItem {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const set = (col: string, v: string | number | null): void => {
    sets.push(`${col} = ?`)
    params.push(v)
  }
  if (patch.name !== undefined) set('name', patch.name.slice(0, 200))
  if (patch.amountCents !== undefined) set('amount_cents', Math.max(0, Math.round(patch.amountCents)))
  if (patch.frequency !== undefined) {
    if (!FREQ_IDS.has(patch.frequency)) throw new Error(`Unknown frequency: ${patch.frequency}`)
    set('frequency', patch.frequency)
  }
  if (patch.nextDue !== undefined) {
    if (!isDate(patch.nextDue)) throw new Error(`Invalid date: ${patch.nextDue}`)
    set('next_due', patch.nextDue)
    set('anchor_day', parse(patch.nextDue)[2]) // the due day follows the chosen date
    set('due_set_on', today) // due dates before today count as already paid (see processAutopay)
  }
  if (patch.category !== undefined) set('category', patch.category.slice(0, 100))
  if (patch.autopay !== undefined) set('autopay', patch.autopay ? 1 : 0)
  if (patch.remindDays !== undefined) set('remind_days', Math.max(-1, Math.min(60, Math.round(patch.remindDays))))
  if (patch.url !== undefined) set('url', patch.url.slice(0, 500))
  if (patch.notes !== undefined) set('notes', patch.notes.slice(0, 10000))
  if (patch.active !== undefined) {
    set('active', patch.active ? 1 : 0)
    set('cancelled_on', patch.active ? null : today)
  }
  set('updated_at', now())
  params.push(id)
  const result = db.prepare(`UPDATE recurring SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...params)
  if (result.changes === 0) throw new Error(`Bill/subscription not found: ${id}`)
  return getRecurring(db, id)
}

export function removeRecurring(db: Db, id: string): void {
  db.prepare('UPDATE recurring SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

/** Moves to the next due date; a one-time bill becomes inactive once done. */
function moveOn(db: Db, r: RecurringRow, today: string): void {
  if (r.frequency === 'once') {
    db.prepare('UPDATE recurring SET active = 0, cancelled_on = ?, updated_at = ? WHERE id = ?').run(today, now(), r.id)
  } else {
    db.prepare('UPDATE recurring SET next_due = ?, updated_at = ? WHERE id = ?').run(advance(r.next_due, r.frequency, r.anchor_day), now(), r.id)
  }
}

const payment = (r: RecurringRow, date: string, amountCents = r.amount_cents): TransactionInput => ({
  date,
  type: 'expense',
  amountCents,
  description: r.name || (r.kind === 'subscription' ? 'Subscription' : 'Bill'),
  category: r.category || (r.kind === 'subscription' ? 'Software' : ''),
  method: r.autopay ? 'Auto-pay' : '',
  recurringId: r.id
})

export function markPaid(db: Db, id: string, opts: { date?: string; amountCents?: number } = {}, today = localDate()): RecurringItem {
  return tx(db, () => {
    const r = getRow(db, id)
    addTransaction(db, payment(r, isDate(opts.date) ? opts.date : today, opts.amountCents ?? r.amount_cents))
    moveOn(db, r, today)
    return getRecurring(db, id)
  })
}

export function skip(db: Db, id: string, today = localDate()): RecurringItem {
  return tx(db, () => {
    moveOn(db, getRow(db, id), today)
    return getRecurring(db, id)
  })
}

/**
 * Auto-pay: once a due date has passed, record the payment (dated on the due date) and move to the next one.
 * - Charged the day after the due date, so on the day it shows "Renews today" (and can still be edited or cancelled).
 * - Due dates from before you set the date (e.g. you entered when it last renewed) count as already paid: no backfill.
 * Returns how many payments were recorded.
 */
export function processAutopay(db: Db, today = localDate()): number {
  let count = 0
  tx(db, () => {
    const rows = db
      .prepare('SELECT * FROM recurring WHERE deleted_at IS NULL AND active = 1 AND autopay = 1 AND next_due < ?')
      .all(today) as unknown as RecurringRow[]
    for (const start of rows) {
      let r = start
      for (let guard = 0; guard < 400 && r.active === 1 && r.next_due < today; guard++) {
        if (r.amount_cents > 0 && r.next_due >= (r.due_set_on ?? '')) {
          addTransaction(db, payment(r, r.next_due))
          count++
        }
        moveOn(db, r, today)
        r = getRow(db, r.id)
      }
    }
  })
  return count
}

/** Due dates of active bills/subscriptions in [from, to] (overdue ones show on their original date). */
export function occurrences(db: Db, from: string, to: string, today = localDate()): MoneyOccurrence[] {
  const rows = db.prepare('SELECT * FROM recurring WHERE deleted_at IS NULL AND active = 1').all() as unknown as RecurringRow[]
  const out: MoneyOccurrence[] = []
  for (const r of rows) {
    let date = r.next_due
    for (let guard = 0; guard < 400 && date <= to; guard++) {
      if (date >= from) {
        out.push({ recurringId: r.id, date, name: r.name, kind: r.kind, amountCents: r.amount_cents, autopay: r.autopay === 1, overdue: date < today })
      }
      if (r.frequency === 'once') break
      date = advance(date, r.frequency, r.anchor_day)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

// ---------- Transactions ----------

interface TxRow {
  id: string
  date: string
  type: 'income' | 'expense'
  amount_cents: number
  description: string
  category: string
  method: string
  ticket_id: string | null
  recurring_id: string | null
  updated_at: number
  ticket_number: number | null
  customer_name: string | null
}

const TX_SELECT = `SELECT x.*, t.number AS ticket_number, c.name AS customer_name
  FROM transactions x
  LEFT JOIN tickets t ON t.id = x.ticket_id
  LEFT JOIN customers c ON c.id = t.customer_id`

const toTx = (r: TxRow): Transaction => ({
  id: r.id,
  date: r.date,
  type: r.type,
  amountCents: r.amount_cents,
  description: r.description,
  category: r.category,
  method: r.method,
  ticketId: r.ticket_id,
  ticketLabel: r.ticket_number ? [formatTicketNumber(r.ticket_number), r.customer_name].filter(Boolean).join(' · ') : '',
  recurringId: r.recurring_id,
  updatedAt: r.updated_at
})

export function listTransactions(db: Db, f: TransactionFilter = {}): Transaction[] {
  const where = ['x.deleted_at IS NULL']
  const params: string[] = []
  if (isDate(f.from)) {
    where.push('x.date >= ?')
    params.push(f.from)
  }
  if (isDate(f.to)) {
    where.push('x.date <= ?')
    params.push(f.to)
  }
  if (f.type) {
    where.push('x.type = ?')
    params.push(f.type)
  }
  if (f.ticketId) {
    where.push('x.ticket_id = ?')
    params.push(f.ticketId)
  }
  for (const word of (f.query ?? '').trim().split(/\s+/).filter(Boolean)) {
    where.push(`(x.description LIKE ? ESCAPE '\\' OR x.category LIKE ? ESCAPE '\\' OR x.method LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`)
    params.push(likeTerm(word), likeTerm(word), likeTerm(word), likeTerm(word))
  }
  const rows = db.prepare(`${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.date DESC, x.created_at DESC`).all(...params)
  return (rows as unknown as TxRow[]).map(toTx)
}

function getTx(db: Db, id: string): Transaction {
  const r = db.prepare(`${TX_SELECT} WHERE x.id = ?`).get(id) as TxRow | undefined
  if (!r) throw new Error(`Transaction not found: ${id}`)
  return toTx(r)
}

export function addTransaction(db: Db, input: TransactionInput, today = localDate()): Transaction {
  if (input.type !== 'income' && input.type !== 'expense') throw new Error(`Unknown type: ${input.type}`)
  const id = newId()
  const t = now()
  db.prepare(
    `INSERT INTO transactions (id, date, type, amount_cents, description, category, method, ticket_id, recurring_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    isDate(input.date) ? input.date : today,
    input.type,
    Math.max(0, Math.round(input.amountCents)),
    (input.description ?? '').slice(0, 300),
    (input.category ?? '').slice(0, 100),
    (input.method ?? '').slice(0, 50),
    input.ticketId ?? null,
    input.recurringId ?? null,
    t,
    t
  )
  return getTx(db, id)
}

export function updateTransaction(db: Db, id: string, patch: Partial<TransactionInput>): Transaction {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const set = (col: string, v: string | number | null): void => {
    sets.push(`${col} = ?`)
    params.push(v)
  }
  if (patch.date !== undefined && isDate(patch.date)) set('date', patch.date)
  if (patch.type === 'income' || patch.type === 'expense') set('type', patch.type)
  if (patch.amountCents !== undefined) set('amount_cents', Math.max(0, Math.round(patch.amountCents)))
  if (patch.description !== undefined) set('description', patch.description.slice(0, 300))
  if (patch.category !== undefined) set('category', patch.category.slice(0, 100))
  if (patch.method !== undefined) set('method', patch.method.slice(0, 50))
  set('updated_at', now())
  params.push(id)
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getTx(db, id)
}

export function removeTransaction(db: Db, id: string): void {
  db.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

export function categories(db: Db): string[] {
  const used = db
    .prepare(
      `SELECT category FROM transactions WHERE deleted_at IS NULL AND category <> ''
       UNION SELECT category FROM recurring WHERE deleted_at IS NULL AND category <> ''`
    )
    .all() as { category: string }[]
  const all = new Map<string, string>()
  for (const c of [...used.map((u) => u.category), ...DEFAULT_CATEGORIES]) if (!all.has(c.toLowerCase())) all.set(c.toLowerCase(), c)
  return [...all.values()].sort((a, b) => a.localeCompare(b))
}

// ---------- Summary & export ----------

export function summary(db: Db, month: string, today = localDate()): MoneySummary {
  const [y, m] = month.split('-').map(Number)
  const from = fmt(y, m, 1)
  const to = fmt(y, m, daysInMonth(y, m))
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense
       FROM transactions WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`
    )
    .get(from, to) as { income: number; expense: number }
  const subs = (db.prepare("SELECT amount_cents, frequency FROM recurring WHERE deleted_at IS NULL AND active = 1 AND kind = 'subscription'").all() as {
    amount_cents: number
    frequency: Frequency
  }[]).reduce((sum, s) => sum + monthlyCost(s.amount_cents, s.frequency), 0)

  // Overdue (any age) + due within 30 days, one entry per bill (its next due date).
  const upcoming = occurrences(db, '0000-01-01', addDays(today, 30), today).filter(
    (o, i, all) => all.findIndex((x) => x.recurringId === o.recurringId) === i
  )

  const unpaid = db
    .prepare(
      `SELECT t.id, t.number, t.device, t.status, t.price_cents, c.name AS customer_name,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions p WHERE p.ticket_id = t.id AND p.type = 'income' AND p.deleted_at IS NULL) AS paid
       FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.deleted_at IS NULL AND t.price_cents > 0 AND t.status IN ('ready', 'picked_up')
       ORDER BY t.number`
    )
    .all() as { id: string; number: number; device: string; status: UnpaidTicket['status']; price_cents: number; customer_name: string | null; paid: number }[]
  const unpaidTickets = unpaid
    .filter((t) => t.paid < t.price_cents)
    .map((t) => ({
      ticketId: t.id,
      number: t.number,
      customerName: t.customer_name ?? '',
      device: t.device,
      status: t.status,
      priceCents: t.price_cents,
      paidCents: t.paid
    }))

  return {
    month,
    incomeCents: totals.income,
    expenseCents: totals.expense,
    subscriptionsMonthlyCents: subs,
    subscriptionsYearlyCents: subs * 12,
    upcoming,
    unpaidTickets
  }
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV of transactions in [from, to] (oldest first) — for taxes / the accountant. */
export function transactionsCsv(db: Db, from: string, to: string): string {
  const rows = listTransactions(db, { from, to }).reverse()
  const lines = [['Date', 'Type', 'Amount', 'Description', 'Category', 'Method', 'Ticket'].join(',')]
  for (const t of rows) {
    const amount = (t.type === 'expense' ? -t.amountCents : t.amountCents) / 100
    lines.push([t.date, t.type === 'income' ? 'Income' : 'Expense', amount.toFixed(2), t.description, t.category, t.method, t.ticketLabel].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
