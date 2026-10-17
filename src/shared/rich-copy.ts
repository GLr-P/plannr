import { formatCurrency, type DocJSON } from './api'
import { calculate, evaluateSheet, formatCell, type ColumnFormat } from './sheet'
import { formatCalc, parseNumber } from './formula'

/**
 * What other programs get when you copy from a note: HTML with the formatting written out (bold, italic, colours,
 * sizes, highlights, lists, tables) as Word, Outlook, Gmail and the like understand it, and tidy plain text (one line
 * per paragraph, bullets, ☐/☑ for tasks) for Notepad, text messages and web forms. Pure, so the phone and tests use it.
 *
 * The HTML also carries the copied piece itself (`data-plannr-copy`, the ProseMirror slice as JSON), so pasting back
 * into Plannr keeps fill-in fields, spreadsheets, drawings and @-links exactly.
 */

/** A copied piece of a document: its blocks, and how many levels are cut open at each end (ProseMirror's Slice JSON) */
export interface CopiedSlice {
  content: DocJSON[]
  openStart?: number
  openEnd?: number
}

export const COPY_ATTR = 'data-plannr-copy'

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const safeColor = (v: unknown): string => (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(str(v)) ? str(v) : '')
const safeSize = (v: unknown): string => (/^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(str(v)) ? str(v) : '')
const safeAlign = (v: unknown): string => (['left', 'center', 'right', 'justify'].includes(str(v)) ? str(v) : '')
/** Links and pictures other programs can open (plannr://file/ pictures are swapped for the real picture by the PC) */
const safeUrl = (v: unknown): string => (/^(https?:|mailto:|tel:|data:image\/|plannr:\/\/file\/|\/plannr-file\/)/i.test(str(v)) ? str(v) : '')

const CALLOUT: Record<string, [string, string]> = {
  info: ['#eff6ff', '#2563eb'],
  tip: ['#f0fdf4', '#16a34a'],
  warning: ['#fefce8', '#ca8a04'],
  danger: ['#fef2f2', '#dc2626'],
  note: ['#f5f5f4', '#a8a29e']
}

const day = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : iso
}

/** A fill-in field's answer as it reads on screen: ☑/☐, dates, money, lists */
export function fieldAnswer(attrs: Record<string, unknown>): string {
  const kind = str(attrs.kind) || 'text'
  const raw = str(attrs.value)
  if (kind === 'checkbox') return raw === 'true' ? '☑' : '☐'
  if (kind === 'date') return raw ? day(raw) : ''
  if (kind === 'money') {
    const n = parseNumber(raw)
    return n === null ? raw : formatCurrency(Math.round(n * 100))
  }
  if (kind === 'calc') {
    const n = parseNumber(raw)
    return n === null ? raw : formatCalc(n, str(attrs.format) || 'money', formatCurrency)
  }
  if (kind === 'multi') {
    try {
      const list = JSON.parse(raw) as unknown
      if (Array.isArray(list)) return list.filter((x) => typeof x === 'string').join(', ')
    } catch {
      // stored as plain text
    }
  }
  return raw
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return (raw as T) ?? fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** A spreadsheet block as rows of shown values (formulas worked out, column formats applied) */
function sheetRows(attrs: Record<string, unknown>): string[][] {
  const cells = parseJson<string[][]>(attrs.cells, [])
  const formats = parseJson<ColumnFormat[]>(attrs.formats, [])
  const header = attrs.header !== false
  const rows = evaluateSheet(cells).map((row, r) => row.map((v, c) => formatCell(v, header && r === 0 ? 'text' : (formats[c] ?? 'auto'), formatCurrency)))
  // Leave out empty rows and columns at the end.
  while (rows.length && rows[rows.length - 1].every((v) => !v)) rows.pop()
  const width = Math.max(0, ...rows.map((row) => row.reduce((w, v, c) => (v ? c + 1 : w), 0)))
  return rows.map((row) => row.slice(0, width))
}

const mathText = (attrs: Record<string, unknown>): string => {
  const expr = str(attrs.expr)
  const r = calculate(expr)
  return r === null ? expr : `${expr} = ${r}`
}

/** The copied blocks; a copy from inside one paragraph (or list item, or cell) is just its text (inline). */
function trimOpen(slice: CopiedSlice): { blocks: DocJSON[]; inline: boolean } {
  let content = slice.content
  let start = slice.openStart ?? 0
  let end = slice.openEnd ?? 0
  while (content.length === 1 && start > 0 && end > 0 && content[0].content) {
    const only = content[0]
    if (TEXT_BLOCKS.has(only.type)) return { blocks: [{ type: 'paragraph', content: only.content }], inline: true }
    if ((only.content?.length ?? 0) > 1) break // several items or rows: keep the list or table around them
    content = only.content ?? []
    start--
    end--
  }
  return { blocks: content, inline: false }
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])

// ---------- HTML ----------

