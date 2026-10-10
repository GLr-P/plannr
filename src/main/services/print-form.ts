import { formatCurrency, formatTicketNumber, type Customer, type DocJSON, type Ticket } from '../../shared/api'
import { CANVAS_WIDTH, boxOf, fittedHeight, isCanvas, DEFAULT_TEXT_STYLE, type TextStyle } from '../../shared/canvas'
import { fieldText } from './doc'
import { parseNumber } from '../../shared/formula'

/*
 * "Form" printout: the ticket's form as it was designed (a canvas at its places, or a document in order), with every
 * value filled in, linked ones from the ticket and its customer. This is the shop's own copy, so nothing is left out
 * (unlike the intake slip, which goes to the customer and skips passcodes and card numbers).
 */

export interface FormPrintData {
  ticket: Ticket
  customer: Customer | null
  /** data: URL for a stored file (plannr://file/<id>), or null */
  fileData: (url: string) => string | null
  /** data: URLs of the ticket's photos */
  photos: string[]
  /** The quote/invoice lines table, already as HTML */
  linesHtml: string
  /** Price, paid and owing */
  payments: { priceCents: number | null; paidCents: number }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const lines = (s: string): string => esc(s).replace(/\n/g, '<br>')
const day = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** What a field shows on paper. */
export function printedValue(attrs: Record<string, unknown>, ticket: Ticket, customer: Customer | null): string {
  const link = String(attrs.link ?? '')
  const kind = String(attrs.kind ?? 'text')
  const linked: Record<string, string> = {
    'customer.name': customer?.name || ticket.customerName,
    'customer.phone': customer?.phone || ticket.customerPhone,
    'customer.email': customer?.email || ticket.customerEmail,
    'customer.address': customer?.address ?? '',
    'ticket.device': ticket.device,
    'ticket.issue': ticket.issue,
    'ticket.receivedOn': ticket.receivedOn ?? '',
    'ticket.pickupOn': ticket.pickupOn ?? '',
    'ticket.number': formatTicketNumber(ticket.number),
    'ticket.price': ticket.priceCents === null ? '' : formatCurrency(ticket.priceCents)
  }
  const raw = link ? (linked[link] ?? '') : String(attrs.value ?? '')
  if (kind === 'checkbox') return raw === 'true' ? '☑' : '☐'
  if (kind === 'date') return raw ? day(raw) : ''
  if (kind === 'money') {
    const n = parseNumber(raw)
    return n === null ? raw : formatCurrency(Math.round(n * 100))
  }
  return fieldText(kind, raw)
}

const textCss = (st: TextStyle): string =>
  `font-size:${st.size}px;font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? 'italic' : 'normal'};text-align:${st.align};${st.color ? `color:${st.color};` : ''}`

function fieldHtml(attrs: Record<string, unknown>, d: FormPrintData, inline = false): string {
  const label = String(attrs.label ?? '')
  const value = printedValue(attrs, d.ticket, d.customer)
  const pos = String(attrs.labelPos ?? (inline ? 'left' : 'top'))
  const isBox = attrs.kind === 'checkbox'
  const valueHtml = `<div class="fv ${attrs.kind === 'textarea' ? 'area' : ''} ${isBox ? 'tick' : ''}">${value ? lines(value) : '&nbsp;'}</div>`
  if (pos === 'hidden') return `<div class="ff">${valueHtml}</div>`
  return `<div class="ff ${pos === 'left' ? 'left' : 'top'}"><div class="fl">${esc(label)}</div>${valueHtml}</div>`
}

function partHtml(part: string, d: FormPrintData): string {
  if (part === 'photos')
    return d.photos.length ? `<div class="photos">${d.photos.map((src) => `<img src="${src}" alt="">`).join('')}</div>` : '<div class="muted">No photos</div>'
  if (part === 'lines') return d.linesHtml
  const { priceCents, paidCents } = d.payments
  const owing = priceCents ? Math.max(0, priceCents - paidCents) : 0
  return `<table class="pay"><tr><td>Price</td><td>${priceCents === null ? '—' : formatCurrency(priceCents)}</td></tr><tr><td>Paid</td><td>${formatCurrency(paidCents)}</td></tr>${owing ? `<tr><td><b>Owing</b></td><td><b>${formatCurrency(owing)}</b></td></tr>` : ''}</table>`
}

function canvasHtml(doc: DocJSON, d: FormPrintData): string {
  const items = (doc.content ?? [])
    .map((it) => {
      const b = boxOf(it)
      const a = it.attrs ?? {}
      const at = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;`
      let inner = ''
      if (it.type === 'formField') inner = fieldHtml(a, d)
      else if (it.type === 'canvasText') inner = `<div class="tx" style="${textCss({ ...DEFAULT_TEXT_STYLE, ...((a.style as Partial<TextStyle>) ?? {}) })}">${lines(String(a.text ?? ''))}</div>`
      else if (it.type === 'image') {
        const src = d.fileData(String(a.src ?? ''))
        inner = src ? `<img class="im" src="${src}" style="object-fit:${a.fit === 'cover' ? 'cover' : 'contain'}" alt="">` : ''
      } else if (it.type === 'canvasShape') {
        const border = Number(a.borderWidth ?? 2)
        inner =
          a.shape === 'line'
            ? `<div class="ln" style="border-top:${Math.max(1, border)}px solid ${esc(String(a.borderColor || '#999'))}"></div>`
            : `<div class="sh" style="background:${esc(String(a.fill || 'transparent'))};border:${border ? `${border}px solid ${esc(String(a.borderColor || '#999'))}` : 'none'};border-radius:${Number(a.radius ?? 8)}px"></div>`
      } else if (it.type === 'canvasPart') inner = partHtml(String(a.part ?? ''), d)
      return `<div class="it" style="${at}">${inner}</div>`
    })
    .join('')
  // Letter paper with 12 mm margins is about 727 px wide: the page is scaled to fit
  return `<div class="canvas" style="width:${CANVAS_WIDTH}px;height:${fittedHeight(doc)}px;zoom:${(727 / CANVAS_WIDTH).toFixed(3)}">${items}</div>`
}

/** A document form, in order: headings, text, lists, tables and its fields with their values. */
function docHtml(doc: DocJSON, d: FormPrintData): string {
  const inline = (nodes: DocJSON[] = []): string =>
    nodes
      .map((n) => {
        if (n.type === 'text') return lines(n.text ?? '')
        if (n.type === 'hardBreak') return '<br>'
        if (n.type === 'mention') return `@${esc(String(n.attrs?.label ?? ''))}`
        if (n.type === 'formField') return `<span class="ffi">${fieldHtml(n.attrs ?? {}, d, true)}</span>`
        if (n.type === 'image') {
          const src = d.fileData(String(n.attrs?.src ?? ''))
          return src ? `<img class="di" src="${src}" alt="">` : ''
        }
        return inline(n.content)
      })
      .join('')
  const block = (n: DocJSON): string => {
    const kids = (): string => (n.content ?? []).map(block).join('')
    switch (n.type) {
      case 'doc':
        return kids()
      case 'paragraph':
        return `<p>${inline(n.content) || '&nbsp;'}</p>`
      case 'heading':
        return `<h${Math.min(3, Number(n.attrs?.level ?? 2)) + 1}>${inline(n.content)}</h${Math.min(3, Number(n.attrs?.level ?? 2)) + 1}>`
      case 'bulletList':
        return `<ul>${kids()}</ul>`
      case 'orderedList':
        return `<ol>${kids()}</ol>`
      case 'listItem':
        return `<li>${kids()}</li>`
      case 'taskList':
        return `<ul class="tasks">${kids()}</ul>`
      case 'taskItem':
        return `<li>${n.attrs?.checked ? '☑' : '☐'} ${(n.content ?? []).map(block).join('')}</li>`
      case 'image':
        return inline([n])
      case 'fileAttachment':
        return `<p>📎 ${esc(String(n.attrs?.name ?? 'file'))}</p>`
      case 'horizontalRule':
        return '<hr>'
      case 'table':
        return `<table class="dt">${kids()}</table>`
      case 'tableRow':
        return `<tr>${kids()}</tr>`
      case 'tableHeader':
        return `<th>${kids()}</th>`
      case 'tableCell':
        return `<td>${kids()}</td>`
      default:
        return kids() // callouts, toggles, quotes: their contents
    }
  }
  return `<div class="docform">${block(doc)}</div>`
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 "Segoe UI", system-ui, sans-serif; color: #111; }
  .head { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 6px; margin-bottom: 10px; }
  .head b { color: #111; font-size: 14px; }
  .canvas { position: relative; }
  .it { position: absolute; overflow: hidden; display: flex; flex-direction: column; }
  .it > * { flex: 1; min-height: 0; }
  .ff { display: flex; flex-direction: column; gap: 2px; height: 100%; }
  .ff.left { flex-direction: row; align-items: center; gap: 10px; }
  .fl { font-size: 11.5px; font-weight: 600; color: #444; flex-shrink: 0; }
  .ff.left .fl { max-width: 45%; }
  .fv { flex: 1; min-height: 22px; border: 1px solid #9a9a9a; border-radius: 4px; padding: 3px 7px; white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; }
  .fv.tick { flex: 0 0 auto; border: 0; padding: 0; font-size: 18px; line-height: 1; }
  .tx { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.3; }
  .im { width: 100%; height: 100%; display: block; }
  .sh { width: 100%; height: 100%; }
  .ln { align-self: center; width: 100%; flex: 0 0 auto; margin: auto 0; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start; }
  .photos img { height: 90px; border-radius: 4px; }
  table.pay td { padding: 2px 10px 2px 0; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.lines td { padding: 3px 4px; border-bottom: 1px solid #ddd; }
  .muted { color: #666; }
  .docform p { margin: 4px 0; }
  .docform h2, .docform h3, .docform h4 { margin: 12px 0 4px; }
  .docform .ffi { display: block; margin: 4px 0; }
  .docform .ffi .ff { height: auto; }
  .docform .di { max-width: 100%; max-height: 240px; }
  .docform ul.tasks { list-style: none; padding-left: 4px; }
  table.dt { border-collapse: collapse; width: 100%; } table.dt td, table.dt th { border: 1px solid #bbb; padding: 3px 6px; text-align: left; }
`

export function formHtml(d: FormPrintData): string {
  const t = d.ticket
  const title = [formatTicketNumber(t.number), t.device].filter(Boolean).join(' · ')
  const printed = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
  const body = t.content ? (isCanvas(t.content) ? canvasHtml(t.content, d) : docHtml(t.content, d)) : '<p class="muted">This ticket has no form.</p>'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page { size: letter; margin: 12mm; }${STYLE}</style></head><body>
    <div class="head"><b>${esc(title)}</b><span>${esc(printed)}</span></div>
    ${body}
  </body></html>`
}
