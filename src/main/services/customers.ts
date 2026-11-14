import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { Customer, CustomerInput, CustomerLink, CustomerSummary, LinkedCustomer } from '../../shared/api'
import { indexEntity, unindexEntity } from './search'
import { digitsOnly, likeTerm } from './doc'
import { reindexTicketsOfCustomer } from './tickets'

interface CustomerRow {
  id: string
  name: string
  phone: string
  email: string
  address: string
  company: string
  city: string
  region: string
  postal_code: string
  notes: string
  related?: string
  created_at: number
  updated_at: number
  deleted_at: number | null
  ticket_count?: number
  last_visit?: string | null
}

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  address: r.address,
  company: r.company ?? '',
  city: r.city ?? '',
  region: r.region ?? '',
  postalCode: r.postal_code ?? '',
  notes: r.notes,
  related: parseLinks(r.related),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/** A customer's links as stored (bad or missing JSON reads as none; self-links and duplicates dropped) */
export function parseLinks(raw: string | undefined | null, self?: string): CustomerLink[] {
  let list: unknown
  try {
    list = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: CustomerLink[] = []
  for (const l of list) {
    const id = typeof l?.id === 'string' ? l.id : ''
    if (!id || id === self || seen.has(id)) continue
    seen.add(id)
    out.push({ id, relation: typeof l.relation === 'string' ? l.relation.trim().slice(0, 60) : '' })
  }
  return out
}

/**
 * Everyone linked to a customer: the people listed on their page, and the customers who listed them
 * (Jane's page shows Randy, whose page says Jane is his Wife). Trashed customers are left out.
 */
export function linkedCustomers(db: Db, id: string): LinkedCustomer[] {
  const me = db.prepare('SELECT related FROM customers WHERE id = ?').get(id) as { related: string } | undefined
  if (!me) return []
  const out = new Map<string, LinkedCustomer>()
  const row = (cid: string) => db.prepare('SELECT id, name, phone, email FROM customers WHERE id = ? AND deleted_at IS NULL').get(cid) as { id: string; name: string; phone: string; email: string } | undefined
  for (const link of parseLinks(me.related, id)) {
    const r = row(link.id)
    if (r) out.set(r.id, { id: r.id, name: customerName(r.name), phone: r.phone, email: r.email, relation: link.relation, reverse: false })
  }
  const others = db
    .prepare(`SELECT c.id, c.name, c.phone, c.email, c.related FROM customers c, json_each(c.related) j
             WHERE c.deleted_at IS NULL AND json_valid(c.related) AND json_extract(j.value, '$.id') = ? AND c.id <> ?`)
    .all(id, id) as { id: string; name: string; phone: string; email: string; related: string }[]
  for (const o of others) {
    if (out.has(o.id)) continue
    const relation = parseLinks(o.related).find((l) => l.id === id)?.relation ?? ''
    out.set(o.id, { id: o.id, name: customerName(o.name), phone: o.phone, email: o.email, relation, reverse: true })
  }
  return [...out.values()]
}

export const customerName = (name: string): string => name.trim() || 'Unnamed customer'

export function reindexCustomer(db: Db, id: string): void {
  const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined
  if (!r || r.deleted_at !== null) return unindexEntity(db, id)
  const body = [r.company, r.phone, r.email, r.address, r.city, r.postal_code, r.notes].filter(Boolean).join(' · ')
  indexEntity(db, 'customer', id, customerName(r.name), body, r.updated_at, digitsOnly(r.phone))
}

/**
 * SQL conditions matching every word of `query` against name/email/address/phone.
 * Phone matching ignores formatting: "5551234" matches "(555) 123-4…".
 */
function queryConditions(query: string | undefined, cols: { name: string; email: string; address: string; company: string; digits: string }): {
  sql: string[]
  params: string[]
} {
  const sql: string[] = []
  const params: string[] = []
  for (const word of (query ?? '').trim().split(/\s+/).filter(Boolean)) {
    const ors = [`${cols.name} LIKE ? ESCAPE '\\'`, `${cols.email} LIKE ? ESCAPE '\\'`, `${cols.address} LIKE ? ESCAPE '\\'`, `${cols.company} LIKE ? ESCAPE '\\'`]
    params.push(likeTerm(word), likeTerm(word), likeTerm(word), likeTerm(word))
    const digits = digitsOnly(word)
    if (digits.length >= 3) {
      ors.push(`${cols.digits} LIKE ?`)
      params.push(`%${digits}%`)
    }
    sql.push(`(${ors.join(' OR ')})`)
  }
  return { sql, params }
}

export function listCustomers(db: Db, opts: { query?: string; limit?: number } = {}): CustomerSummary[] {
  const q = queryConditions(opts.query, { name: 'c.name', email: 'c.email', address: 'c.address', company: 'c.company', digits: 'c.phone_digits' })
  const where = ['c.deleted_at IS NULL', ...q.sql].join(' AND ')
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000)
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM tickets t WHERE t.customer_id = c.id AND t.deleted_at IS NULL) AS ticket_count,
         (SELECT MAX(t.received_on) FROM tickets t WHERE t.customer_id = c.id AND t.deleted_at IS NULL) AS last_visit
       FROM customers c WHERE ${where}
       ORDER BY c.name COLLATE NOCASE LIMIT ?`
    )
    .all(...q.params, limit) as unknown as CustomerRow[]
  return rows.map((r) => ({ ...toCustomer(r), ticketCount: r.ticket_count ?? 0, lastVisit: r.last_visit ?? null }))
}

export function getCustomer(db: Db, id: string): Customer | null {
  const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined
  return r ? toCustomer(r) : null
}

const clean = (s: string | undefined, max = 500): string => (s ?? '').trim().slice(0, max)

export function createCustomer(db: Db, input: CustomerInput = {}): Customer {
  const id = newId()
  const t = now()
  tx(db, () => {
    const phone = clean(input.phone, 50)
    db.prepare(
      `INSERT INTO customers (id, name, phone, phone_digits, email, address, company, city, region, postal_code, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, clean(input.name, 200), phone, digitsOnly(phone), clean(input.email, 200), clean(input.address), clean(input.company, 200), clean(input.city, 100), clean(input.region, 100), clean(input.postalCode, 20), clean(input.notes, 20000), t, t)
    reindexCustomer(db, id)
  })
  return getCustomer(db, id)!
}

