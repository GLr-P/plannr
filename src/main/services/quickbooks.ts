import type { Db } from '../db'
import { now } from '../db'
import { formatTicketNumber, type QboConfig, type QboOptions } from '../../shared/api'
import { getSetting, setSetting } from './settings'

/*
 * QuickBooks Online sync (one way: Plannr → QuickBooks)
 * -----------------------------------------------------
 * customers                    → Customer (matched by display name; renamed " (customer)" if the name is taken)
 * income transactions          → SalesReceipt (ticket payments carry the customer + repair description)
 * expense transactions         → Purchase (paid from the chosen bank/credit card account)
 * Plannr amounts include tax: lines send the pre-tax Amount plus TaxInclusiveAmt, and the tax total is set so
 * QuickBooks' total equals exactly what was paid. qbo_links remembers each record's QuickBooks Id + SyncToken.
 * The HTTP API is injected (QboApi) so this is unit-tested against a fake.
 */

export interface QboEntity {
  Id: string
  SyncToken: string
  [key: string]: unknown
}

export interface QboApi {
  query<T = QboEntity>(sql: string): Promise<T[]>
  create(entity: string, body: Record<string, unknown>): Promise<QboEntity>
  update(entity: string, body: Record<string, unknown>): Promise<QboEntity>
  remove(entity: string, id: string, syncToken: string): Promise<void>
}

export class QboError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

type LocalType = 'customer' | 'income' | 'expense'
interface Link {
  qbo_id: string
  sync_token: string
  synced_at: number
}

const q = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export const getConfig = (db: Db): QboConfig | null => (getSetting(db, 'qbo.config') as QboConfig | null) ?? null

/** Sales + customers need only the item, sales tax and start date; expenses also need their accounts. */
export function configComplete(c: QboConfig | null): c is QboConfig {
  return Boolean(c && c.itemId && c.taxCodeId && c.startDate)
}

/** Expenses wait (unsent) until the paid-from account, expense account and purchase tax are chosen. */
export const expensesReady = (c: QboConfig): boolean => Boolean(c.paymentAccountId && c.expenseAccountId && c.purchaseTaxCodeId)

/** Pre-tax amount and tax for a tax-included total (rate in %). Cents; the two always add up to the total. */
export function splitTax(grossCents: number, ratePercent: number): { net: number; tax: number } {
  const net = ratePercent > 0 ? Math.round(grossCents / (1 + ratePercent / 100)) : grossCents
  return { net, tax: grossCents - net }
}

const dollars = (cents: number): number => Math.round(cents) / 100

function getLink(db: Db, type: LocalType, id: string): Link | undefined {
  return db.prepare('SELECT qbo_id, sync_token, synced_at FROM qbo_links WHERE local_type = ? AND local_id = ?').get(type, id) as Link | undefined
}

function setLink(db: Db, type: LocalType, id: string, entity: QboEntity, syncedAt: number): void {
  db.prepare(
    `INSERT INTO qbo_links (local_type, local_id, qbo_id, sync_token, synced_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_type, local_id) DO UPDATE SET qbo_id = excluded.qbo_id, sync_token = excluded.sync_token, synced_at = excluded.synced_at`
  ).run(type, id, entity.Id, entity.SyncToken, syncedAt)
}

const dropLink = (db: Db, type: LocalType, id: string): void => {
  db.prepare('DELETE FROM qbo_links WHERE local_type = ? AND local_id = ?').run(type, id)
}

// ---------- Customers ----------

interface CustomerRow {
  id: string
  name: string
  phone: string
  email: string
  address: string
  updated_at: number
  deleted_at: number | null
}

function customerBody(c: CustomerRow, displayName: string): Record<string, unknown> {
  return {
    DisplayName: displayName.slice(0, 100),
    PrimaryEmailAddr: c.email ? { Address: c.email } : undefined,
    PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : undefined,
    BillAddr: c.address ? { Line1: c.address.slice(0, 500) } : undefined,
    Notes: 'From Plannr'
  }
}

async function syncCustomer(db: Db, api: QboApi, c: CustomerRow): Promise<string | null> {
  const link = getLink(db, 'customer', c.id)
  if (c.deleted_at !== null) {
    if (link && link.synced_at < c.updated_at) {
      const e = await api.update('Customer', { Id: link.qbo_id, SyncToken: link.sync_token, sparse: true, Active: false })
      setLink(db, 'customer', c.id, e, c.updated_at)
    }
    return link?.qbo_id ?? null
  }
  const name = c.name.trim()
  if (!name) return null // waits until it has a name (QuickBooks requires one)
  if (link && link.synced_at >= c.updated_at) return link.qbo_id
  if (link) {
    const e = await api.update('Customer', { Id: link.qbo_id, SyncToken: link.sync_token, sparse: true, ...customerBody(c, name) })
    setLink(db, 'customer', c.id, e, c.updated_at)
    return e.Id
  }
  // New in QuickBooks: reuse a customer with the same name (e.g. created there by hand) instead of duplicating.
  const [existing] = await api.query(`select * from Customer where DisplayName = '${q(name)}'`)
  let entity: QboEntity
  if (existing) {
    entity = await api.update('Customer', { Id: existing.Id, SyncToken: existing.SyncToken, sparse: true, ...customerBody(c, name) })
  } else {
    try {
      entity = await api.create('Customer', customerBody(c, name))
    } catch (err) {
      if (!(err instanceof QboError && err.code === '6240')) throw err // 6240 = name used by a vendor/employee
      entity = await api.create('Customer', customerBody(c, `${name} (customer)`))
    }
  }
  setLink(db, 'customer', c.id, entity, c.updated_at)
  return entity.Id
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
  updated_at: number
  deleted_at: number | null
  ticket_number: number | null
  device: string | null
  issue: string | null
  customer_id: string | null
}

