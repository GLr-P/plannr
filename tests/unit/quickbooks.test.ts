import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as customers from '../../src/main/services/customers'
import * as tickets from '../../src/main/services/tickets'
import * as money from '../../src/main/services/money'
import { setSetting } from '../../src/main/services/settings'
import { loadOptions, QboError, splitTax, syncQuickBooks, type QboApi, type QboEntity } from '../../src/main/services/quickbooks'
import type { QboConfig } from '../../src/shared/api'

/** In-memory QuickBooks Online (the bits Plannr uses), including SyncToken versioning. */
class FakeQbo implements QboApi {
  store: Record<string, QboEntity[]> = {
    Customer: [],
    SalesReceipt: [],
    Purchase: [],
    Vendor: [{ Id: 'v1', SyncToken: '0', DisplayName: 'Staples' }],
    PaymentMethod: [
      { Id: 'pm-cash', SyncToken: '0', Name: 'Cash' },
      { Id: 'pm-visa', SyncToken: '0', Name: 'Visa' }
    ],
    Account: [
      { Id: 'a-parts', SyncToken: '0', Name: 'Parts', AccountType: 'Cost of Goods Sold' },
      { Id: 'a-misc', SyncToken: '0', Name: 'Miscellaneous', AccountType: 'Expense' },
      { Id: 'a-bank', SyncToken: '0', Name: 'Chequing', AccountType: 'Bank' },
      { Id: 'a-sales', SyncToken: '0', Name: 'Sales', AccountType: 'Income' }
    ],
    Item: [{ Id: 'i-repair', SyncToken: '0', Name: 'Repair services', Type: 'Service' }],
    TaxCode: [
      { Id: 't-hst', SyncToken: '0', Name: 'HST ON', SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: 'r13' } }] }, PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: 'r13p' } }] } },
      { Id: 't-ex', SyncToken: '0', Name: 'Exempt' }
    ],
    TaxRate: [
      { Id: 'r13', SyncToken: '0', RateValue: 13 },
      { Id: 'r13p', SyncToken: '0', RateValue: 13 }
    ]
  }
  calls: string[] = []
  private seq = 0

  async query<T>(sql: string): Promise<T[]> {
    const entity = /from (\w+)/i.exec(sql)![1]
    let rows = this.store[entity] ?? []
    const byName = /DisplayName = '((?:[^'\\]|\\.)*)'/.exec(sql)
    if (byName) rows = rows.filter((r) => r.DisplayName === byName[1].replace(/\\'/g, "'"))
    return structuredClone(rows) as T[]
  }
  async create(entity: string, body: Record<string, unknown>) {
    if (entity === 'Customer') {
      const taken = [...this.store.Customer, ...this.store.Vendor].some((r) => r.DisplayName === body.DisplayName)
      if (taken) throw new QboError('6240', 'Duplicate Name Exists Error')
    }
    const e = { ...structuredClone(body), Id: `${entity}-${++this.seq}`, SyncToken: '0' } as QboEntity
    this.store[entity].push(e)
    this.calls.push(`create ${entity}`)
    return e
  }
  async update(entity: string, body: Record<string, unknown>) {
    const e = this.store[entity].find((r) => r.Id === body.Id)
    if (!e) throw new QboError('610', 'Object Not Found')
    if (e.SyncToken !== body.SyncToken) throw new QboError('5010', 'Stale Object Error')
    const { sparse: _sparse, ...rest } = body
    Object.assign(e, structuredClone(rest), { SyncToken: String(Number(e.SyncToken) + 1) })
    this.calls.push(`update ${entity}`)
    return structuredClone(e)
  }
  async remove(entity: string, id: string, syncToken: string) {
    const i = this.store[entity].findIndex((r) => r.Id === id && r.SyncToken === syncToken)
    if (i < 0) throw new QboError('610', 'Object Not Found')
    this.store[entity].splice(i, 1)
    this.calls.push(`delete ${entity}`)
  }
}

const CONFIG: QboConfig = {
  itemId: 'i-repair',
  taxCodeId: 't-hst',
  taxRate: 13,
  paymentAccountId: 'a-bank',
  paymentAccountType: 'Bank',
  expenseAccountId: 'a-misc',
  purchaseTaxCodeId: 't-hst',
  purchaseTaxRate: 13,
  startDate: '2026-10-01'
}

let db: Db
let qbo: FakeQbo
const tick = () => new Promise((r) => setTimeout(r, 3))

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  qbo = new FakeQbo()
  setSetting(db, 'qbo.config', CONFIG)
})

describe('tax split (prices include tax)', () => {
  it('splits so net + tax always equals what was paid', () => {
    expect(splitTax(11300, 13)).toEqual({ net: 10000, tax: 1300 })
    expect(splitTax(15000, 13)).toEqual({ net: 13274, tax: 1726 })
    expect(splitTax(999, 0)).toEqual({ net: 999, tax: 0 })
    for (const g of [1, 7, 101, 12345, 99999]) {
      const { net, tax } = splitTax(g, 13)
      expect(net + tax).toBe(g)
    }
  })
})

