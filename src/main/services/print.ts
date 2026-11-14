import { formatCurrency, formatTicketNumber, ticketLayout, lineTotal, ticketTotals, type LineItem, type BusinessInfo, type Customer, type DocJSON, type PrintKind, type Ticket, type Transaction } from '../../shared/api'
import { splitTax } from './quickbooks'
import type { Db } from '../db'
import { getSetting } from './settings'
import { readFileSync } from 'node:fs'
import { resolveFilePath } from './files'
import { getCustomer } from './customers'
import { listTransactions } from './money'
import { getTicket } from './tickets'
import { listItems } from './items'
import { fieldText } from './doc'
import { formHtml, PAGE_RULE } from './print-form'
import { listPhotos } from './photos'

/*
 * Printouts for a ticket: an intake slip (customer copy at drop-off), a receipt (after payment) and a small
 * device label. Pure HTML builders, so they're unit-tested; main/print-window.ts sends them to the printer.
 */

export const DEFAULT_BUSINESS: BusinessInfo = {
  name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  taxName: 'Tax',
  taxRate: 0,
  taxNumber: '',
  intakeTerms: '',
  receiptNote: 'Thank you for your business!',
  pricesIncludeTax: false,
  logoFileId: null,
  labelSize: '62x29mm',
  invoiceDueDays: 0,
  paymentInstructions: '',
  invoiceNote: '',
  invoiceColor: '#2e7d32'
}

export const getBusiness = (db: Db): BusinessInfo => ({ ...DEFAULT_BUSINESS, ...((getSetting(db, 'business') as Partial<BusinessInfo> | null) ?? {}) })

function logoDataUrl(db: Db, dataDir: string, id: string | null): string | null {
  const file = id ? resolveFilePath(db, dataDir, id) : null
  if (!file) return null
  try {
    return `data:${file.mime};base64,${readFileSync(file.path).toString('base64')}`
  } catch {
    return null
  }
}

/** The printable page (intake sheet, receipt or label) for a ticket. */
export function ticketPrintHtml(db: Db, dataDir: string, id: string, kind: PrintKind): string {
  const ticket = getTicket(db, id)
  if (!ticket) throw new Error('Ticket not found')
  const business = getBusiness(db)
  const data: PrintData = {
    ticket,
    customer: ticket.customerId ? getCustomer(db, ticket.customerId) : null,
    payments: listTransactions(db, { ticketId: id, type: 'income' }).reverse(), // oldest first
    business,
    logo: logoDataUrl(db, dataDir, business.logoFileId),
    items: listItems(db, id)
  }
  if (kind !== 'form') return printHtml(kind, data)
  // The form as designed: its pictures and the ticket's photos go in the page itself
  return formHtml({
    ticket,
    customer: data.customer,
    business,
    logo: data.logo,
    fileData: (url) => logoDataUrl(db, dataDir, /^plannr:\/\/file\/([0-9a-f-]{36})$/.exec(url)?.[1] ?? null),
    photos: listPhotos(db, id)
      .map((p) => logoDataUrl(db, dataDir, p.fileId))
      .filter((u): u is string => Boolean(u)),
    linesHtml: (data.items ?? []).length ? linesTable(data).html : '<div class="muted">No lines</div>',
    payments: { priceCents: ticket.priceCents, paidCents: ticket.paidCents }
  })
}

