import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as money from '../../src/main/services/money'
import * as tickets from '../../src/main/services/tickets'
import { setSetting } from '../../src/main/services/settings'
import { moneyReport } from '../../src/main/services/reports'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  setSetting(db, 'business', { taxName: 'GST', taxRate: 5 })
})

describe('money report', () => {
  it('GST: tax collected on sales minus tax paid on expenses; "no tax" entries are left out', () => {
    money.addTransaction(db, { type: 'income', amountCents: 21000, date: '2026-08-10' }) // $10 GST inside
    money.addTransaction(db, { type: 'income', amountCents: 5000, date: '2026-09-01', taxExempt: true })
    money.addTransaction(db, { type: 'expense', amountCents: 10500, date: '2026-07-20' }) // $5 GST inside
    money.addTransaction(db, { type: 'expense', amountCents: 9999, date: '2026-07-21', taxExempt: true }) // e.g. insurance
    money.addTransaction(db, { type: 'income', amountCents: 99999, date: '2026-10-01' }) // next quarter
    const r = moneyReport(db, '2026-07-01', '2026-09-30')
    expect(r.gst).toEqual({ sales: 26000, collected: 1000, exemptSales: 5000, expenses: 20499, paid: 500, net: 500 })
  })

  it('uses the QuickBooks purchase tax rate for expenses when set', () => {
    setSetting(db, 'qbo.config', { taxRate: 5, purchaseTaxRate: 12 })
    money.addTransaction(db, { type: 'expense', amountCents: 11200, date: '2026-07-20' })
    expect(moneyReport(db, '2026-07-01', '2026-09-30').gst.paid).toBe(1200)
  })

  it('12 months of income/expenses/tickets, plus turnaround, average ticket and top devices', () => {
    money.addTransaction(db, { type: 'income', amountCents: 10000, date: '2026-09-05' })
    money.addTransaction(db, { type: 'expense', amountCents: 2500, date: '2026-09-06' })
    for (const device of ['iPhone 13', 'iphone 13', 'Galaxy S22']) {
      const t = tickets.createTicket(db, {})
      tickets.updateTicket(db, t.id, { device, receivedOn: '2026-09-01', priceCents: 12000 })
    }
    const r = moneyReport(db, '2026-07-01', '2026-09-30')
    expect(r.monthly).toHaveLength(12)
    expect(r.monthly.at(-1)).toEqual({ month: '2026-09', income: 10000, expense: 2500, tickets: 3 })
    expect(r.monthly[0].month).toBe('2025-10')
    expect(r.repairs).toMatchObject({ count: 3, completed: 0, avgTurnaroundDays: null, avgValueCents: 12000 })
    expect(r.repairs.topDevices[0]).toEqual({ name: 'iPhone 13', count: 2 })
  })
})