describe('customers → QuickBooks', () => {
  it('creates, updates, reuses an existing same-name customer, and handles names taken by vendors', async () => {
    const jane = customers.createCustomer(db, { name: 'Jane Doe', email: 'jane@x.com', phone: '555-1234', address: '1 Main St' })
    qbo.store.Customer.push({ Id: 'c-bob', SyncToken: '3', DisplayName: 'Bob Smith' }) // already in QuickBooks
    customers.createCustomer(db, { name: 'Bob Smith' })
    customers.createCustomer(db, { name: 'Staples' }) // same name as a vendor
    customers.createCustomer(db, { name: '' }) // waits for a name
    const r = await syncQuickBooks(db, qbo)
    expect(r.problems).toEqual([])
    expect(qbo.store.Customer.map((c) => c.DisplayName).sort()).toEqual(['Bob Smith', 'Jane Doe', 'Staples (customer)'])
    const janeQ = qbo.store.Customer.find((c) => c.DisplayName === 'Jane Doe')!
    expect(janeQ).toMatchObject({ PrimaryEmailAddr: { Address: 'jane@x.com' }, PrimaryPhone: { FreeFormNumber: '555-1234' }, BillAddr: { Line1: '1 Main St' } })

    await tick()
    customers.updateCustomer(db, jane.id, { phone: '555-9999' })
    await syncQuickBooks(db, qbo)
    expect(janeQ.PrimaryPhone).toBeDefined()
    expect(qbo.store.Customer.find((c) => c.DisplayName === 'Jane Doe')!.PrimaryPhone).toEqual({ FreeFormNumber: '555-9999' })
    const callsBefore = qbo.calls.length
    await syncQuickBooks(db, qbo) // nothing changed
    expect(qbo.calls.length).toBe(callsBefore)

    await tick()
    customers.trashCustomer(db, jane.id)
    await syncQuickBooks(db, qbo)
    expect(qbo.store.Customer.find((c) => c.DisplayName === 'Jane Doe')!.Active).toBe(false) // made inactive, not deleted
  })
})

