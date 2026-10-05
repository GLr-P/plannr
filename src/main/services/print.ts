import { formatTicketNumber, type BusinessInfo, type Customer, type DocJSON, type PrintKind, type Ticket, type Transaction } from '../../shared/api'
import { splitTax } from './quickbooks'

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
  logoFileId: null,
  labelSize: '62x29mm'
}

export interface PrintData {
  ticket: Ticket
  customer: Customer | null
  payments: Transaction[]
  business: BusinessInfo
  /** data: URL of the logo, if any */
  logo: string | null
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const lines = (s: string): string => esc(s).replace(/\n/g, '<br>')
const money = (cents: number): string => (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
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
      const a = (n.attrs ?? {}) as { label?: string; value?: string; kind?: string }
      const label = (a.label ?? '').trim()
      let value = (a.value ?? '').trim()
      if (a.kind === 'checkbox') value = value === 'true' ? 'Yes' : ''
      if (label && value && !/pass|pin\b|code|password|pattern/i.test(label)) out.push({ label, value })
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
`

export function intakeHtml({ ticket: t, customer, business: b, logo }: PrintData): string {
  const fields = ticketFields(t.content)
  const job = [
    ['Device', t.device],
    ['Problem', t.issue],
    ['Received', day(t.receivedOn)],
    ['Estimated pickup', day(t.pickupOn)],
    ['Estimate', t.priceCents ? money(t.priceCents) : '']
  ].filter(([, v]) => v)
  return page(
    `Ticket ${formatTicketNumber(t.number)}`,
    `${header(b, logo)}
    <h1>Repair ticket ${formatTicketNumber(t.number)}</h1>
    <div class="muted">Keep this slip and bring it when you pick up your device.</div>
    <div class="cols">
      ${customerBlock(t, customer)}
      <section><h3>Repair</h3><table class="fields">${job.map(([k, v]) => `<tr><td>${k}</td><td>${lines(v!)}</td></tr>`).join('')}</table></section>
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
  const what = [t.device, t.issue].filter(Boolean).join(' — ') || 'Repair'
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page { size: letter; margin: 12mm; }${STYLE}</style></head><body><div class="sheet">${body}</div></body></html>`
}

export function printHtml(kind: PrintKind, data: PrintData): string {
  return kind === 'intake' ? intakeHtml(data) : kind === 'receipt' ? receiptHtml(data) : labelHtml(data)
}
