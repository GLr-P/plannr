import type { Db } from '../db'
import { newId, now, tx } from '../db'
import { ticketTotals, type LineInput, type LineItem, type LineKind, type Part, type PartInput, type TicketTotals } from '../../shared/api'
import { getSetting } from './settings'
import { DEFAULT_BUSINESS } from './print'
import { likeTerm } from './doc'

/*
 * Ticket line items (parts, labour, other, discounts) and the parts inventory.
 * A part line linked to an inventory part takes its quantity off stock (and gives it back when changed or removed),
 * and remembers the part's cost at that moment, for profit per ticket. The ticket's price follows its items' total.
 */

const KINDS: LineKind[] = ['part', 'labour', 'other', 'discount']

interface ItemRow {
  id: string
  ticket_id: string
  kind: LineKind
  description: string
  qty: number
  unit_cents: number
  part_id: string | null
  cost_cents: number | null
  sort: number
}

const toItem = (r: ItemRow): LineItem => ({
  id: r.id,
  ticketId: r.ticket_id,
  kind: r.kind,
  description: r.description,
  qty: r.qty,
  unitCents: r.unit_cents,
  partId: r.part_id,
  costCents: r.cost_cents,
  sort: r.sort
})

export function listItems(db: Db, ticketId: string): LineItem[] {
  const rows = db.prepare('SELECT * FROM ticket_items WHERE ticket_id = ? ORDER BY sort, created_at').all(ticketId) as unknown as ItemRow[]
  return rows.map(toItem)
}

/** Tax settings used for ticket totals: the business tax rate (or QuickBooks' sales tax), and whether prices already include it. */
export function taxSettings(db: Db): { taxRate: number; pricesIncludeTax: boolean } {
  const business = { ...DEFAULT_BUSINESS, ...((getSetting(db, 'business') as Record<string, unknown> | null) ?? {}) }
  const qbo = getSetting(db, 'qbo.config') as { taxRate?: number } | null
  return { taxRate: Number(business.taxRate) || Number(qbo?.taxRate) || 0, pricesIncludeTax: Boolean(business.pricesIncludeTax) }
}

export function totalsFor(db: Db, ticketId: string): TicketTotals {
  const exempt = (db.prepare('SELECT tax_exempt FROM tickets WHERE id = ?').get(ticketId) as { tax_exempt: number } | undefined)?.tax_exempt === 1
  return ticketTotals(listItems(db, ticketId), { ...taxSettings(db), exempt })
}

/** Keeps the ticket's price equal to its items' total (only while it has items; a hand-typed price is left alone). */
export function syncTicketPrice(db: Db, ticketId: string): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM ticket_items WHERE ticket_id = ?').get(ticketId) as { n: number }).n
  if (!count) return
  db.prepare('UPDATE tickets SET price_cents = ?, updated_at = ? WHERE id = ?').run(totalsFor(db, ticketId).total, now(), ticketId)
}

const stock = (db: Db, partId: string | null, delta: number): void => {
  if (partId && delta) db.prepare('UPDATE parts SET qty = qty + ?, updated_at = ? WHERE id = ?').run(delta, now(), partId)
}

function partRow(db: Db, id: string | null | undefined): PartRow | undefined {
  return id ? (db.prepare('SELECT * FROM parts WHERE id = ? AND deleted_at IS NULL').get(id) as PartRow | undefined) : undefined
}

