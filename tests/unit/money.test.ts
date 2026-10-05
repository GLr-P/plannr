import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as money from '../../src/main/services/money'
import * as tickets from '../../src/main/services/tickets'
import * as customers from '../../src/main/services/customers'
import { dueMoneyReminders, markReminderFired } from '../../src/main/services/reminders'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

const sub = (patch: Parameters<typeof money.updateRecurring>[2], today = '2026-10-04') => {
  const r = money.createRecurring(db, 'subscription', today)
  return money.updateRecurring(db, r.id, patch, today)
}

describe('due dates', () => {
  it('advances by frequency and keeps the day of month across short months', () => {
    expect(money.advance('2026-01-31', 'monthly', 31)).toBe('2026-02-28')
    expect(money.advance('2026-02-28', 'monthly', 31)).toBe('2026-03-31')
    expect(money.advance('2026-11-15', 'quarterly', 15)).toBe('2027-02-15')
    expect(money.advance('2024-02-29', 'yearly', 29)).toBe('2025-02-28')
    expect(money.advance('2026-12-28', 'weekly', 28)).toBe('2027-01-04')
  })

  it('converts to a monthly cost', () => {
    expect(money.monthlyCost(1200, 'yearly')).toBe(100)
    expect(money.monthlyCost(1000, 'weekly')).toBe(4333)
    expect(money.monthlyCost(3000, 'quarterly')).toBe(1000)
    expect(money.monthlyCost(999, 'once')).toBe(0)
  })
})

