import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as tickets from '../../src/main/services/tickets'
import * as items from '../../src/main/services/items'
import { setSetting } from '../../src/main/services/settings'
import { DEFAULT_BUSINESS } from '../../src/main/services/print'
import { quoteHtml, invoiceHtml } from '../../src/main/services/print'
import { ticketTotals, type LineItem } from '../../src/shared/api'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  setSetting(db, 'business', { taxName: 'GST', taxRate: 5 })
})

const line = (kind: LineItem['kind'], qty: number, unitCents: number, costCents: number | null = null): LineItem => ({
  id: String(Math.random()),
  ticketId: 't',
  kind,
  description: '',
  qty,
  unitCents,
  partId: null,
  costCents,
  sort: 0
})

describe('ticket totals', () => {
  it('adds tax on top by default; discounts come off before tax; profit excludes tax and parts cost', () => {
    const t = ticketTotals([line('part', 1, 12900, 8000), line('labour', 1, 6000), line('discount', 1, 900)], { taxRate: 5, pricesIncludeTax: false, exempt: false })
    expect(t).toEqual({ subtotal: 18900, discount: 900, tax: 900, total: 18900, cost: 8000, profit: 10000 })
  })
  it('prices that already include tax, and tax-exempt tickets', () => {
    expect(ticketTotals([line('labour', 2, 5250)], { taxRate: 5, pricesIncludeTax: true, exempt: false })).toMatchObject({ tax: 500, total: 10500 })
    expect(ticketTotals([line('labour', 1, 10000)], { taxRate: 5, pricesIncludeTax: false, exempt: true })).toMatchObject({ tax: 0, total: 10000 })
  })
})

describe('line items and inventory', () => {
  it('the ticket price follows its lines; a hand-typed price is kept while there are none', () => {
    const t = tickets.createTicket(db, {})
    tickets.updateTicket(db, t.id, { priceCents: 5000 })
    const [labour] = items.addItem(db, t.id, { kind: 'labour', description: 'Screen swap', unitCents: 6000 })
    expect(tickets.getTicket(db, t.id)!.priceCents).toBe(6300) // + 5% GST
    tickets.updateTicket(db, t.id, { taxExempt: true })
    expect(tickets.getTicket(db, t.id)!.priceCents).toBe(6000)
    items.removeItem(db, labour.id)
    expect(tickets.getTicket(db, t.id)!.priceCents).toBe(6000) // left as it was
  })

  it('parts used on a ticket come off stock, and go back when changed or removed', () => {
    const screen = items.createPart(db, { name: 'iPhone 13 screen', qty: 5, costCents: 8000, priceCents: 12900, reorderAt: 2 })
    const t = tickets.createTicket(db, {})
    const [l] = items.addItem(db, t.id, { kind: 'part', partId: screen.id })
    expect(l).toMatchObject({ description: 'iPhone 13 screen', unitCents: 12900, costCents: 8000 })
    expect(items.listParts(db)[0]).toMatchObject({ qty: 4, used: 1 })
    items.updateItem(db, l.id, { qty: 3 })
    expect(items.listParts(db)[0].qty).toBe(2)
    expect(items.lowStockCount(db)).toBe(1)
    expect(items.listParts(db, { lowOnly: true })).toHaveLength(1)
    expect(items.totalsFor(db, t.id)).toMatchObject({ cost: 24000, profit: 38700 - 24000 })
    items.updateItem(db, l.id, { kind: 'labour' }) // no longer a part line: stock returns
    expect(items.listParts(db)[0].qty).toBe(5)
    items.updateItem(db, l.id, { kind: 'part', partId: screen.id })
    items.removeItem(db, l.id)
    expect(items.listParts(db)[0].qty).toBe(5)
  })

  it('quote and invoice show the lines, tax, total, payments and balance', () => {
    const t = tickets.createTicket(db, {})
    items.addItem(db, t.id, { kind: 'labour', description: 'Battery replacement', unitCents: 8000 })
    items.addItem(db, t.id, { kind: 'discount', description: 'Returning customer', unitCents: 1000 })
    const ticket = tickets.getTicket(db, t.id)!
    const data = { ticket, customer: null, business: { ...DEFAULT_BUSINESS, taxName: 'GST', taxRate: 5 }, logo: null, items: items.listItems(db, t.id) }
    const quote = quoteHtml({ ...data, payments: [] })
    expect(quote).toContain('Battery replacement')
    expect(quote).toContain('Discount: Returning customer')
    expect(quote).toContain('GST (5%)')
    expect(quote).toContain('$73.50') // (80 − 10) + 5%
    const pay = { id: 'p', date: '2026-10-05', type: 'income' as const, amountCents: 5000, description: '', category: '', method: 'Cash', ticketId: t.id, ticketLabel: '', recurringId: null, taxExempt: false, qboInvoice: '', updatedAt: 0 }
    expect(invoiceHtml({ ...data, payments: [pay] })).toContain('Balance owing: $23.50')
  })
})