function marksHtml(node: DocJSON, inner: string): string {
  let html = inner
  for (const mark of node.marks ?? []) {
    const a = mark.attrs ?? {}
    if (mark.type === 'bold') html = `<b>${html}</b>`
    else if (mark.type === 'italic') html = `<i>${html}</i>`
    else if (mark.type === 'underline') html = `<u>${html}</u>`
    else if (mark.type === 'strike') html = `<s>${html}</s>`
    else if (mark.type === 'code') html = `<code style="font-family:Consolas,'Courier New',monospace;background:#f1f1f1">${html}</code>`
    else if (mark.type === 'link' && safeUrl(a.href)) html = `<a href="${esc(safeUrl(a.href))}">${html}</a>`
    else if (mark.type === 'highlight') html = `<span style="background-color:${safeColor(a.color) || '#fff59d'}">${html}</span>`
    else if (mark.type === 'textStyle') {
      const style = [safeColor(a.color) && `color:${safeColor(a.color)}`, safeSize(a.fontSize) && `font-size:${safeSize(a.fontSize)}`].filter(Boolean).join(';')
      if (style) html = `<span style="${style}">${html}</span>`
    }
  }
  return html
}

const blockStyle = (node: DocJSON, base: string): string => {
  const align = safeAlign(node.attrs?.textAlign)
  return ` style="${base}${align ? `;text-align:${align}` : ''}"`
}

const P = 'margin:0 0 6px'
const CELL = 'border:1px solid #999;padding:4px 8px;vertical-align:top'

function inlineHtml(nodes: DocJSON[] | undefined): string {
  return (nodes ?? []).map(nodeHtml).join('')
}

/** A list item's own text inline (so lists don't get gaps in Word), then anything nested */
function itemHtml(item: DocJSON): string {
  const [first, ...rest] = item.content ?? []
  const head = first?.type === 'paragraph' ? inlineHtml(first.content) : first ? nodeHtml(first) : ''
  return head + rest.map(nodeHtml).join('')
}

function tableHtml(rows: string[][], header: boolean): string {
  const body = rows
    .map((row, r) => `<tr>${row.map((v) => (header && r === 0 ? `<th style="${CELL};text-align:left">${esc(v)}</th>` : `<td style="${CELL}">${esc(v)}</td>`)).join('')}</tr>`)
    .join('')
  return `<table style="border-collapse:collapse;margin:0 0 8px">${body}</table>`
}

function nodeHtml(node: DocJSON): string {
  const a = node.attrs ?? {}
  const kids = (): string => (node.content ?? []).map(nodeHtml).join('')
  switch (node.type) {
    case 'text':
      return marksHtml(node, esc(node.text ?? ''))
    case 'hardBreak':
      return '<br>'
    case 'paragraph':
      return `<p${blockStyle(node, P)}>${kids() || '<br>'}</p>`
    case 'heading': {
      const level = Math.min(Math.max(Number(a.level) || 1, 1), 6)
      return `<h${level}${blockStyle(node, 'margin:10px 0 6px')}>${kids()}</h${level}>`
    }
    case 'bulletList':
      return `<ul style="margin:0 0 6px">${(node.content ?? []).map((li) => `<li>${itemHtml(li)}</li>`).join('')}</ul>`
    case 'orderedList': {
      const start = Number(a.start) || 1
      return `<ol${start !== 1 ? ` start="${start}"` : ''} style="margin:0 0 6px">${(node.content ?? []).map((li) => `<li>${itemHtml(li)}</li>`).join('')}</ol>`
    }
    case 'taskList':
      return (node.content ?? []).map(nodeHtml).join('')
    case 'taskItem':
      return `<p style="${P}">${a.checked ? '☑' : '☐'} ${itemHtml(node)}</p>`
    case 'listItem':
      return `<p style="${P}">${itemHtml(node)}</p>`
    case 'blockquote':
      return `<blockquote style="margin:0 0 6px;padding-left:12px;border-left:3px solid #bbb;color:#444">${kids()}</blockquote>`
    case 'codeBlock':
      return `<pre style="font-family:Consolas,'Courier New',monospace;background:#f5f5f5;padding:8px;margin:0 0 6px;white-space:pre-wrap">${esc((node.content ?? []).map((t) => t.text ?? '').join(''))}</pre>`
    case 'horizontalRule':
      return '<hr>'
    case 'image': {
      const src = safeUrl(a.src)
      if (!src) return ''
      const width = Number(a.width) > 0 ? ` width="${Math.round(Number(a.width))}"` : ''
      return `<p style="${P}"><img src="${esc(src)}" alt="${esc(str(a.alt))}"${width} style="max-width:100%"></p>`
    }
    case 'table':
      return `<table style="border-collapse:collapse;margin:0 0 8px">${kids()}</table>`
    case 'tableRow':
      return `<tr>${kids()}</tr>`
    case 'tableCell':
    case 'tableHeader': {
      const tag = node.type === 'tableHeader' ? 'th' : 'td'
      const span = `${Number(a.colspan) > 1 ? ` colspan="${Number(a.colspan)}"` : ''}${Number(a.rowspan) > 1 ? ` rowspan="${Number(a.rowspan)}"` : ''}`
      // Paragraphs in a cell without their spacing
      const inner = (node.content ?? []).map((p) => (p.type === 'paragraph' ? inlineHtml(p.content) : nodeHtml(p))).join('<br>')
      return `<${tag}${span} style="${CELL};text-align:left">${inner}</${tag}>`
    }
    case 'callout': {
      const [bg, edge] = CALLOUT[str(a.tone)] ?? CALLOUT.info
      return `<div style="background:${bg};border-left:4px solid ${edge};padding:8px 12px;margin:0 0 8px">${kids()}</div>`
    }
    case 'details':
      return kids()
    case 'detailsSummary':
      return `<p style="${P}"><b>${kids()}</b></p>`
    case 'detailsContent':
    case 'column':
      return kids()
    case 'columns':
      return `<table style="border-collapse:collapse;width:100%;margin:0 0 8px"><tr>${(node.content ?? []).map((c) => `<td style="vertical-align:top;padding:0 12px 0 0">${nodeHtml(c)}</td>`).join('')}</tr></table>`
    case 'mathLine':
      return `<p style="${P}">${esc(mathText(a))}</p>`
    case 'sheet': {
      const rows = sheetRows(a)
      return rows.length ? tableHtml(rows, a.header !== false) : ''
    }
    case 'formField': {
      const label = str(a.label)
      const answer = esc(fieldAnswer(a))
      const labelHtml = label ? (a.labelBold === false ? esc(label) : `<b>${esc(label)}</b>`) : ''
      return `${labelHtml}${label ? ': ' : ''}${answer}`
    }
    case 'mention':
      return esc(str(a.label))
    case 'fileAttachment':
      return `<p style="${P}">📎 ${esc(str(a.name))}</p>`
    case 'toc':
    case 'drawing':
      return ''
    default:
      return kids()
  }
}