describe('bills & subscriptions', () => {
  it('creates with sensible defaults and validates', () => {
    const s = money.createRecurring(db, 'subscription', '2026-10-04')
    expect(s).toMatchObject({ kind: 'subscription', nextDue: '2026-10-04', frequency: 'monthly', autopay: true, remindDays: 3, active: true })
    const b = money.createRecurring(db, 'bill', '2026-10-04')
    expect(b.autopay).toBe(false)
    expect(() => money.updateRecurring(db, b.id, { frequency: 'daily' as never })).toThrow()
    expect(() => money.updateRecurring(db, b.id, { nextDue: '10/4' })).toThrow()
  })

  it('mark paid records an expense and moves to the next due date; skip just moves on', () => {
    const r = sub({ name: 'Adobe', amountCents: 5999, nextDue: '2026-10-15', category: 'Software' })
    const paid = money.markPaid(db, r.id, {}, '2026-10-14')
    expect(paid.nextDue).toBe('2026-11-15')
    const [t] = money.listTransactions(db)
    expect(t).toMatchObject({ type: 'expense', amountCents: 5999, description: 'Adobe', category: 'Software', date: '2026-10-14', recurringId: r.id })
    expect(money.skip(db, r.id, '2026-10-14').nextDue).toBe('2026-12-15')
    expect(money.listTransactions(db)).toHaveLength(1)
  })

  it('a one-time bill becomes inactive once paid', () => {
    const b = money.createRecurring(db, 'bill', '2026-10-04')
    money.updateRecurring(db, b.id, { frequency: 'once', amountCents: 50000, name: 'Tools' })
    expect(money.markPaid(db, b.id, {}, '2026-10-04').active).toBe(false)
  })

  it('auto-pay records every missed charge (the day after each due date) and catches up', () => {
    const r = sub({ name: 'Netflix', amountCents: 1549, nextDue: '2026-08-10' }, '2026-08-01')
    expect(money.processAutopay(db, '2026-10-12')).toBe(3) // Aug 10, Sep 10, Oct 10
    expect(money.getRecurring(db, r.id).nextDue).toBe('2026-11-10')
    expect(money.listTransactions(db).map((t) => [t.date, t.amountCents, t.method])).toEqual([
      ['2026-10-10', 1549, 'Auto-pay'],
      ['2026-09-10', 1549, 'Auto-pay'],
      ['2026-08-10', 1549, 'Auto-pay']
    ])
    expect(money.processAutopay(db, '2026-10-12')).toBe(0)
    // On the due day itself nothing is charged yet (it shows "Renews today")
    expect(money.processAutopay(db, '2026-11-10')).toBe(0)
    expect(money.processAutopay(db, '2026-11-11')).toBe(1)
    // Bills without auto-pay wait for you to mark them paid (they show as overdue)
    const bill = money.createRecurring(db, 'bill', '2026-10-01')
    money.processAutopay(db, '2026-10-12')
    expect(money.getRecurring(db, bill.id).nextDue).toBe('2026-10-01')
  })

  it('cancelling stops charges, reminders and calendar entries but keeps the record', () => {
    const r = sub({ name: 'Old app', amountCents: 500, nextDue: '2026-10-05' })
    money.updateRecurring(db, r.id, { active: false }, '2026-10-04')
    expect(money.getRecurring(db, r.id)).toMatchObject({ active: false, cancelledOn: '2026-10-04' })
    expect(money.processAutopay(db, '2026-10-30')).toBe(0)
    expect(money.occurrences(db, '2026-10-01', '2026-12-31')).toEqual([])
    expect(dueMoneyReminders(db, new Date(2026, 9, 2, 10))).toEqual([])
  })

  it('lists due dates in a range, repeating by frequency, flagging overdue', () => {
    sub({ name: 'Weekly', amountCents: 100, frequency: 'weekly', nextDue: '2026-10-01' })
    sub({ name: 'Yearly', amountCents: 9900, frequency: 'yearly', nextDue: '2026-10-20' })
    const occ = money.occurrences(db, '2026-10-01', '2026-10-31', '2026-10-10')
    expect(occ.map((o) => [o.name, o.date, o.overdue])).toEqual([
      ['Weekly', '2026-10-01', true],
      ['Weekly', '2026-10-08', true],
      ['Weekly', '2026-10-15', false],
      ['Yearly', '2026-10-20', false],
      ['Weekly', '2026-10-22', false],
      ['Weekly', '2026-10-29', false]
    ])
  })

  it('does not charge a new, unfinished or back-dated subscription', () => {
    const blank = money.createRecurring(db, 'subscription', '2026-10-04') // $0, due today
    expect(money.processAutopay(db, '2026-10-05')).toBe(0) // nothing to record for $0
    // Entering when it last renewed (a past date) means "already paid": no backfill, just moves to the next date
    const r = sub({ name: 'Spotify', amountCents: 1199, nextDue: '2026-07-15' }, '2026-10-04')
    expect(money.processAutopay(db, '2026-10-04')).toBe(0)
    expect(money.getRecurring(db, r.id).nextDue).toBe('2026-10-15')
    expect(money.listTransactions(db)).toEqual([])
    expect(money.getRecurring(db, blank.id).active).toBe(true)
  })
})

describe('reminders for bills & subscriptions', () => {
  it('reminds N days before at 9 AM and on the day at 8 AM, once each', () => {
    const r = sub({ name: 'Adobe', amountCents: 5999, nextDue: '2026-10-15', remindDays: 3, autopay: true })
    expect(dueMoneyReminders(db, new Date(2026, 9, 12, 8, 59))).toEqual([])
    const [before] = dueMoneyReminders(db, new Date(2026, 9, 12, 9, 1))
    expect(before).toMatchObject({ recurringId: r.id, title: 'Adobe', body: 'Renews in 3 days · $59.99 will be charged' })
    markReminderFired(db, before.recurringId, before.key)
    expect(dueMoneyReminders(db, new Date(2026, 9, 12, 9, 5))).toEqual([])
    expect(dueMoneyReminders(db, new Date(2026, 9, 15, 8, 30)).map((m) => m.body)).toEqual(['Renews today · $59.99'])
  })

  it('bill wording, "tomorrow", and reminders off', () => {
    const b = money.createRecurring(db, 'bill', '2026-10-04')
    money.updateRecurring(db, b.id, { name: 'Shop rent', amountCents: 120000, nextDue: '2026-11-01', remindDays: 1 })
    expect(dueMoneyReminders(db, new Date(2026, 9, 31, 9, 30)).map((m) => m.body)).toEqual(['Due tomorrow · $1200.00'])
    money.updateRecurring(db, b.id, { remindDays: -1 })
    expect(dueMoneyReminders(db, new Date(2026, 10, 1, 8, 30))).toEqual([])
  })
})