function salesReceipt(t: TxRow, cfg: QboConfig, customerQboId: string | null, paymentMethods: Map<string, string>): Record<string, unknown> {
  const { net, tax } = splitTax(t.amount_cents, cfg.taxRate)
  const repair = t.ticket_number ? [formatTicketNumber(t.ticket_number), t.device, t.issue].filter(Boolean).join(' · ') : ''
  const methodId = paymentMethods.get(t.method.trim().toLowerCase())
  return {
    TxnDate: t.date,
    CustomerRef: customerQboId ? { value: customerQboId } : undefined,
    GlobalTaxCalculation: 'TaxInclusive',
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: dollars(net),
        Description: (repair || t.description || 'Sale').slice(0, 4000),
        SalesItemLineDetail: { ItemRef: { value: cfg.itemId }, TaxCodeRef: { value: cfg.taxCodeId }, TaxInclusiveAmt: dollars(t.amount_cents) }
      }
    ],
    TxnTaxDetail: { TotalTax: dollars(tax) },
    PaymentMethodRef: methodId ? { value: methodId } : undefined,
    PrivateNote: [t.description, 'From Plannr'].filter(Boolean).join(' · ').slice(0, 4000)
  }
}

function purchase(t: TxRow, cfg: QboConfig, expenseAccounts: Map<string, string>): Record<string, unknown> {
  const { net, tax } = splitTax(t.amount_cents, cfg.purchaseTaxRate)
  const account = expenseAccounts.get(t.category.trim().toLowerCase()) ?? cfg.expenseAccountId
  return {
    TxnDate: t.date,
    PaymentType: cfg.paymentAccountType === 'Credit Card' ? 'CreditCard' : 'Cash',
    AccountRef: { value: cfg.paymentAccountId },
    GlobalTaxCalculation: 'TaxInclusive',
    Line: [
      {
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: dollars(net),
        Description: (t.description || t.category || 'Expense').slice(0, 4000),
        AccountBasedExpenseLineDetail: { AccountRef: { value: account }, TaxCodeRef: { value: cfg.purchaseTaxCodeId }, TaxInclusiveAmt: dollars(t.amount_cents) }
      }
    ],
    TxnTaxDetail: { TotalTax: dollars(tax) },
    PrivateNote: [t.description, t.method, 'From Plannr'].filter(Boolean).join(' · ').slice(0, 4000)
  }
}

const ENTITY: Record<'income' | 'expense', string> = { income: 'SalesReceipt', expense: 'Purchase' }

export interface QboSyncResult {
  customers: number
  transactions: number
  problems: string[]
}

