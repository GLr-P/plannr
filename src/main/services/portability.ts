import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Db } from '../db'
import { formatTicketNumber, type DocJSON } from '../../shared/api'
import { resolveFilePath } from './files'
import { createCustomer } from './customers'
import { digitsOnly, fieldText, localDate } from './doc'

/*
 * Your data in plain files, and contacts in from other apps.
 * Export: notes → Markdown (images copied next to them), everything else → CSV (opens in Excel). The vault is left
 * out on purpose: it's encrypted and stays that way.
 * Import: a CSV of contacts (Google Contacts, Outlook, or any sheet with name/phone/email columns).
 */

// ---------- CSV ----------

export const csvCell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (header: string[], rows: (string | number | null | undefined)[][]): string =>
  '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n' // BOM: Excel reads it as UTF-8

/** Parses CSV text (quotes, commas and line breaks inside quotes) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim()))
}

// ---------- Notes → Markdown ----------

const esc = (s: string): string => s.replace(/([\\`*_[\]])/g, '\\$1')

function inline(nodes: DocJSON[] | undefined, files: (id: string) => string | null): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'mention') return `@${String(n.attrs?.label ?? '')}`
      if (n.type === 'formField') {
        const v = String(n.attrs?.value ?? '')
        return `**${esc(String(n.attrs?.label ?? ''))}:** ${esc(fieldText(String(n.attrs?.kind ?? ''), v))}`
      }
      if (n.type === 'image') return image(n, files)
      if (n.type !== 'text') return inline(n.content, files)
      let t = esc(n.text ?? '')
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') t = `**${t}**`
        else if (m.type === 'italic') t = `*${t}*`
        else if (m.type === 'strike') t = `~~${t}~~`
        else if (m.type === 'code') t = `\`${n.text ?? ''}\``
        else if (m.type === 'highlight') t = `==${t}==`
        else if (m.type === 'link') t = `[${t}](${String(m.attrs?.href ?? '')})`
      }
      return t
    })
    .join('')
}

function image(n: DocJSON, files: (id: string) => string | null): string {
  const src = String(n.attrs?.src ?? '')
  const id = /^plannr:\/\/file\/([\w-]+)/.exec(src)?.[1]
  const local = id ? files(id) : null
  return `![${String(n.attrs?.alt ?? '')}](${local ?? src})`
}

function block(n: DocJSON, files: (id: string) => string | null, indent = ''): string {
  const kids = (nodes: DocJSON[] | undefined, ind = indent): string => (nodes ?? []).map((c) => block(c, files, ind)).filter(Boolean).join('\n\n')
  switch (n.type) {
    case 'doc':
      return kids(n.content)
    case 'paragraph':
      return indent + inline(n.content, files)
    case 'heading':
      return `${'#'.repeat(Number(n.attrs?.level ?? 2))} ${inline(n.content, files)}`
    case 'blockquote':
      return kids(n.content)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    case 'callout':
      return `> **${String(n.attrs?.tone ?? 'note').replace(/^\w/, (c) => c.toUpperCase())}:** ` + kids(n.content).split('\n').join('\n> ')
    case 'codeBlock':
      return '```\n' + (n.content ?? []).map((c) => c.text ?? '').join('') + '\n```'
    case 'horizontalRule':
      return '---'
    case 'image':
      return image(n, files)
    case 'fileAttachment': {
      const id = /^plannr:\/\/file\/([\w-]+)/.exec(String(n.attrs?.src ?? ''))?.[1]
      const local = id ? files(id) : null
      return `📎 [${esc(String(n.attrs?.name ?? 'file'))}](${local ?? String(n.attrs?.src ?? '')})`
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return (n.content ?? [])
        .map((item, i) => {
          const mark = n.type === 'orderedList' ? `${i + 1}.` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-'
          const [first, ...rest] = item.content ?? []
          const head = first ? block(first, files, '').trim() : ''
          const more = rest.map((c) => block(c, files, `${indent}  `)).join('\n')
          return `${indent}${mark} ${head}${more ? `\n${more}` : ''}`
        })
        .join('\n')
    case 'details': {
      const [summary, content] = n.content ?? []
      return `**${inline(summary?.content, files)}**\n\n${kids(content?.content)}`
    }
    case 'table': {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => kids(c.content).replace(/\n+/g, ' ').replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]): string => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
    }
    default:
      return kids(n.content)
  }
}

export function docToMarkdown(doc: DocJSON | null, files: (id: string) => string | null = () => null): string {
  return doc ? block(doc, files).replace(/\n{3,}/g, '\n\n').trim() + '\n' : ''
}

const safeName = (s: string): string => (s.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled').slice(0, 80)

// ---------- Export ----------

export interface ExportResult {
  folder: string
  notes: number
  files: number
}

export function exportAll(db: Db, dataDir: string, outDir: string): ExportResult {
  const folder = join(outDir, `Plannr export ${localDate()}`)
  const notesDir = join(folder, 'Notes')
  const filesDir = join(notesDir, 'files')
  mkdirSync(filesDir, { recursive: true })
  let fileCount = 0
  const copied = new Map<string, string>()
  const fileFor = (id: string): string | null => {
    if (copied.has(id)) return copied.get(id)!
    const f = resolveFilePath(db, dataDir, id)
    if (!f) return null
    const name = `${id}${extname(f.path)}`
    try {
      copyFileSync(f.path, join(filesDir, name))
    } catch {
      return null
    }
    fileCount++
    copied.set(id, `files/${name}`)
    return `files/${name}`
  }

  // Notes, one Markdown file each (in their folder), with a small header
  const folders = new Map((db.prepare('SELECT id, name FROM folders WHERE deleted_at IS NULL').all() as { id: string; name: string }[]).map((f) => [f.id, f.name]))
  const notes = db
    .prepare('SELECT id, title, folder_id, tags, content_json, created_at, updated_at FROM notes WHERE deleted_at IS NULL ORDER BY title')
    .all() as { id: string; title: string; folder_id: string | null; tags: string; content_json: string | null; created_at: number; updated_at: number }[]
  const used = new Set<string>()
  for (const n of notes) {
    const dir = n.folder_id && folders.has(n.folder_id) ? join(notesDir, safeName(folders.get(n.folder_id)!)) : notesDir
    mkdirSync(dir, { recursive: true })
    let name = safeName(n.title)
    for (let i = 2; used.has(join(dir, name).toLowerCase()); i++) name = `${safeName(n.title)} (${i})`
    used.add(join(dir, name).toLowerCase())
    const tags = JSON.parse(n.tags) as string[]
    const front = ['---', `title: ${JSON.stringify(n.title || 'Untitled')}`, ...(tags.length ? [`tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`] : []), `created: ${new Date(n.created_at).toISOString()}`, `updated: ${new Date(n.updated_at).toISOString()}`, '---', '']
    const prefix = dir === notesDir ? '' : '../' // images live in Notes/files
    const body = docToMarkdown(n.content_json ? (JSON.parse(n.content_json) as DocJSON) : null, (id) => {
      const p = fileFor(id)
      return p ? prefix + p : null
    })
    writeFileSync(join(dir, `${name}.md`), front.join('\n') + `# ${n.title || 'Untitled'}\n\n` + body)
  }

  const money = (c: number | null | undefined): string => (c === null || c === undefined ? '' : (c / 100).toFixed(2))
  const date = (ms: number | null): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '')
  const q = <T>(sql: string): T[] => db.prepare(sql).all() as T[]

  writeFileSync(
    join(folder, 'Customers.csv'),
    csv(
      ['Name', 'Phone', 'Email', 'Address', 'Notes', 'Added'],
      q<{ name: string; phone: string; email: string; address: string; notes: string; created_at: number }>('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY name').map((c) => [c.name, c.phone, c.email, c.address, c.notes, date(c.created_at)])
    )
  )
  writeFileSync(
    join(folder, 'Tickets.csv'),
    csv(
      ['Ticket', 'Customer', 'Device', 'Issue', 'Status', 'Received', 'Pickup', 'Price', 'Paid', 'Details'],
      q<{ number: number; name: string | null; device: string; issue: string; status: string; received_on: string | null; pickup_on: string | null; price_cents: number | null; paid: number; content_text: string }>(
        `SELECT t.*, c.name, (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions p WHERE p.ticket_id = t.id AND p.type = 'income' AND p.deleted_at IS NULL) AS paid
         FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.deleted_at IS NULL ORDER BY t.number`
      ).map((t) => [formatTicketNumber(t.number), t.name, t.device, t.issue, t.status, t.received_on, t.pickup_on, money(t.price_cents), money(t.paid), t.content_text])
    )
  )
  writeFileSync(
    join(folder, 'Ticket lines.csv'),
    csv(
      ['Ticket', 'Type', 'Description', 'Qty', 'Unit price', 'Amount', 'Part cost'],
      q<{ number: number; kind: string; description: string; qty: number; unit_cents: number; cost_cents: number | null }>(
        'SELECT t.number, i.* FROM ticket_items i JOIN tickets t ON t.id = i.ticket_id WHERE t.deleted_at IS NULL ORDER BY t.number, i.sort'
      ).map((l) => [formatTicketNumber(l.number), l.kind, l.description, l.qty, money(l.unit_cents), money(Math.round(l.qty * l.unit_cents)), money(l.cost_cents)])
    )
  )
  writeFileSync(
    join(folder, 'Transactions.csv'),
    csv(
      ['Date', 'Type', 'Amount', 'Description', 'Category', 'Method', 'No tax'],
      q<{ date: string; type: string; amount_cents: number; description: string; category: string; method: string; tax_exempt: number }>('SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY date').map((t) => [
        t.date,
        t.type,
        money(t.type === 'expense' ? -t.amount_cents : t.amount_cents),
        t.description,
        t.category,
        t.method,
        t.tax_exempt ? 'yes' : ''
      ])
    )
  )
  writeFileSync(
    join(folder, 'Bills and subscriptions.csv'),
    csv(
      ['Name', 'Kind', 'Amount', 'Every', 'Next due', 'Auto-pay', 'Active', 'Category'],
      q<{ name: string; kind: string; amount_cents: number; frequency: string; next_due: string; autopay: number; active: number; category: string }>('SELECT * FROM recurring WHERE deleted_at IS NULL ORDER BY name').map((r) => [
        r.name,
        r.kind,
        money(r.amount_cents),
        r.frequency,
        r.next_due,
        r.autopay ? 'yes' : '',
        r.active ? 'yes' : 'cancelled',
        r.category
      ])
    )
  )
  writeFileSync(
    join(folder, 'Tasks.csv'),
    csv(
      ['Task', 'Due', 'Time', 'Done', 'Notes'],
      q<{ title: string; due_date: string | null; due_time: string | null; done_at: number | null; notes: string }>('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY due_date').map((t) => [t.title, t.due_date, t.due_time, date(t.done_at), t.notes])
    )
  )
  writeFileSync(
    join(folder, 'Inventory.csv'),
    csv(
      ['Part', 'SKU', 'In stock', 'Reorder at', 'Cost', 'Price', 'Supplier', 'Notes'],
      q<{ name: string; sku: string; qty: number; reorder_at: number; cost_cents: number; price_cents: number; supplier: string; notes: string }>('SELECT * FROM parts WHERE deleted_at IS NULL ORDER BY name').map((p) => [
        p.name,
        p.sku,
        p.qty,
        p.reorder_at,
        money(p.cost_cents),
        money(p.price_cents),
        p.supplier,
        p.notes
      ])
    )
  )
  writeFileSync(
    join(folder, 'Calendar.csv'),
    csv(
      ['Date', 'Start', 'End', 'Title', 'Repeats', 'Until', 'Notes'],
      q<{ date: string; start_time: string | null; end_time: string | null; title: string; repeat: string; repeat_until: string | null; notes: string }>('SELECT * FROM events WHERE deleted_at IS NULL ORDER BY date').map((e) => [
        e.date,
        e.start_time,
        e.end_time,
        e.title,
        e.repeat,
        e.repeat_until,
        e.notes
      ])
    )
  )
  writeFileSync(
    join(folder, 'README.txt'),
    `Exported from Plannr on ${localDate()}.\r\n\r\nNotes are Markdown files (open them in any text editor, Obsidian, Notion import…); pictures are in Notes\\files.\r\nEverything else is CSV and opens in Excel or Google Sheets.\r\nThe vault isn't included: it stays encrypted inside Plannr.\r\n`
  )
  return { folder, notes: notes.length, files: fileCount }
}

// ---------- Import contacts ----------

export interface ImportResult {
  added: number
  skipped: number
}

/** Adds contacts from CSV text. Columns are recognised by their names; existing customers (same email, phone or name) are skipped. */
export function importContacts(db: Db, text: string): ImportResult {
  const [header, ...rows] = parseCsv(text)
  if (!header) return { added: 0, skipped: 0 }
  const col = (...patterns: RegExp[]): number => header.findIndex((h) => patterns.some((p) => p.test(h.trim())))
  const name = col(/^(full )?name$/i, /^display name$/i, /^contact$/i, /^customer$/i)
  const first = col(/^first( name)?$/i, /^given name$/i)
  const last = col(/^last( name)?$/i, /^family name$/i, /^surname$/i)
  const company = col(/^company$/i, /^organi[sz]ation( 1 - name| name)?$/i)
  const phone = col(/^phone$/i, /^phone 1 - value$/i, /^mobile( phone)?$/i, /^(primary |business |home )?phone( number)?$/i, /^cell$/i, /^tel/i)
  const email = col(/^e-?mail$/i, /^e-?mail 1 - value$/i, /^e-?mail address$/i, /^email address$/i)
  const address = col(/^address$/i, /^address 1 - formatted$/i, /^(home |business )?street$/i, /^(home |business )?address$/i)
  const get = (r: string[], i: number): string => (i >= 0 ? (r[i] ?? '').trim() : '')

  const existing = db.prepare('SELECT lower(name) AS name, lower(email) AS email, phone FROM customers WHERE deleted_at IS NULL').all() as { name: string; email: string; phone: string }[]
  const names = new Set(existing.map((c) => c.name).filter(Boolean))
  const emails = new Set(existing.map((c) => c.email).filter(Boolean))
  const phones = new Set(existing.map((c) => digitsOnly(c.phone)).filter((d) => d.length >= 7))
  let added = 0
  let skipped = 0
  for (const r of rows) {
    const fullName = get(r, name) || [get(r, first), get(r, last)].filter(Boolean).join(' ') || get(r, company)
    const em = get(r, email).split(/\s*:::\s*/)[0] // Google joins several emails with " ::: "
    const ph = get(r, phone).split(/\s*:::\s*/)[0]
    if (!fullName && !em && !ph) {
      skipped++
      continue
    }
    const digits = digitsOnly(ph)
    if ((em && emails.has(em.toLowerCase())) || (digits.length >= 7 && phones.has(digits)) || (fullName && names.has(fullName.toLowerCase()))) {
      skipped++
      continue
    }
    createCustomer(db, { name: fullName, phone: ph, email: em, address: get(r, address) })
    if (fullName) names.add(fullName.toLowerCase())
    if (em) emails.add(em.toLowerCase())
    if (digits.length >= 7) phones.add(digits)
    added++
  }
  return { added, skipped }
}