describe('transactions → QuickBooks', () => {
  it('a ticket payment becomes a tax-inclusive sales receipt for the customer with the repair as description', async () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe' })
    const t = tickets.createTicket(db, { customerId: c.id, templateId: null })
    tickets.updateTicket(db, t.id, { device: 'iPhone 13', issue: 'Cracked screen', priceCents: 15000 })
    money.addTransaction(db, { type: 'income', amountCents: 15000, ticketId: t.id, method: 'Cash', date: '2026-10-04', description: 'Payment · NT-0001' })
    await syncQuickBooks(db, qbo)
    const [sr] = qbo.store.SalesReceipt
    expect(sr).toMatchObject({
      TxnDate: '2026-10-04',
      CustomerRef: { value: qbo.store.Customer[0].Id },
      GlobalTaxCalculation: 'TaxInclusive',
      PaymentMethodRef: { value: 'pm-cash' },
      TxnTaxDetail: { TotalTax: 17.26 }
    })
    expect((sr.Line as Record<string, unknown>[])[0]).toEqual({
      DetailType: 'SalesItemLineDetail',
      Amount: 132.74,
      Description: 'NT-0001 · iPhone 13 · Cracked screen',
      SalesItemLineDetail: { ItemRef: { value: 'i-repair' }, TaxCodeRef: { value: 't-hst' }, TaxInclusiveAmt: 150 }
    })
  })

  it('a "no tax" payment goes with the Exempt code and no tax split; switching it back re-sends it taxed', async () => {
    const x = money.addTransaction(db, { type: 'income', amountCents: 15000, date: '2026-10-05', taxExempt: true })
    await syncQuickBooks(db, qbo)
    const [sr] = qbo.store.SalesReceipt
    expect(sr.TxnTaxDetail).toEqual({ TotalTax: 0 })
    expect((sr.Line as Record<string, unknown>[])[0]).toMatchObject({ Amount: 150, SalesItemLineDetail: { TaxCodeRef: { value: 't-ex' }, TaxInclusiveAmt: 150 } })
    await tick()
    money.updateTransaction(db, x.id, { taxExempt: false })
    await syncQuickBooks(db, qbo)
    expect(qbo.store.SalesReceipt[0].TxnTaxDetail).toEqual({ TotalTax: 17.26 })
  })

  it('expenses become purchases from the chosen account, matched to a same-name expense account', async () => {
    money.addTransaction(db, { type: 'expense', amountCents: 5650, category: 'Parts', description: 'Screen', method: 'Card', date: '2026-10-05' })
    money.addTransaction(db, { type: 'expense', amountCents: 1000, category: 'Coffee', date: '2026-10-05' })
    await syncQuickBooks(db, qbo)
    const [parts, coffee] = qbo.store.Purchase
    expect(parts).toMatchObject({ PaymentType: 'Cash', AccountRef: { value: 'a-bank' }, TxnTaxDetail: { TotalTax: 6.5 } })
    expect((parts.Line as { AccountBasedExpenseLineDetail: unknown; Amount: number }[])[0]).toMatchObject({
      Amount: 50,
      AccountBasedExpenseLineDetail: { AccountRef: { value: 'a-parts' }, TaxInclusiveAmt: 56.5 }
    })
    expect((coffee.Line as { AccountBasedExpenseLineDetail: { AccountRef: { value: string } } }[])[0].AccountBasedExpenseLineDetail.AccountRef.value).toBe('a-misc')
  })

  it('a paid subscription (auto-pay) lands in QuickBooks as an expense too', async () => {
    const s = money.createRecurring(db, 'subscription', '2026-10-01')
    money.updateRecurring(db, s.id, { name: 'Adobe', amountCents: 5999, category: 'Software', nextDue: '2026-10-02' }, '2026-10-01')
    money.markPaid(db, s.id, { date: '2026-10-02' }, '2026-10-02')
    await syncQuickBooks(db, qbo)
    expect(qbo.store.Purchase).toHaveLength(1)
    expect(qbo.store.Purchase[0].PrivateNote).toContain('Adobe')
  })

  it('edits update, deletes delete, and history before the start date is not sent', async () => {
    money.addTransaction(db, { type: 'expense', amountCents: 2000, date: '2026-09-15', description: 'Old' }) // before start
    const x = money.addTransaction(db, { type: 'expense', amountCents: 2000, date: '2026-10-05', description: 'Tools' })
    await syncQuickBooks(db, qbo)
    expect(qbo.store.Purchase.map((p) => p.PrivateNote)).toEqual(['Tools · From Plannr'])
    await tick()
    money.updateTransaction(db, x.id, { amountCents: 3000 })
    await syncQuickBooks(db, qbo)
    expect(qbo.store.Purchase[0].TxnTaxDetail).toEqual({ TotalTax: 3.45 })
    expect(qbo.store.Purchase[0].SyncToken).toBe('1')
    await tick()
    money.removeTransaction(db, x.id)
    await syncQuickBooks(db, qbo)
    expect(qbo.store.Purchase).toEqual([])
  })

  it('one bad record does not stop the rest; problems are reported', async () => {
    money.addTransaction(db, { type: 'expense', amountCents: 1000, date: '2026-10-05', description: 'Fine' })
    const broken = Object.assign(Object.create(qbo), qbo, {
      create: async (entity: string, body: Record<string, unknown>) => {
        if (entity === 'SalesReceipt') throw new QboError('6000', 'A business validation error has occurred')
        return qbo.create(entity, body)
      }
    }) as QboApi
    money.addTransaction(db, { type: 'income', amountCents: 5000, date: '2026-10-05' })
    const r = await syncQuickBooks(db, broken)
    expect(r.problems).toEqual(['Sale on 2026-10-05 ($50.00): A business validation error has occurred'])
    expect(qbo.store.Purchase).toHaveLength(1)
  })

  it('without expense accounts chosen, sales still go and expenses wait until they are', async () => {
    setSetting(db, 'qbo.config', { ...CONFIG, paymentAccountId: '', paymentAccountType: '', expenseAccountId: '', purchaseTaxCodeId: '' })
    money.addTransaction(db, { type: 'expense', amountCents: 1000, date: '2026-10-05', description: 'Tools' })
    money.addTransaction(db, { type: 'income', amountCents: 5000, date: '2026-10-05' })
    const r = await syncQuickBooks(db, qbo)
    expect(r.problems).toEqual([])
    expect(qbo.store.SalesReceipt).toHaveLength(1)
    expect(qbo.store.Purchase).toHaveLength(0)
    setSetting(db, 'qbo.config', CONFIG)
    await syncQuickBooks(db, qbo)
    expect(qbo.store.Purchase).toHaveLength(1)
  })

  it('refuses to sync until the where-things-go choices are made', async () => {
    setSetting(db, 'qbo.config', { ...CONFIG, taxCodeId: '' })
    await expect(syncQuickBooks(db, qbo)).rejects.toThrow(/Choose where things go/)
  })
})

describe('options for Settings', () => {
  it('lists items, accounts by type, and tax codes with their rates', async () => {
    const o = await loadOptions(qbo, 'Nano Tech Services')
    expect(o.items).toEqual([{ id: 'i-repair', name: 'Repair services' }])
    expect(o.paymentAccounts).toEqual([{ id: 'a-bank', name: 'Chequing', detail: 'Bank' }])
    expect(o.expenseAccounts.map((a) => a.name)).toEqual(['Miscellaneous', 'Parts'])
    expect(o.taxCodes).toEqual([
      { id: 't-ex', name: 'Exempt', rate: 0, detail: '0' },
      { id: 't-hst', name: 'HST ON', rate: 13, detail: '13' }
    ])
  })
})
