import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import * as customers from '../../src/main/services/customers'
import * as tickets from '../../src/main/services/tickets'
import { saveFile } from '../../src/main/services/files'
import { docToMarkdown, exportAll, importContacts, parseCsv } from '../../src/main/services/portability'
import type { DocJSON } from '../../src/shared/api'

let db: Db
let dataDir: string
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  dataDir = mkdtempSync(join(tmpdir(), 'plannr-port-'))
})

const t = (text: string, marks?: DocJSON['marks']): DocJSON => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...c: DocJSON[]): DocJSON => ({ type: 'paragraph', content: c })

describe('CSV', () => {
  it('reads quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('﻿Name,Note\r\n"Doe, Jane","said ""hi""\nthen left"\n\nBob,x\n')).toEqual([
      ['Name', 'Note'],
      ['Doe, Jane', 'said "hi"\nthen left'],
      ['Bob', 'x']
    ])
  })
})

describe('notes to Markdown', () => {
  it('headings, marks, lists, checkboxes, tables, callouts, fields and images', () => {
    const doc: DocJSON = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [t('Steps')] },
        p(t('Use '), t('heat', [{ type: 'bold' }]), t(' and '), t('docs', [{ type: 'link', attrs: { href: 'https://x.y' } }])),
        { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('Open'))] }, { type: 'listItem', content: [p(t('Swap'))] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('Test'))] }] },
        { type: 'callout', attrs: { tone: 'warning' }, content: [p(t('Battery first'))] },
        p({ type: 'formField', attrs: { label: 'Device', value: 'iPhone', kind: 'text' } }),
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('Part'))] }, { type: 'tableHeader', content: [p(t('Cost'))] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('Screen'))] }, { type: 'tableCell', content: [p(t('$129'))] }] }] },
        { type: 'image', attrs: { src: 'plannr://file/abc', alt: 'board' } }
      ]
    }
    expect(docToMarkdown(doc, (id) => `files/${id}.png`)).toBe(
      [
        '## Steps',
        'Use **heat** and [docs](https://x.y)',
        '1. Open\n2. Swap',
        '- [x] Test',
        '> **Warning:** Battery first',
        '**Device:** iPhone',
        '| Part | Cost |\n| --- | --- |\n| Screen | $129 |',
        '![board](files/abc.png)'
      ].join('\n\n') + '\n'
    )
  })
})

describe('import contacts', () => {
  it('Google Contacts columns; skips people already here and empty rows', () => {
    customers.createCustomer(db, { name: 'Jane Doe', email: 'jane@example.com' })
    const csv = [
      'First Name,Last Name,E-mail 1 - Value,Phone 1 - Value,Organization Name',
      'Jane,Doe,jane@example.com,,', // already here
      'Bob,Smith,bob@example.com ::: bob@work.com,(555) 010-2030,',
      ',,,,Acme Corp',
      ',,,,'
    ].join('\n')
    expect(importContacts(db, csv)).toEqual({ added: 2, skipped: 1 }) // blank rows are dropped when reading
    const list = customers.listCustomers(db).map((c) => [c.name, c.email, c.phone])
    expect(list).toContainEqual(['Bob Smith', 'bob@example.com', '(555) 010-2030'])
    expect(list).toContainEqual(['Acme Corp', '', ''])
    expect(importContacts(db, csv)).toEqual({ added: 0, skipped: 3 }) // running it again adds nothing
  })
})

describe('export', () => {
  it('writes notes as Markdown (in their folders, with pictures) and lists as CSV', () => {
    const img = saveFile(db, dataDir, { name: 'board.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) })
    const n = notes.createNote(db, { title: 'Repair guide: iPhone' })
    notes.updateNote(db, n.id, { tags: ['guides'], content: { type: 'doc', content: [p(t('Hello')), { type: 'image', attrs: { src: `plannr://file/${img.id}` } }] } })
    customers.createCustomer(db, { name: 'Jane, the "best"', phone: '555' })
    tickets.createTicket(db, {})
    const out = mkdtempSync(join(tmpdir(), 'plannr-out-'))
    const r = exportAll(db, dataDir, out)
    expect(r).toMatchObject({ notes: 1, files: 1 })
    const md = readFileSync(join(r.folder, 'Notes', 'Repair guide iPhone.md'), 'utf8')
    expect(md).toContain('tags: ["guides"]')
    expect(md).toContain('# Repair guide: iPhone\n\nHello')
    expect(md).toContain(`![](files/${img.id}.png)`)
    expect(existsSync(join(r.folder, 'Notes', 'files', `${img.id}.png`))).toBe(true)
    expect(readFileSync(join(r.folder, 'Customers.csv'), 'utf8')).toContain('"Jane, the ""best"""')
    expect(readdirSync(r.folder).sort()).toEqual(
      ['Bills and subscriptions.csv', 'Calendar.csv', 'Customers.csv', 'Inventory.csv', 'Notes', 'README.txt', 'Tasks.csv', 'Ticket lines.csv', 'Tickets.csv', 'Transactions.csv'].sort()
    )
  })
})