export function updateCustomer(db: Db, id: string, patch: CustomerInput): Customer {
  return tx(db, () => {
    const sets: string[] = []
    const params: (string | number)[] = []
    const set = (col: string, value: string): void => {
      sets.push(`${col} = ?`)
      params.push(value)
    }
    // Text is saved as typed (trimming would fight the cursor while editing); search ignores whitespace anyway.
    if (patch.name !== undefined) set('name', patch.name.slice(0, 200))
    if (patch.phone !== undefined) {
      set('phone', patch.phone.slice(0, 50))
      set('phone_digits', digitsOnly(patch.phone))
    }
    if (patch.email !== undefined) set('email', patch.email.slice(0, 200))
    if (patch.address !== undefined) set('address', patch.address.slice(0, 500))
    if (patch.company !== undefined) set('company', patch.company.slice(0, 200))
    if (patch.city !== undefined) set('city', patch.city.slice(0, 100))
    if (patch.region !== undefined) set('region', patch.region.slice(0, 100))
    if (patch.postalCode !== undefined) set('postal_code', patch.postalCode.slice(0, 20))
    if (patch.notes !== undefined) set('notes', patch.notes.slice(0, 20000))
    if (patch.related !== undefined) set('related', JSON.stringify(parseLinks(JSON.stringify(patch.related), id).slice(0, 100)))
    sets.push('updated_at = ?')
    params.push(now(), id)
    const result = db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    if (result.changes === 0) throw new Error(`Customer not found: ${id}`)
    reindexCustomer(db, id)
    reindexTicketsOfCustomer(db, id) // tickets are searchable by customer name/phone/email
    return getCustomer(db, id)!
  })
}

/** Soft-deletes the customer. Their tickets are kept and still show the name. */
export function restoreCustomer(db: Db, id: string): void {
  db.prepare('UPDATE customers SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
  reindexCustomer(db, id)
}

export function trashCustomer(db: Db, id: string): void {
  tx(db, () => {
    db.prepare('UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
    unindexEntity(db, id)
  })
}
