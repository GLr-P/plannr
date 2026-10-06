import type { Db } from '../db'
import type { MoneyReport } from '../../shared/api'
import { splitTax } from './quickbooks'
import { taxSettings } from './items'
import { getSetting } from './settings'

/*
 * Money → Reports. GST/HST for a period: amounts in Plannr include tax, so the tax is split out of each payment
 * (sales rate) and each expense (purchase rate); "no tax" entries have none. Plus monthly totals and repair stats.
 */

function monthsBack(to: string, n: number): string[] {
  const [y, m] = to.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

export function moneyReport(db: Db, from: string, to: string): MoneyReport {
  const { taxRate } = taxSettings(db)
  const qbo = getSetting(db, 'qbo.config') as { purchaseTaxRate?: number } | null
  const purchaseRate = Number(qbo?.purchaseTaxRate) || taxRate

  // GST/HST for the period
  const txs = db
    .prepare('SELECT type, amount_cents, tax_exempt FROM transactions WHERE deleted_at IS NULL AND date BETWEEN ? AND ?')
    .all(from, to) as { type: 'income' | 'expense'; amount_cents: number; tax_exempt: number }[]
  const gst = { sales: 0, collected: 0, expenses: 0, paid: 0, exemptSales: 0 }
  for (const t of txs) {
    if (t.type === 'income') {
      gst.sales += t.amount_cents
      if (t.tax_exempt) gst.exemptSales += t.amount_cents
      else gst.collected += splitTax(t.amount_cents, taxRate).tax
    } else {
      gst.expenses += t.amount_cents
      if (!t.tax_exempt) gst.paid += splitTax(t.amount_cents, purchaseRate).tax
    }
  }

  // Last 12 months up to the end of the period
  const months = monthsBack(to, 12)
  const rows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, type, SUM(amount_cents) AS total FROM transactions
       WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY month, type`
    )
    .all(`${months[0]}-01`, to) as { month: string; type: string; total: number }[]
  const tickets = db
    .prepare(`SELECT substr(received_on, 1, 7) AS month, COUNT(*) AS n FROM tickets WHERE deleted_at IS NULL AND received_on BETWEEN ? AND ? GROUP BY month`)
    .all(`${months[0]}-01`, to) as { month: string; n: number }[]
  const monthly = months.map((month) => ({
    month,
    income: rows.find((r) => r.month === month && r.type === 'income')?.total ?? 0,
    expense: rows.find((r) => r.month === month && r.type === 'expense')?.total ?? 0,
    tickets: tickets.find((t) => t.month === month)?.n ?? 0
  }))

  // Repairs received in the period
  const repairs = db
    .prepare(
      `SELECT device, price_cents, received_on, closed_at, status FROM tickets
       WHERE deleted_at IS NULL AND received_on BETWEEN ? AND ?`
    )
    .all(from, to) as { device: string; price_cents: number | null; received_on: string; closed_at: number | null; status: string }[]
  const done = repairs.filter((r) => r.closed_at && r.received_on)
  const turnaround = done.length
    ? done.reduce((s, r) => s + Math.max(0, (r.closed_at! - new Date(`${r.received_on}T00:00`).getTime()) / 86_400_000), 0) / done.length
    : null
  const priced = repairs.filter((r) => (r.price_cents ?? 0) > 0)
  const devices = new Map<string, { name: string; count: number }>()
  for (const r of repairs) {
    const name = r.device.trim()
    if (!name) continue
    const key = name.toLowerCase()
    devices.set(key, { name: devices.get(key)?.name ?? name, count: (devices.get(key)?.count ?? 0) + 1 })
  }

  return {
    from,
    to,
    taxRate,
    purchaseTaxRate: purchaseRate,
    gst: { ...gst, net: gst.collected - gst.paid },
    monthly,
    repairs: {
      count: repairs.length,
      completed: done.length,
      avgTurnaroundDays: turnaround === null ? null : Math.round(turnaround * 10) / 10,
      avgValueCents: priced.length ? Math.round(priced.reduce((s, r) => s + (r.price_cents ?? 0), 0) / priced.length) : null,
      topDevices: [...devices.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5)
    }
  }
}