export function addItem(db: Db, ticketId: string, input: LineInput = {}): LineItem[] {
  tx(db, () => {
    const kind = KINDS.includes(input.kind as LineKind) ? (input.kind as LineKind) : 'labour'
    const part = kind === 'part' ? partRow(db, input.partId) : undefined
    const qty = clampQty(input.qty ?? 1)
    const { next } = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM ticket_items WHERE ticket_id = ?').get(ticketId) as { next: number }
    const t = now()
    db.prepare(
      `INSERT INTO ticket_items (id, ticket_id, kind, description, qty, unit_cents, part_id, cost_cents, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId(),
      ticketId,
      kind,
      (input.description ?? part?.name ?? '').slice(0, 300),
      qty,
      Math.max(0, Math.round(input.unitCents ?? part?.price_cents ?? 0)),
      part?.id ?? null,
      part ? part.cost_cents : null,
      next,
      t,
      t
    )
    if (part) stock(db, part.id, -qty)
    syncTicketPrice(db, ticketId)
  })
  return listItems(db, ticketId)
}

export function updateItem(db: Db, id: string, patch: LineInput): LineItem[] {
  const before = db.prepare('SELECT * FROM ticket_items WHERE id = ?').get(id) as ItemRow | undefined
  if (!before) throw new Error('Line not found')
  tx(db, () => {
    const kind = patch.kind !== undefined && KINDS.includes(patch.kind) ? patch.kind : before.kind
    const qty = patch.qty !== undefined ? clampQty(patch.qty) : before.qty
    // Linking a different part (or none, or no longer a part line): give the old stock back, take the new.
    let partId = patch.partId !== undefined ? patch.partId : before.part_id
    if (kind !== 'part') partId = null
    const part = partRow(db, partId)
    if (!part) partId = null
    stock(db, before.part_id, before.qty)
    stock(db, partId, -qty)
    const partChanged = partId !== before.part_id
    db.prepare(
      'UPDATE ticket_items SET kind = ?, description = ?, qty = ?, unit_cents = ?, part_id = ?, cost_cents = ?, updated_at = ? WHERE id = ?'
    ).run(
      kind,
      (patch.description ?? (partChanged && part ? part.name : before.description)).slice(0, 300),
      qty,
      Math.max(0, Math.round(patch.unitCents ?? (partChanged && part ? part.price_cents : before.unit_cents))),
      partId,
      partChanged ? (part?.cost_cents ?? null) : before.cost_cents,
      now(),
      id
    )
    syncTicketPrice(db, before.ticket_id)
  })
  return listItems(db, before.ticket_id)
}

export function removeItem(db: Db, id: string): LineItem[] {
  const before = db.prepare('SELECT * FROM ticket_items WHERE id = ?').get(id) as ItemRow | undefined
  if (!before) return []
  tx(db, () => {
    stock(db, before.part_id, before.qty)
    db.prepare('DELETE FROM ticket_items WHERE id = ?').run(id)
    syncTicketPrice(db, before.ticket_id)
  })
  return listItems(db, before.ticket_id)
}

export function setTaxExempt(db: Db, ticketId: string, exempt: boolean): void {
  db.prepare('UPDATE tickets SET tax_exempt = ?, updated_at = ? WHERE id = ?').run(exempt ? 1 : 0, now(), ticketId)
  syncTicketPrice(db, ticketId)
}

const clampQty = (q: number): number => Math.max(0, Math.min(100000, Math.round((Number(q) || 0) * 100) / 100))

// ---------- Inventory ----------

interface PartRow {
  id: string
  name: string
  sku: string
  qty: number
  cost_cents: number
  price_cents: number
  reorder_at: number
  supplier: string
  notes: string
  updated_at: number
  used: number
}

const toPart = (r: PartRow): Part => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  qty: r.qty,
  costCents: r.cost_cents,
  priceCents: r.price_cents,
  reorderAt: r.reorder_at,
  supplier: r.supplier,
  notes: r.notes,
  used: r.used ?? 0,
  updatedAt: r.updated_at
})

const PART_COLS = `p.*, (SELECT COALESCE(SUM(i.qty), 0) FROM ticket_items i WHERE i.part_id = p.id) AS used`

export function listParts(db: Db, opts: { query?: string; lowOnly?: boolean } = {}): Part[] {
  const where = ['p.deleted_at IS NULL']
  const params: string[] = []
  for (const word of (opts.query ?? '').trim().split(/\s+/).filter(Boolean)) {
    where.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.supplier LIKE ? ESCAPE '\\')`)
    params.push(likeTerm(word), likeTerm(word), likeTerm(word))
  }
  if (opts.lowOnly) where.push('p.reorder_at > 0 AND p.qty <= p.reorder_at')
  const rows = db.prepare(`SELECT ${PART_COLS} FROM parts p WHERE ${where.join(' AND ')} ORDER BY lower(p.name)`).all(...params) as unknown as PartRow[]
  return rows.map(toPart)
}

export const lowStockCount = (db: Db): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM parts WHERE deleted_at IS NULL AND reorder_at > 0 AND qty <= reorder_at').get() as { n: number }).n

export function createPart(db: Db, input: PartInput = {}): Part {
  const id = newId()
  const t = now()
  db.prepare(
    'INSERT INTO parts (id, name, sku, qty, cost_cents, price_cents, reorder_at, supplier, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.name?.trim() ?? '', input.sku ?? '', input.qty ?? 0, input.costCents ?? 0, input.priceCents ?? 0, input.reorderAt ?? 0, input.supplier ?? '', input.notes ?? '', t, t)
  return listParts(db).find((p) => p.id === id)!
}

export function updatePart(db: Db, id: string, patch: PartInput): Part {
  const sets: string[] = []
  const params: (string | number)[] = []
  const set = (col: string, v: string | number): void => {
    sets.push(`${col} = ?`)
    params.push(v)
  }
  if (patch.name !== undefined) set('name', patch.name.slice(0, 200))
  if (patch.sku !== undefined) set('sku', patch.sku.slice(0, 60))
  if (patch.qty !== undefined) set('qty', clampQty(patch.qty))
  if (patch.costCents !== undefined) set('cost_cents', Math.max(0, Math.round(patch.costCents)))
  if (patch.priceCents !== undefined) set('price_cents', Math.max(0, Math.round(patch.priceCents)))
  if (patch.reorderAt !== undefined) set('reorder_at', clampQty(patch.reorderAt))
  if (patch.supplier !== undefined) set('supplier', patch.supplier.slice(0, 200))
  if (patch.notes !== undefined) set('notes', patch.notes.slice(0, 2000))
  set('updated_at', now())
  params.push(id)
  db.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return listParts(db).find((p) => p.id === id)!
}

export function removePart(db: Db, id: string): void {
  db.prepare('UPDATE parts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

export function restorePart(db: Db, id: string): void {
  db.prepare('UPDATE parts SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
}