export interface PrintData {
  ticket: Ticket
  customer: Customer | null
  payments: Transaction[]
  business: BusinessInfo
  /** data: URL of the logo, if any */
  logo: string | null
  /** Quote/invoice lines (empty when the ticket just has a price) */
  items?: LineItem[]
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const lines = (s: string): string => esc(s).replace(/\n/g, '<br>')
const money = formatCurrency
const day = (iso: string | null): string => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Fill-in fields of the ticket (label → value), skipping empty ones and anything that looks like a passcode. */
export function ticketFields(doc: DocJSON | null): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const walk = (n: DocJSON): void => {
    if (n.type === 'formField') {
      const a = (n.attrs ?? {}) as { label?: string; value?: string; kind?: string; link?: string }
      const label = (a.label ?? '').trim()
      let value = fieldText(a.kind ?? '', (a.value ?? '').trim()).trim()
      if (a.kind === 'checkbox' && value === 'No') value = ''
      // Linked fields (customer name, pickup date…) are printed from the ticket itself, in the header
      if (label && value && !a.link && !/pass|pin\b|code|password|pattern|card\s*(num|no\b|#)|credit|cvv|cvc|expir/i.test(label)) out.push({ label, value })
    }
    for (const c of n.content ?? []) walk(c)
  }
  if (doc) walk(doc)
  return out
}

function header(b: BusinessInfo, logo: string | null): string {
  const contact = [b.phone, b.email, b.website].filter(Boolean).map(esc).join(' · ')
  return `<header>
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <div>
      <div class="biz">${esc(b.name || 'Your business')}</div>
      ${b.address ? `<div class="muted">${lines(b.address)}</div>` : ''}
      ${contact ? `<div class="muted">${contact}</div>` : ''}
    </div>
  </header>`
}

function customerBlock(t: Ticket, c: Customer | null): string {
  const name = c?.name || t.customerName
  if (!name) return ''
  const rows = [c?.phone || t.customerPhone, c?.email || t.customerEmail, c?.address].filter(Boolean).map((v) => `<div>${lines(v!)}</div>`)
  return `<section><h3>Customer</h3><div class="strong">${esc(name)}</div>${rows.join('')}</section>`
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font: 12.5px/1.45 "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; }
  .sheet { max-width: 720px; margin: 0 auto; padding: 28px 32px; }
  header { display: flex; gap: 16px; align-items: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .logo { max-height: 64px; max-width: 160px; object-fit: contain; }
  .biz { font-size: 20px; font-weight: 700; }
  .muted { color: #555; }
  .strong { font-weight: 600; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #555; margin: 0 0 4px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; margin: 14px 0; }
  section { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  td { padding: 5px 0; vertical-align: top; border-bottom: 1px solid #ddd; }
  td.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; border-bottom: 2px solid #111; font-size: 14px; }
  .fields td:first-child { color: #555; width: 38%; padding-right: 12px; }
  .terms { margin-top: 18px; font-size: 11px; color: #444; white-space: pre-line; }
  .sign { display: flex; gap: 32px; margin-top: 36px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; color: #555; }
  .foot { margin-top: 22px; text-align: center; color: #555; }
  table.lines tr.head td { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 2px solid #111; }
  table.lines td.num { width: 90px; }
`

export function intakeHtml({ ticket: t, customer, business: b, logo }: PrintData): string {
  const fields = ticketFields(t.content)
  const l = t.layout ?? ticketLayout(null)
  const job = [
    [l.titleLabel, t.device],
    [l.summaryLabel, l.showSummary ? t.issue : ''],
    [l.receivedLabel, l.showReceived ? day(t.receivedOn) : ''],
    [l.pickupLabel, l.showPickup ? day(t.pickupOn) : ''],
    ['Estimate', l.showPrice && t.priceCents ? money(t.priceCents) : '']
  ].filter(([, v]) => v)
  return page(
    `Ticket ${formatTicketNumber(t.number)}`,
    `${header(b, logo)}
    <h1>Ticket ${formatTicketNumber(t.number)}</h1>
    <div class="muted">Please keep this slip. Bring it or quote the ticket number when you come back.</div>
    <div class="cols">
      ${customerBlock(t, customer)}
      <section><h3>Details</h3><table class="fields">${job.map(([k, v]) => `<tr><td>${k}</td><td>${lines(v!)}</td></tr>`).join('')}</table></section>
    </div>
    ${fields.length ? `<section><h3>Details</h3><table class="fields">${fields.map((f) => `<tr><td>${esc(f.label)}</td><td>${lines(f.value)}</td></tr>`).join('')}</table></section>` : ''}
    ${b.intakeTerms ? `<div class="terms">${esc(b.intakeTerms)}</div>` : ''}
    <div class="sign"><div>Customer signature</div><div>Date</div></div>`
  )
}

/** Totals for a receipt: what was paid, split into before-tax and tax (prices include tax; "no tax" payments have none). */
export function receiptTotals(payments: Transaction[], taxRate: number): { subtotal: number; tax: number; total: number } {
  let tax = 0
  let total = 0
  for (const p of payments) {
    total += p.amountCents
    if (!p.taxExempt) tax += splitTax(p.amountCents, taxRate).tax
  }
  return { subtotal: total - tax, tax, total }
}

export function receiptHtml({ ticket: t, customer, payments, business: b, logo }: PrintData): string {
  const { subtotal, tax, total } = receiptTotals(payments, b.taxRate)
  const owing = t.priceCents ? Math.max(0, t.priceCents - total) : 0
  const what = [t.device, t.issue].filter(Boolean).join(' — ') || `Ticket ${formatTicketNumber(t.number)}`
  const taxLabel = `${esc(b.taxName || 'Tax')}${b.taxRate ? ` (${b.taxRate}%)` : ''}`
  return page(
    `Receipt ${formatTicketNumber(t.number)}`,
    `${header(b, logo)}
    <h1>Receipt</h1>
    <div class="muted">Ticket ${formatTicketNumber(t.number)} · ${esc(day(payments[payments.length - 1]?.date ?? t.receivedOn) || '')}</div>
    <div class="cols">${customerBlock(t, customer)}</div>
    <table>
      <tr><td>${lines(what)}</td><td class="num">${money(subtotal)}</td></tr>
      ${tax ? `<tr><td>${taxLabel}${b.taxNumber ? ` <span class="muted">· #${esc(b.taxNumber)}</span>` : ''}</td><td class="num">${money(tax)}</td></tr>` : ''}
      <tr class="total"><td>Total paid</td><td class="num">${money(total)}</td></tr>
    </table>
    ${payments.length ? `<section><h3>Payments</h3><table>${payments.map((p) => `<tr><td>${esc(day(p.date))} · ${esc(p.method || 'Payment')}${p.taxExempt ? ' · no tax' : ''}</td><td class="num">${money(p.amountCents)}</td></tr>`).join('')}</table></section>` : '<div class="muted">No payments recorded yet.</div>'}
    ${owing ? `<p class="strong">Balance owing: ${money(owing)}</p>` : ''}
    ${b.receiptNote ? `<div class="foot">${lines(b.receiptNote)}</div>` : ''}`
  )
}

export const LABEL_SIZES: Record<BusinessInfo['labelSize'], { css: string; name: string }> = {
  '62x29mm': { css: '62mm 29mm', name: 'Brother 62 × 29 mm' },
  '2.25x1.25in': { css: '2.25in 1.25in', name: 'Dymo 2¼ × 1¼ in' },
  '4x6in': { css: '4in 6in', name: 'Shipping label 4 × 6 in' }
}

export function labelHtml({ ticket: t, customer, business: b }: PrintData): string {
  const size = LABEL_SIZES[b.labelSize] ?? LABEL_SIZES['62x29mm']
  const name = customer?.name || t.customerName
  const phone = customer?.phone || t.customerPhone
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label ${formatTicketNumber(t.number)}</title><style>
    @page { size: ${size.css}; margin: 1.5mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 9pt/1.2 "Segoe UI", system-ui, sans-serif; color: #000; }
    .no { font-size: 15pt; font-weight: 800; letter-spacing: .02em; }
    .row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body>
    <div class="no">${formatTicketNumber(t.number)}</div>
    ${name ? `<div class="row"><b>${esc(name)}</b>${phone ? ` · ${esc(phone)}` : ''}</div>` : ''}
    ${t.device ? `<div class="row">${esc(t.device)}</div>` : ''}
    <div class="row">In ${esc(day(t.receivedOn))}</div>
  </body></html>`
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAGE_RULE}${STYLE}</style></head><body><div class="sheet">${body}</div></body></html>`
}

const KIND_LABEL: Record<LineItem['kind'], string> = { part: 'Part', labour: 'Labour', other: '', discount: 'Discount' }

/** The lines table and totals shared by quotes and invoices. */
function linesTable(d: PrintData): { html: string; total: number } {
  const b = d.business
  const items = d.items ?? []
  const totals = ticketTotals(items, { taxRate: b.taxRate, pricesIncludeTax: b.pricesIncludeTax, exempt: d.ticket.taxExempt })
  const rows = items.length
    ? items
        .map((l) => {
          const what = [KIND_LABEL[l.kind], l.description].filter(Boolean).join(': ') || 'Item'
          const amount = l.kind === 'discount' ? `−${money(lineTotal(l))}` : money(lineTotal(l))
          return `<tr><td>${esc(what)}</td><td class="num">${l.kind === 'discount' ? '' : l.qty}</td><td class="num">${l.kind === 'discount' ? '' : money(l.unitCents)}</td><td class="num">${amount}</td></tr>`
        })
        .join('')
    : `<tr><td>${lines([d.ticket.device, d.ticket.issue].filter(Boolean).join(' — ') || `Ticket ${formatTicketNumber(d.ticket.number)}`)}</td><td></td><td></td><td class="num">${money(d.ticket.priceCents ?? 0)}</td></tr>`
  const total = items.length ? totals.total : (d.ticket.priceCents ?? 0)
  const taxLabel = `${esc(b.taxName || 'Tax')}${b.taxRate && !d.ticket.taxExempt ? ` (${b.taxRate}%${b.pricesIncludeTax ? ', included' : ''})` : ''}`
  const sums = items.length
    ? [
        totals.discount ? `<tr><td colspan="3">Subtotal</td><td class="num">${money(totals.subtotal)}</td></tr>` : '',
        totals.discount ? `<tr><td colspan="3">Discount</td><td class="num">−${money(totals.discount)}</td></tr>` : '',
        totals.tax ? `<tr><td colspan="3">${taxLabel}${b.taxNumber ? ` <span class="muted">· #${esc(b.taxNumber)}</span>` : ''}</td><td class="num">${money(totals.tax)}</td></tr>` : '',
        d.ticket.taxExempt ? '<tr><td colspan="3" class="muted">No tax</td><td></td></tr>' : ''
      ].join('')
    : ''
  return {
    total,
    html: `<table class="lines"><tr class="head"><td>Description</td><td class="num">Qty</td><td class="num">Price</td><td class="num">Amount</td></tr>${rows}${sums}<tr class="total"><td colspan="3">Total</td><td class="num">${money(total)}</td></tr></table>`
  }
}

export function quoteHtml(d: PrintData): string {
  const t = d.ticket
  const { html } = linesTable(d)
  return page(
    `Quote ${formatTicketNumber(t.number)}`,
    `${header(d.business, d.logo)}
    <h1>Quote</h1>
    <div class="muted">Ticket ${formatTicketNumber(t.number)} · ${esc(day(new Date().toISOString().slice(0, 10)))}${t.device ? ` · ${esc(t.device)}` : ''}</div>
    <div class="cols">${customerBlock(t, d.customer)}</div>
    ${html}
    <p class="muted">This is an estimate. The final price may change if we find something else; we’ll ask you first.</p>
    <div class="sign"><div>Approved by (customer)</div><div>Date</div></div>`
  )
}

/** Today on this PC's clock, YYYY-MM-DD (not UTC, which is already tomorrow on a Pacific evening). */
const localToday = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(y, m - 1, d + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export const DEFAULT_INVOICE_COLOR = '#2e7d32'
const safeColor = (c: string | undefined): string => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_INVOICE_COLOR)
export const invoiceTerms = (days: number): string => (days > 0 ? `Net ${days}` : 'Due on receipt')

const INVOICE_STYLE = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 12px/1.5 "Segoe UI", system-ui, sans-serif; color: #333; margin: 0; }
  .inv { max-width: 760px; margin: 0 auto; }
  .inv-top { display: flex; align-items: flex-start; gap: 32px; padding: 8px 4px 20px; }
  .inv-title { color: var(--accent); font-size: 21px; font-weight: 700; letter-spacing: .08em; margin: 0 0 4px; }
  .inv-from { font-size: 11.5px; line-height: 1.55; }
  .inv-from b { color: #222; }
  .inv-contact { font-size: 11.5px; line-height: 1.55; padding-top: 34px; }
  .inv-logo { margin-left: auto; max-height: 110px; max-width: 200px; object-fit: contain; }
  .inv-band { background: var(--tint); padding: 20px 4px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .inv-band h4 { font-size: 11px; color: #333; margin: 0 0 4px; font-weight: 700; }
  .inv-band .big { font-size: 13px; line-height: 1.6; }
  .inv-details { border-left: 1px dashed #c8d0c8; padding-left: 24px; }
  table.inv-lines { width: 100%; border-collapse: collapse; margin-top: 22px; }
  .inv-lines th { font-weight: 400; font-size: 12.5px; color: #222; text-align: left; padding: 8px 6px; border-bottom: 1px solid #ccc; }
  .inv-lines td { padding: 12px 6px; vertical-align: top; border-bottom: 1px solid #ddd; }
  .inv-lines .n { width: 26px; color: #555; }
  .inv-lines .r { text-align: right; white-space: nowrap; }
  .inv-lines .what { font-weight: 600; color: #333; }
  .inv-foot { display: grid; grid-template-columns: 1fr 300px; gap: 40px; margin-top: 4px; }
  .inv-notes { padding: 24px 0 0 32px; font-size: 11.5px; line-height: 1.55; }
  .inv-notes h5 { font-size: 16px; font-weight: 400; color: #333; margin: 18px 0 6px; }
  .inv-notes p { margin: 0; white-space: pre-line; }
  table.inv-sums { width: 100%; border-collapse: collapse; }
  .inv-sums td { padding: 9px 6px; }
  .inv-sums td.r { text-align: right; white-space: nowrap; }
  .inv-sums tr.total td { border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 12px 6px; font-weight: 700; }
  .inv-sums tr.total td.r { font-size: 18px; }
  .inv-sums tr.due td { font-weight: 700; }
  .muted { color: #666; }
  section, tr { break-inside: avoid; }
`

/** A QuickBooks-style invoice: title and business on top, a tinted "Bill to / Invoice details" band, numbered lines with a tax column, notes on the left and totals on the right. */
export function invoiceHtml(d: PrintData, today = localToday()): string {
  const t = d.ticket
  const b = d.business
  const c = d.customer
  const items = d.items ?? []
  const totals = ticketTotals(items, { taxRate: b.taxRate, pricesIncludeTax: b.pricesIncludeTax, exempt: t.taxExempt })
  const taxed = !t.taxExempt && b.taxRate > 0
  const taxName = esc(b.taxName || 'Tax')
  const jobName = [t.device, t.issue].filter(Boolean).join(' — ')
  const rows = items.length
    ? items.map((l, i) => {
        const discount = l.kind === 'discount'
        const what = discount ? `Discount${l.description ? `: ${l.description}` : ''}` : l.description || KIND_LABEL[l.kind] || 'Item'
        return `<tr><td class="n">${i + 1}.</td><td class="what">${esc(what)}</td><td class="r">${discount ? '' : l.qty}</td><td class="r">${discount ? '' : money(l.unitCents)}</td><td class="r">${discount ? '−' : ''}${money(lineTotal(l))}</td><td class="r">${taxed && !discount ? taxName : ''}</td></tr>`
      })
    : [`<tr><td class="n">1.</td><td class="what">${lines(jobName || `Ticket ${formatTicketNumber(t.number)}`)}</td><td class="r">1</td><td class="r">${money(t.priceCents ?? 0)}</td><td class="r">${money(t.priceCents ?? 0)}</td><td class="r"></td></tr>`]
  const total = items.length ? totals.total : (t.priceCents ?? 0)
  const net = Math.max(0, totals.subtotal - totals.discount)
  const sums = items.length
    ? [
        `<tr><td>Subtotal</td><td class="r">${money(totals.subtotal)}</td></tr>`,
        totals.discount ? `<tr><td>Discount</td><td class="r">−${money(totals.discount)}</td></tr>` : '',
        totals.tax ? `<tr><td>${taxName} @ ${b.taxRate}% ${b.pricesIncludeTax ? `(included)` : `on ${money(net)}`}</td><td class="r">${money(totals.tax)}</td></tr>` : '',
        t.taxExempt ? '<tr><td class="muted">No tax</td><td></td></tr>' : ''
      ].join('')
    : ''
  const paid = d.payments.reduce((s, p) => s + p.amountCents, 0)
  const owing = Math.max(0, total - paid)
  const payments = d.payments.map((p) => `<tr><td class="muted">Paid ${esc(day(p.date))}${p.method ? ` · ${esc(p.method)}` : ''}</td><td class="r muted">−${money(p.amountCents)}</td></tr>`).join('')
  const due = d.payments.length ? `<tr class="due"><td>${owing ? 'Balance due' : 'Paid in full'}</td><td class="r">${money(owing)}</td></tr>` : ''
  const days = Math.max(0, Math.round(Number(b.invoiceDueDays) || 0))
  const note = b.invoiceNote || b.receiptNote
  const contact = [b.email, b.phone, b.website].filter(Boolean).map((v) => `<div>${esc(v)}</div>`).join('')
  const billTo = c?.name || t.customerName
  const billRows = [c?.address, c?.phone || t.customerPhone, c?.email || t.customerEmail].filter(Boolean).map((v) => `<div>${lines(v!)}</div>`).join('')
  const color = safeColor(b.invoiceColor)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(formatTicketNumber(t.number))}</title><style>${PAGE_RULE}${INVOICE_STYLE}
    :root { --accent: ${color}; --tint: color-mix(in srgb, ${color} 9%, white); }</style></head><body><div class="inv">
    <div class="inv-top">
      <div class="inv-from">
        <div class="inv-title">INVOICE</div>
        <b>${esc(b.name || 'Your business')}</b>
        ${b.address ? `<div>${lines(b.address)}</div>` : ''}
        ${b.taxNumber ? `<div>${taxName} Registration No.</div><div>${esc(b.taxNumber)}</div>` : ''}
      </div>
      ${contact ? `<div class="inv-contact">${contact}</div>` : ''}
      ${d.logo ? `<img class="inv-logo" src="${d.logo}" alt="">` : ''}
    </div>
    <section class="inv-band">
      <div>
        <h4>Bill to</h4>
        <div class="big">${billTo ? `<div>${esc(billTo)}</div>${billRows}` : '<div class="muted">—</div>'}</div>
      </div>
      <div class="inv-details">
        <h4>Invoice details</h4>
        <div class="big">
          <div>Invoice no.: ${esc(formatTicketNumber(t.number))}</div>
          <div>Terms: ${esc(invoiceTerms(days))}</div>
          <div>Invoice date: ${esc(day(today))}</div>
          <div>Due date: ${esc(day(addDays(today, days)))}</div>
          ${jobName && items.length ? `<div>For: ${esc(jobName)}</div>` : ''}
        </div>
      </div>
    </section>
    <table class="inv-lines">
      <thead><tr><th class="n">#</th><th>Product or service</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th><th class="r">Tax</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="inv-foot">
      <div class="inv-notes">
        ${b.paymentInstructions ? `<p>${esc(b.paymentInstructions)}</p>` : ''}
        ${note ? `<h5>Note to customer</h5><p>${esc(note)}</p>` : ''}
      </div>
      <table class="inv-sums">
        ${sums}
        <tr class="total"><td>Total</td><td class="r">${money(total)}</td></tr>
        ${payments}${due}
      </table>
    </div>
  </div></body></html>`
}

export function printHtml(kind: PrintKind, data: PrintData): string {
  switch (kind) {
    case 'intake':
      return intakeHtml(data)
    case 'receipt':
      return receiptHtml(data)
    case 'quote':
      return quoteHtml(data)
    case 'invoice':
      return invoiceHtml(data)
    default:
      return labelHtml(data)
  }
}