/** HTML for other programs, with the copied piece tucked in for pasting back into Plannr */
export function copyHtml(slice: CopiedSlice): string {
  const { blocks, inline } = trimOpen(slice)
  // Copied from inside one paragraph: just the text, no paragraph spacing.
  const html = inline ? inlineHtml(blocks[0].content) : blocks.map(nodeHtml).join('')
  return `<span ${COPY_ATTR}="${esc(JSON.stringify(slice))}"></span>${html}`
}

/** The copied piece from Plannr's HTML, or null when the HTML came from somewhere else */
export function copiedSlice(html: string): CopiedSlice | null {
  const m = new RegExp(`${COPY_ATTR}="([^"]*)"`).exec(html)
  if (!m) return null
  const json = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  try {
    const slice = JSON.parse(json) as CopiedSlice
    return Array.isArray(slice.content) ? slice : null
  } catch {
    return null
  }
}

// ---------- Plain text ----------

function inlineText(nodes: DocJSON[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      const a = n.attrs ?? {}
      if (n.type === 'text') return n.text ?? ''
      if (n.type === 'hardBreak') return '\n'
      if (n.type === 'mention') return str(a.label)
      if (n.type === 'formField') return `${str(a.label)}${a.label ? ': ' : ''}${fieldAnswer(a)}`
      return inlineText(n.content)
    })
    .join('')
}

function blockLines(node: DocJSON, indent = ''): string[] {
  const a = node.attrs ?? {}
  const kids = (pad = indent): string[] => (node.content ?? []).flatMap((n) => blockLines(n, pad))
  const item = (marker: string, li: DocJSON): string[] => {
    const [first, ...rest] = li.content ?? []
    const head = first ? (first.type === 'paragraph' ? [inlineText(first.content)] : blockLines(first)) : ['']
    return [`${indent}${marker}${head[0] ?? ''}`, ...head.slice(1), ...rest.flatMap((n) => blockLines(n, `${indent}    `))]
  }
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'detailsSummary':
      return inlineText(node.content)
        .split('\n')
        .map((l) => indent + l)
    case 'codeBlock':
      return (node.content ?? []).map((t) => t.text ?? '').join('').split('\n')
    case 'bulletList':
      return (node.content ?? []).flatMap((li) => item('• ', li))
    case 'orderedList': {
      const start = Number(a.start) || 1
      return (node.content ?? []).flatMap((li, i) => item(`${start + i}. `, li))
    }
    case 'taskList':
      return (node.content ?? []).flatMap((li) => item(li.attrs?.checked ? '☑ ' : '☐ ', li))
    case 'taskItem':
      return item(a.checked ? '☑ ' : '☐ ', node)
    case 'listItem':
      return item('', node)
    case 'blockquote':
      return kids(`${indent}> `)
    case 'horizontalRule':
      return ['————————']
    case 'table':
      return (node.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inlineText(p.content)).join(' ')).join('\t'))
    case 'sheet':
      return sheetRows(a).map((row) => row.join('\t'))
    case 'mathLine':
      return [mathText(a)]
    case 'fileAttachment':
      return [`📎 ${str(a.name)}`]
    case 'image':
    case 'drawing':
    case 'toc':
      return []
    default:
      return kids()
  }
}

/** Plain text: one line per paragraph (no blank lines between them), lists with bullets or numbers */
export function copyText(slice: CopiedSlice): string {
  const { blocks } = trimOpen(slice)
  const lines = blocks.flatMap((b) => blockLines(b))
  return lines
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}
