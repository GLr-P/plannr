import type { Db } from '../db'
import { newId, now, tx } from '../db'
import {
  formatTicketNumber,
  statusLabel,
  TICKET_PARTS,
  TICKET_STATUSES,
  ticketLayout,
  type TicketPart,
  type DocJSON,
  type Ticket,
  type TicketFilter,
  type TicketStatus,
  type TicketSummary,
  type TicketUpdate
} from '../../shared/api'
import { indexEntity, unindexEntity } from './search'
import { setLinks } from './links'
import { digitsOnly, extractMentions, extractText, isDate, likeTerm, localDate } from './doc'
import { getTemplate, getDefaultTemplateId , layoutForTicket } from './templates'
import { syncPickupFromTicket } from './calendar'
import { syncTicketPrice } from './items'

interface TicketRow {
  id: string
  number: number
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_company: string | null
  for_id: string | null
  for_name: string | null
  business: number
  parts: string | null
  status: TicketStatus
  device: string
  issue: string
  price_cents: number | null
  received_on: string | null
  pickup_on: string | null
  warranty_until: string | null
  closed_at: number | null
  paid_cents: number
  tax_exempt: number
  created_at: number
  updated_at: number
  deleted_at: number | null
  template_id?: string | null
  content_json?: string | null
}

const COLS = `t.id, t.number, t.customer_id, t.status, t.device, t.issue, t.price_cents, t.received_on, t.pickup_on, t.warranty_until,
  t.closed_at, t.created_at, t.updated_at, t.deleted_at, t.tax_exempt,
  c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.company AS customer_company,
  t.for_id, f.name AS for_name, t.business, t.parts,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions p WHERE p.ticket_id = t.id AND p.type = 'income' AND p.deleted_at IS NULL) AS paid_cents`
const FROM = 'FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN customers f ON f.id = t.for_id'

const PART_IDS = new Set<string>(TICKET_PARTS)
/** A ticket's added parts as stored (unknown or repeated ones dropped) */
export function parseParts(raw: string | null | undefined): TicketPart[] {
  try {
    const list = JSON.parse(raw || '[]') as unknown
    return Array.isArray(list) ? [...new Set(list.filter((p): p is TicketPart => typeof p === 'string' && PART_IDS.has(p)))] : []
  } catch {
    return []
  }
}

const STATUS_IDS = new Set<string>(TICKET_STATUSES.map((s) => s.id))