/** Sends new/changed/deleted customers and transactions to QuickBooks. Failures are collected per record. */
export async function syncQuickBooks(db: Db, api: QboApi): Promise<QboSyncResult> {
  const cfg = getConfig(db)
  if (!configComplete(cfg)) throw new Error('Choose where things go in QuickBooks first (Settings → QuickBooks)')
  const problems: string[] = []
  let customers = 0
  let transactions = 0
  try {
    // Customers (every Plannr customer)
    const customerIds = new Map<string, string | null>()
    const rows = db.prepare('SELECT id, name, phone, email, address, updated_at, deleted_at FROM customers').all() as unknown as CustomerRow[]
    for (const c of rows) {
      const before = getLink(db, 'customer', c.id)?.synced_at
      try {
        customerIds.set(c.id, await syncCustomer(db, api, c))
        if (getLink(db, 'customer', c.id)?.synced_at !== before) customers++
      } catch (err) {
        problems.push(`Customer “${c.name || 'unnamed'}”: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Lookups for transactions
    const paymentMethods = new Map(
      (await api.query<{ Id: string; Name: string }>('select * from PaymentMethod')).map((m) => [m.Name.trim().toLowerCase(), m.Id])
    )
    const expenseAccounts = new Map(
      (
        await api.query<{ Id: string; Name: string }>(
          "select * from Account where AccountType in ('Expense', 'Cost of Goods Sold', 'Other Expense')"
        )
      ).map((a) => [a.Name.trim().toLowerCase(), a.Id])
    )

    // Transactions on/after the start date (and deletions of ones already sent)
    const txs = db
      .prepare(
        `SELECT x.id, x.date, x.type, x.amount_cents, x.description, x.category, x.method, x.updated_at, x.deleted_at,
                t.number AS ticket_number, t.device, t.issue, t.customer_id
         FROM transactions x LEFT JOIN tickets t ON t.id = x.ticket_id
         WHERE x.date >= ? OR x.id IN (SELECT local_id FROM qbo_links WHERE local_type IN ('income', 'expense'))`
      )
      .all(cfg.startDate) as unknown as TxRow[]
    for (const t of txs) {
      const link = getLink(db, t.type, t.id)
      if (link && link.synced_at >= t.updated_at) continue
      try {
        if (t.deleted_at !== null || t.date < cfg.startDate || t.amount_cents === 0) {
          if (link) {
            await api.remove(ENTITY[t.type], link.qbo_id, link.sync_token)
            dropLink(db, t.type, t.id)
            transactions++
          }
          continue
        }
        if (t.type === 'expense' && !expensesReady(cfg)) continue
        const customerQboId = t.customer_id ? (customerIds.get(t.customer_id) ?? getLink(db, 'customer', t.customer_id)?.qbo_id ?? null) : null
        const body = t.type === 'income' ? salesReceipt(t, cfg, customerQboId, paymentMethods) : purchase(t, cfg, expenseAccounts)
        const entity = link
          ? await api.update(ENTITY[t.type], { ...body, Id: link.qbo_id, SyncToken: link.sync_token, sparse: true })
          : await api.create(ENTITY[t.type], body)
        setLink(db, t.type, t.id, entity, t.updated_at)
        transactions++
      } catch (err) {
        const what = t.type === 'income' ? 'Sale' : 'Expense'
        problems.push(`${what} on ${t.date} ($${dollars(t.amount_cents).toFixed(2)}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setSetting(db, 'qbo.lastSyncAt', now())
    setSetting(db, 'qbo.error', null)
    setSetting(db, 'qbo.problems', problems)
    return { customers, transactions, problems }
  } catch (err) {
    setSetting(db, 'qbo.error', err instanceof Error ? err.message : String(err))
    throw err
  }
}

/** Lists for the Settings choices. Tax codes come with their combined sales/purchase rates. */
export async function loadOptions(api: QboApi, companyName: string): Promise<QboOptions> {
  const [items, accounts, taxCodes, taxRates] = await Promise.all([
    api.query<{ Id: string; Name: string; Type: string; Active?: boolean }>("select * from Item where Type = 'Service'"),
    api.query<{ Id: string; Name: string; AccountType: string; Active?: boolean }>('select * from Account maxresults 1000'),
    api.query<{
      Id: string
      Name: string
      Active?: boolean
      SalesTaxRateList?: { TaxRateDetail?: { TaxRateRef: { value: string } }[] }
      PurchaseTaxRateList?: { TaxRateDetail?: { TaxRateRef: { value: string } }[] }
    }>('select * from TaxCode'),
    api.query<{ Id: string; RateValue?: number }>('select * from TaxRate')
  ])
  const rateOf = new Map(taxRates.map((r) => [r.Id, Number(r.RateValue ?? 0)]))
  const sum = (list?: { TaxRateDetail?: { TaxRateRef: { value: string } }[] }): number =>
    (list?.TaxRateDetail ?? []).reduce((s, d) => s + (rateOf.get(d.TaxRateRef.value) ?? 0), 0)
  const active = <T extends { Active?: boolean }>(x: T): boolean => x.Active !== false
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)
  return {
    companyName,
    items: items.filter(active).map((i) => ({ id: i.Id, name: i.Name })).sort(byName),
    incomeAccounts: accounts.filter((a) => active(a) && a.AccountType === 'Income').map((a) => ({ id: a.Id, name: a.Name })).sort(byName),
    taxCodes: taxCodes
      .filter(active)
      .map((t) => ({ id: t.Id, name: t.Name, rate: sum(t.SalesTaxRateList), detail: String(sum(t.PurchaseTaxRateList)) }))
      .sort(byName),
    paymentAccounts: accounts
      .filter((a) => active(a) && (a.AccountType === 'Bank' || a.AccountType === 'Credit Card'))
      .map((a) => ({ id: a.Id, name: a.Name, detail: a.AccountType }))
      .sort(byName),
    expenseAccounts: accounts
      .filter((a) => active(a) && ['Expense', 'Cost of Goods Sold', 'Other Expense'].includes(a.AccountType))
      .map((a) => ({ id: a.Id, name: a.Name, detail: a.AccountType }))
      .sort(byName)
  }
}

export function clearQboData(db: Db): void {
  db.exec('DELETE FROM qbo_links')
  for (const key of ['qbo.config', 'qbo.lastSyncAt', 'qbo.error', 'qbo.problems', 'qbo.companyName']) setSetting(db, key, null)
}
