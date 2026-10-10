import { formatCurrency, formatTicketNumber, type BusinessInfo, type Customer, type DocJSON, type Ticket } from '../../shared/api'
import { CANVAS_WIDTH, boxOf, fittedHeight, isCanvas, DEFAULT_TEXT_STYLE, type TextStyle } from '../../shared/canvas'
import { fieldText } from './doc'
import { collectFields, evaluateFormula, formatCalc, parseNumber, type FormValue } from '../../shared/formula'

/*
 * "Form" printout: the ticket's form as it was designed (a canvas at its places, or a document in order), with every
 * value filled in, linked ones from the ticket and its customer. This is the shop's own copy, so nothing is left out
 * (unlike the intake slip, which goes to the customer and skips passcodes and card numbers).
 */

export interface FormPrintData {
  ticket: Ticket
  customer: Customer | null
  /** Shown at the top, like the other printouts */
  business?: BusinessInfo
  /** data: URL of the logo, if any */
  logo?: string | null
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

function linkedValues(ticket: Ticket, customer: Customer | null): Record<string, string> {
  return {
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
}

/** What a field shows on paper. `fields` lets calculated fields be worked out again at print time. */
export function printedValue(attrs: Record<string, unknown>, ticket: Ticket, customer: Customer | null, fields?: FormValue[]): string {
  const link = String(attrs.link ?? '')
  const kind = String(attrs.kind ?? 'text')
  if (kind === 'calc' && typeof attrs.formula === 'string' && attrs.formula && fields) {
    const v = evaluateFormula(attrs.formula, fields)
    if (v !== null) return formatCalc(v, String(attrs.format || 'money'), formatCurrency)
  }
  const raw = link ? (linkedValues(ticket, customer)[link] ?? '') : String(attrs.value ?? '')
  if (kind === 'checkbox') return raw === 'true' ? '☑' : '☐'
  if (kind === 'date') return raw ? day(raw) : ''
  if (kind === 'money') {
    const n = parseNumber(raw)
    return n === null ? raw : formatCurrency(Math.round(n * 100))
  }
  return fieldText(kind, raw)
}

const fieldCache = new WeakMap<FormPrintData, FormValue[]>()
function fieldsOf(d: FormPrintData): FormValue[] {
  let f = fieldCache.get(d)
  if (!f) {
    const linked = linkedValues(d.ticket, d.customer)
    f = collectFields(d.ticket.content, (link) => linked[link])
    fieldCache.set(d, f)
  }
  return f
}

const textCss = (st: TextStyle): string =>
  `font-size:${st.size}px;font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? 'italic' : 'normal'};text-align:${st.align};${st.color ? `color:${st.color};` : ''}`

/**
 * The biggest label size (px) that fits on one line in the space it has, between 10 and 18. Text width is estimated
 * from the number of characters (Segoe UI averages a little over half its size per character), since the print
 * window runs no scripts to measure it; the label never wraps either way.
 */
export function labelSize(label: string, width: number, height: number): number {
  const byWidth = width / (Math.max(1, label.length) * 0.58)
  const byHeight = height / 1.2
  return Math.round(Math.max(10, Math.min(18, byWidth, byHeight)) * 2) / 2
}

/** The printout's look (from the ticket's template) */
const printStyleOf = (d: FormPrintData): string => {
  const s = d.ticket.layout?.printStyle
  return s === 'boxes' || s === 'lines' || s === 'clean' || s === 'elegant' ? s : 'modern'
}
const accentOf = (d: FormPrintData): string => (/^#[0-9a-f]{6}$/i.test(d.ticket.layout?.printAccent ?? '') ? d.ticket.layout.printAccent : '#000000')
/** Clean keeps labels small (the values carry the page); the others grow them to fill the space */
const LABEL_MAX: Record<string, number> = { modern: 11.5, boxes: 18, lines: 16, clean: 11, elegant: 16 }

function fieldHtml(attrs: Record<string, unknown>, d: FormPrintData, inline = false, box?: { w: number; h: number }): string {
  const label = String(attrs.label ?? '')
  const value = printedValue(attrs, d.ticket, d.customer, fieldsOf(d))
  const pos = String(attrs.labelPos ?? (inline ? 'left' : 'top'))
  const isBox = attrs.kind === 'checkbox'
  const linesMode = attrs.printLines === 'last' || attrs.printLines === 'none' ? attrs.printLines : attrs.noLines === true ? 'none' : ''
  const valueStyle = Number(attrs.valueSize) > 0 ? ` style="font-size:${Number(attrs.valueSize)}px"` : ''
  const valueHtml = `<div${valueStyle} class="fv ${attrs.kind === 'textarea' ? 'area' : ''} ${isBox ? 'tick' : ''} ${attrs.kind === 'calc' ? 'calc' : ''} ${linesMode === 'none' ? 'bare' : linesMode === 'last' ? 'last' : ''}">${value ? lines(value) : '&nbsp;'}</div>`
  const styles = [attrs.labelBold === false ? 'lb0' : '', attrs.labelItalic === true ? 'li' : '', attrs.valueBold === true ? 'vb' : '', attrs.valueItalic === true ? 'vi' : ''].filter(Boolean).join(' ')
  if (pos === 'hidden') return `<div class="ff ${styles}">${valueHtml}</div>`
  // Room for the label: beside the box it gets up to 45% of the width; above it, what the box leaves over
  const max = LABEL_MAX[printStyleOf(d)]
  const fit = box ? (pos === 'left' ? labelSize(label, box.w * 0.45 - 10, box.h) : labelSize(label, box.w, isBox ? box.h - 22 : box.h - 32)) : 13
  const size = Number(attrs.labelSize) > 0 ? Number(attrs.labelSize) : Math.min(fit, max)
  return `<div class="ff ${pos === 'left' ? 'left' : 'top'} ${styles}"><div class="fl" style="font-size:${size}px">${esc(label)}</div>${valueHtml}</div>`
}

function partHtml(part: string, d: FormPrintData): string {
  if (part === 'photos')
    return d.photos.length ? `<div class="photos">${d.photos.map((src) => `<img src="${src}" alt="">`).join('')}</div>` : '<div class="muted">No photos</div>'
  if (part === 'lines') return d.linesHtml
  const { priceCents, paidCents } = d.payments
  const owing = priceCents ? Math.max(0, priceCents - paidCents) : 0
  return `<table class="pay"><tr><td>Price</td><td>${priceCents === null ? '—' : formatCurrency(priceCents)}</td></tr><tr><td>Paid</td><td>${formatCurrency(paidCents)}</td></tr>${owing ? `<tr><td><b>Owing</b></td><td><b>${formatCurrency(owing)}</b></td></tr>` : ''}</table>`
}

/** Letter paper with 12 mm margins is about 727 px wide; the canvas is laid out at that size. */
const PRINT_WIDTH = 727
/** ...and about 965 px tall; a little is kept spare so rounding never spills onto a blank second page */
const PRINT_HEIGHT = 945
/** The printed date above the form */
const DATE_HEIGHT = 26

/** How much a canvas form is shrunk to fit on one sheet (1 = it already fits) */
export function fitScale(doc: DocJSON): number {
  const tall = fittedHeight(doc) * (PRINT_WIDTH / CANVAS_WIDTH) + DATE_HEIGHT
  return tall > PRINT_HEIGHT ? Math.floor((PRINT_HEIGHT / tall) * 1000) / 1000 : 1
}

function canvasHtml(doc: DocJSON, d: FormPrintData): string {
  const k = PRINT_WIDTH / CANVAS_WIDTH
  const px = (n: number): string => `${Math.round(n * k * 10) / 10}px`
  const items = (doc.content ?? [])
    .map((it) => {
      const b = boxOf(it)
      const a = it.attrs ?? {}
      const at = `left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};`
      let inner = ''
      if (it.type === 'formField') inner = fieldHtml(a, d, false, { w: b.w * k, h: b.h * k })
      else if (it.type === 'canvasText') {
        const st = { ...DEFAULT_TEXT_STYLE, ...((a.style as Partial<TextStyle>) ?? {}) }
        inner = `<div class="tx" style="${textCss({ ...st, size: Math.round(st.size * k * 10) / 10, color: st.color || '#000' })}">${lines(String(a.text ?? ''))}</div>`
      } else if (it.type === 'image') {
        const src = d.fileData(String(a.src ?? ''))
        inner = src ? `<img class="im" src="${src}" style="object-fit:${a.fit === 'cover' ? 'cover' : 'contain'}" alt="">` : ''
      } else if (it.type === 'canvasShape') {
        const border = Number(a.borderWidth ?? 2)
        const color = esc(String(a.borderColor || '#222'))
        inner =
          a.shape === 'line'
            ? `<div class="ln" style="border-top:${Math.max(1, border)}px solid ${color}"></div>`
            : `<div class="sh" style="background:${esc(String(a.fill || 'transparent'))};border:${border ? `${border}px solid ${color}` : 'none'};border-radius:${Number(a.radius ?? 8)}px"></div>`
      } else if (it.type === 'canvasPart') inner = partHtml(String(a.part ?? ''), d)
      return `<div class="it it-${it.type}" style="${at}">${inner}</div>`
    })
    .join('')
  return `<div class="canvas" style="width:${PRINT_WIDTH}px;height:${px(fittedHeight(doc))}">${items}</div>`
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
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* A field set to print without a line or box (any style) */
  .fv.bare { border: 0 !important; background: none !important; padding-left: 0 !important; }
  /* A field set to have one line, right under the last line of writing (any style) */
  .fv.last { flex: 0 0 auto !important; border: 0 !important; border-bottom: 1.25px solid #000 !important; border-radius: 0 !important; background: none !important; padding: 2px 1px 3px !important; line-height: 1.35 !important; }
  /* Text styles chosen per field */
  .ff.lb0 .fl { font-weight: 400 !important; }
  .ff.li .fl { font-style: italic; }
  .ff.vb .fv { font-weight: 700; }
  .ff.vi .fv { font-style: italic; }
  /*
   * Modern (the default): small coloured capitals for labels; answers written larger on a crisp underline, long ones
   * on ruled lines; the total as a colour badge. Solid black lines of at least 1px and no grey tints, so it prints
   * sharply on ordinary inkjets.
   */
  .s-modern .fl { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: var(--accent); }
  .s-modern .ff { gap: 4px; }
  .s-modern .fv { flex: 0 0 auto; border: 0; border-bottom: 1.25px solid #000; border-radius: 0; padding: 2px 1px 3px; background: none; font-size: 15px; }
  .s-modern .fv.area { flex: 1; border: 0; line-height: 27px; padding: 0 1px; background: repeating-linear-gradient(to bottom, transparent 0 24.5px, #000 24.5px 25.75px, transparent 25.75px 27px); }
  .s-modern .fv.calc { align-self: flex-start; border: 0; background: var(--accent); color: #fff; padding: 4px 14px; border-radius: 4px; font-size: 17px; font-weight: 700; }
  .s-modern .fv.tick { border: 0; }
  /* Lines: like a paper order form. Values on an underline; long answers on ruled lines. */
  .s-lines .fl { color: var(--accent); }
  .s-lines .fv { border: 0; border-bottom: 1.5px solid #000; border-radius: 0; padding: 2px 2px 3px; background: none; }
  .s-lines .fv.area { border: 0; line-height: 24px; padding: 0 2px; background: repeating-linear-gradient(to bottom, transparent 0 21px, #000 21px 22px, transparent 22px 24px); }
  .s-lines .fv.calc { border-bottom: 4px double #000; }
  /* One-line answers: the underline sits right under the writing, not at the bottom of the space */
  .s-lines .fv:not(.area):not(.tick), .s-elegant .fv:not(.area):not(.tick) { flex: 0 0 auto; }
  /* Clean: small coloured capitals for labels, bigger values, a thin rule between fields, the total as a badge. */
  .s-clean .fl { text-transform: uppercase; letter-spacing: .09em; color: var(--accent); font-weight: 700; }
  .s-clean .fv { border: 0; padding: 1px 0 0; background: none; font-size: 15.5px; }
  .s-clean .it-formField { border-top: 1px solid #000; padding-top: 5px; }
  .s-clean .fv.calc { align-self: flex-start; background: var(--accent); color: #fff; padding: 4px 12px; border-radius: 4px; font-size: 17px; }
  /* Elegant: a serif face, italic coloured labels, fine dotted underlines. */
  .s-elegant body, body.s-elegant { font-family: Georgia, "Times New Roman", serif; }
  .s-elegant .fl { font-style: italic; font-weight: 400; color: var(--accent); }
  .s-elegant .fv { border: 0; border-bottom: 1px dotted #000; border-radius: 0; padding: 2px 2px 3px; background: none; font-size: 15px; }
  .s-elegant .fv.area { border: 1px solid #000; border-radius: 0; padding: 6px 8px; }
  .s-elegant .fv.calc { border-top: 1px solid #000; border-bottom: 3px double #000; font-size: 16px; }
  body { margin: 0; font: 14px/1.35 "Segoe UI", system-ui, sans-serif; color: #000; }
  .date { text-align: right; font-size: 11px; color: #000; margin-bottom: 6px; }
  .canvas { position: relative; }
  .it { position: absolute; overflow: hidden; display: flex; flex-direction: column; }
  .it > * { flex: 1; min-height: 0; }
  .ff { display: flex; flex-direction: column; gap: 3px; height: 100%; }
  .ff.left { flex-direction: row; align-items: center; gap: 10px; }
  .fl { font-weight: 600; color: #000; line-height: 1.15; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: clip; }
  .ff.left .fl { max-width: 45%; }
  .fv { flex: 1; min-height: 26px; background: #fff; border: 1px solid #000; border-radius: 3px; padding: 4px 8px; white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; }
  .fv.calc { font-weight: 700; border-width: 2px; }
  .fv.tick { flex: 0 0 auto; border: 0; padding: 0; font-size: 20px; line-height: 1; }
  .tx { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.25; }
  .im { width: 100%; height: 100%; display: block; }
  .sh { width: 100%; height: 100%; }
  .ln { align-self: center; width: 100%; flex: 0 0 auto; margin: auto 0; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start; }
  .photos img { height: 90px; border-radius: 3px; }
  table.pay td { padding: 2px 12px 2px 0; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.lines td { padding: 3px 4px; border-bottom: 1px solid #000; }
  .muted { color: #000; }
  .docform p { margin: 4px 0; }
  .docform h2, .docform h3, .docform h4 { margin: 14px 0 6px; }
  .docform .ffi { display: block; margin: 6px 0; }
  .docform .ffi .ff { height: auto; }
  .docform .di { max-width: 100%; max-height: 240px; }
  .docform ul.tasks { list-style: none; padding-left: 4px; }
  table.dt { border-collapse: collapse; width: 100%; } table.dt td, table.dt th { border: 1px solid #000; padding: 3px 6px; text-align: left; }
`

export function formHtml(d: FormPrintData): string {
  const t = d.ticket
  const title = [formatTicketNumber(t.number), t.device].filter(Boolean).join(' · ')
  const printed = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
  const body = t.content ? (isCanvas(t.content) ? canvasHtml(t.content, d) : docHtml(t.content, d)) : '<p class="muted">This ticket has no form.</p>'
  const scale = t.content && isCanvas(t.content) ? fitScale(t.content) : 1
  const zoom = scale < 1 ? `zoom:${scale};` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page { size: letter; margin: 12mm; }${STYLE}</style></head><body class="s-${printStyleOf(d)}" style="${zoom}--accent:${accentOf(d)}">
    <div class="date">${esc(printed)}</div>
    ${body}
  </body></html>`
}