function toSummary(r: TicketRow): TicketSummary {
  return {
    id: r.id,
    number: r.number,
    customerId: r.customer_id,
    customerName: r.customer_name ?? '',
    customerPhone: r.customer_phone ?? '',
    customerEmail: r.customer_email ?? '',
    customerCompany: r.customer_company ?? '',
    forId: r.for_id ?? null,
    forName: r.for_id ? (r.for_name ?? '').trim() || 'Unnamed customer' : '',
    business: r.business === 1,
    parts: parseParts(r.parts),
    status: r.status,
    device: r.device,
    issue: r.issue,
    priceCents: r.price_cents,
    receivedOn: r.received_on,
    pickupOn: r.pickup_on,
    warrantyUntil: r.warranty_until ?? null,
    closedAt: r.closed_at,
    paidCents: r.paid_cents ?? 0,
    taxExempt: r.tax_exempt === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

/** "NT-0007 · iPhone 13" — used for search results, mentions and backlinks. */
export function ticketTitle(t: { number: number; device: string }): string {
  return t.device.trim() ? `${formatTicketNumber(t.number)} · ${t.device.trim()}` : formatTicketNumber(t.number)
}

export function reindexTicket(db: Db, id: string): void {
  const r = db.prepare(`SELECT ${COLS}, t.content_text ${FROM} WHERE t.id = ?`).get(id) as (TicketRow & { content_text: string }) | undefined
  if (!r || r.deleted_at !== null) return unindexEntity(db, id)
  const phone = r.customer_phone ?? ''
  // Shown in result snippets:
  const body = [r.customer_name, r.issue, r.content_text.replace(/\n/g, ' · ')].filter(Boolean).join(' · ')
  // Matched but never shown:
  // The person it's for and the business (when it's for the business) find it too
  const extra = [statusLabel(r.status), String(r.number), phone, digitsOnly(phone), r.customer_email, r.for_name, r.business ? r.customer_company : ''].filter(Boolean).join(' ')
  indexEntity(db, 'ticket', id, ticketTitle(r), body, r.updated_at, extra)
}

export function reindexTicketsOfCustomer(db: Db, customerId: string): void {
  const rows = db.prepare('SELECT id FROM tickets WHERE customer_id = ? OR for_id = ?').all(customerId, customerId) as { id: string }[]
  for (const { id } of rows) reindexTicket(db, id)
}

export function listTickets(db: Db, f: TicketFilter = {}): TicketSummary[] {
  const where: string[] = [f.trashed ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL']
  const params: (string | number)[] = []
  const status = f.status ?? 'all'
  if (status === 'open') where.push("t.status <> 'picked_up'")
  else if (status !== 'all') {
    where.push('t.status = ?')
    params.push(status)
  }
  if (f.customerId) {
    // Their own tickets and the ones done for them on someone else's account (Randy's ticket for his wife is on hers too)
    where.push('(t.customer_id = ? OR t.for_id = ?)')
    params.push(f.customerId, f.customerId)
  }
  if (isDate(f.from)) {
    where.push('t.received_on >= ?')
    params.push(f.from)
  }
  if (isDate(f.to)) {
    where.push('t.received_on <= ?')
    params.push(f.to)
  }
  for (const word of (f.query ?? '').trim().split(/\s+/).filter(Boolean)) {
    const like = likeTerm(word)
    const cols = ['c.name', 'c.email', 'c.company', 'f.name', 't.device', 't.issue', 't.content_text']
    const ors = cols.map((col) => `${col} LIKE ? ESCAPE '\\'`)
    for (let i = 0; i < cols.length; i++) params.push(like)
    // Repair number: "NT-0007", "nt7", "0007" or "7" (any letters before it, so a custom prefix works too)
    const num = /^(?:[a-z]+-?)?0*(\d+)$/i.exec(word)
    if (num) {
      ors.push('t.number = ?')
      params.push(Number(num[1]))
    }
    const digits = digitsOnly(word)
    if (digits.length >= 3) {
      ors.push('c.phone_digits LIKE ?')
      params.push(`%${digits}%`)
    }
    where.push(`(${ors.join(' OR ')})`)
  }
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 2000)
  params.push(limit)
  const rows = db
    .prepare(`SELECT ${COLS} ${FROM} WHERE ${where.join(' AND ')} ORDER BY t.number DESC LIMIT ?`)
    .all(...params) as unknown as TicketRow[]
  return rows.map(toSummary)
}

export function getTicket(db: Db, id: string): Ticket | null {
  const r = db.prepare(`SELECT ${COLS}, t.template_id, t.content_json ${FROM} WHERE t.id = ?`).get(id) as TicketRow | undefined
  const layout = r ? layoutForTicket(db, id) : null
  if (!r) return null
  return {
    ...toSummary(r),
    templateId: r.template_id ?? null,
    layout: layout!,
    content: r.content_json ? (JSON.parse(r.content_json) as DocJSON) : null
  }
}

function getSummary(db: Db, id: string): TicketSummary {
  const r = db.prepare(`SELECT ${COLS} ${FROM} WHERE t.id = ?`).get(id) as TicketRow | undefined
  if (!r) throw new Error(`Ticket not found: ${id}`)
  return toSummary(r)
}

/** Creates the next-numbered ticket, starting from a copy of the template (or the default template). */
export function createTicket(db: Db, input: { templateId?: string | null; customerId?: string | null } = {}): Ticket {
  const id = newId()
  const t = now()
  tx(db, () => {
    const { next } = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM tickets').get() as { next: number }
    const templateId = input.templateId === undefined ? getDefaultTemplateId(db) : input.templateId
    const template = templateId ? getTemplate(db, templateId) : null
    const content = template?.content ?? null
    const parts = template ? ticketLayout(template.layout).parts : [] // a preset's photos, pickup date…
    db.prepare(
      `INSERT INTO tickets (id, number, customer_id, status, received_on, template_id, content_json, content_text, parts, created_at, updated_at)
       VALUES (?, ?, ?, 'intake', ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, next, input.customerId ?? null, localDate(), template?.id ?? null, content ? JSON.stringify(content) : null, extractText(content), JSON.stringify(parts), t, t)
    reindexTicket(db, id)
  })
  return getTicket(db, id)!
}

export function updateTicket(db: Db, id: string, patch: TicketUpdate): TicketSummary {
  return tx(db, () => {
    const sets: string[] = []
    const params: (string | number | null)[] = []
    const set = (col: string, value: string | number | null): void => {
      sets.push(`${col} = ?`)
      params.push(value)
    }
    if (patch.customerId !== undefined) set('customer_id', patch.customerId)
    if (patch.status !== undefined) {
      if (!STATUS_IDS.has(patch.status)) throw new Error(`Unknown status: ${patch.status}`)
      set('status', patch.status)
      set('closed_at', patch.status === 'picked_up' ? now() : null)
    }
    if (patch.device !== undefined) set('device', patch.device.slice(0, 200))
    if (patch.issue !== undefined) set('issue', patch.issue.slice(0, 500))
    if (patch.priceCents !== undefined) set('price_cents', patch.priceCents === null ? null : Math.round(patch.priceCents))
    if (patch.receivedOn !== undefined) set('received_on', isDate(patch.receivedOn) ? patch.receivedOn : null)
    if (patch.pickupOn !== undefined) {
      const pickup = isDate(patch.pickupOn) ? patch.pickupOn : null
      set('pickup_on', pickup)
      syncPickupFromTicket(db, id, pickup) // the pickup shows on the calendar
    }
    if (patch.warrantyUntil !== undefined) set('warranty_until', isDate(patch.warrantyUntil) ? patch.warrantyUntil : null)
    if (patch.taxExempt !== undefined) set('tax_exempt', patch.taxExempt ? 1 : 0)
    if (patch.forId !== undefined) set('for_id', patch.forId || null)
    if (patch.business !== undefined) set('business', patch.business ? 1 : 0)
    if (patch.parts !== undefined) set('parts', JSON.stringify(parseParts(JSON.stringify(patch.parts))))
    if (patch.content !== undefined) {
      set('content_json', JSON.stringify(patch.content))
      set('content_text', extractText(patch.content))
      setLinks(db, 'ticket', id, extractMentions(patch.content))
    }
    set('updated_at', now())
    params.push(id)
    const result = db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    if (result.changes === 0) throw new Error(`Ticket not found: ${id}`)
    if (patch.taxExempt !== undefined) syncTicketPrice(db, id) // the total changes with the tax
    reindexTicket(db, id)
    return getSummary(db, id)
  })
}

export function touchTicket(db: Db, id: string): void {
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), id)
  reindexTicket(db, id)
}

export function trashTicket(db: Db, id: string): void {
  tx(db, () => {
    db.prepare('UPDATE tickets SET deleted_at = ? WHERE id = ?').run(now(), id)
    unindexEntity(db, id)
  })
}

export function restoreTicket(db: Db, id: string): void {
  tx(db, () => {
    db.prepare('UPDATE tickets SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
    reindexTicket(db, id)
  })
}

export function ticketCounts(db: Db): { open: number; ready: number } {
  return db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE status <> 'picked_up') AS open, COUNT(*) FILTER (WHERE status = 'ready') AS ready
       FROM tickets WHERE deleted_at IS NULL`
    )
    .get() as { open: number; ready: number }
}