describe('transactions, ticket payments and summary', () => {
  it('records ticket payments, shows them on the ticket, and lists unpaid tickets', () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe' })
    const t = tickets.createTicket(db, { customerId: c.id, templateId: null })
    tickets.updateTicket(db, t.id, { priceCents: 15000, status: 'ready', device: 'iPhone 13' })
    money.addTransaction(db, { type: 'income', amountCents: 5000, ticketId: t.id, method: 'Cash', date: '2026-10-03' })
    expect(tickets.getTicket(db, t.id)!.paidCents).toBe(5000)
    let s = money.summary(db, '2026-10', '2026-10-04')
    expect(s.unpaidTickets).toEqual([
      { ticketId: t.id, number: 1, customerName: 'Jane Doe', device: 'iPhone 13', status: 'ready', priceCents: 15000, paidCents: 5000 }
    ])
    money.addTransaction(db, { type: 'income', amountCents: 10000, ticketId: t.id, method: 'Card', date: '2026-10-04' })
    s = money.summary(db, '2026-10', '2026-10-04')
    expect(s.unpaidTickets).toEqual([])
    expect(s.incomeCents).toBe(15000)
    expect(money.listTransactions(db, { ticketId: t.id })[0].ticketLabel).toBe('T-0001 · Jane Doe')
  })

  it('summarises a month: income, expenses, subscription cost, upcoming (overdue first)', () => {
    money.addTransaction(db, { type: 'income', amountCents: 20000, date: '2026-10-02' })
    money.addTransaction(db, { type: 'expense', amountCents: 4500, date: '2026-10-03', category: 'Parts' })
    money.addTransaction(db, { type: 'income', amountCents: 99999, date: '2026-09-30' }) // other month
    sub({ name: 'Netflix', amountCents: 1500, nextDue: '2026-10-20' })
    sub({ name: 'Domain', amountCents: 2400, frequency: 'yearly', nextDue: '2027-03-01' })
    const bill = money.createRecurring(db, 'bill', '2026-10-01')
    money.updateRecurring(db, bill.id, { name: 'Electric', amountCents: 9000, nextDue: '2026-10-01' })
    const s = money.summary(db, '2026-10', '2026-10-04')
    expect(s).toMatchObject({ incomeCents: 20000, expenseCents: 4500, subscriptionsMonthlyCents: 1700, subscriptionsYearlyCents: 20400 })
    expect(s.upcoming.map((u) => [u.name, u.overdue])).toEqual([
      ['Electric', true],
      ['Netflix', false]
    ])
  })

  it('filters transactions and exports CSV', () => {
    money.addTransaction(db, { type: 'expense', amountCents: 1234, date: '2026-10-05', description: 'Screen, "OEM"', category: 'Parts' })
    money.addTransaction(db, { type: 'income', amountCents: 5000, date: '2026-10-06', description: 'Repair', method: 'Zelle' })
    expect(money.listTransactions(db, { type: 'income' })).toHaveLength(1)
    expect(money.listTransactions(db, { query: 'oem' })).toHaveLength(1)
    expect(money.listTransactions(db, { from: '2026-10-06' })).toHaveLength(1)
    expect(money.transactionsCsv(db, '2026-10-01', '2026-10-31')).toBe(
      'Date,Type,Amount,Description,Category,Method,Ticket\r\n' +
        '2026-10-05,Expense,-12.34,"Screen, ""OEM""",Parts,,\r\n' +
        '2026-10-06,Income,50.00,Repair,,Zelle,\r\n'
    )
    expect(money.categories(db)).toContain('Parts')
  })
})
