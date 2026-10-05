import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as customers from '../../src/main/services/customers'
import * as tickets from '../../src/main/services/tickets'
import * as photos from '../../src/main/services/photos'
import * as templates from '../../src/main/services/templates'
import { saveFile } from '../../src/main/services/files'
import { search } from '../../src/main/services/search'
import { rebuildSearchIndex } from '../../src/main/services/reindex'
import { backlinks } from '../../src/main/services/links'
import { extractText, localDate } from '../../src/main/services/doc'
import { formatTicketNumber, type DocJSON } from '../../src/shared/api'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
})

const field = (label: string, value: string, kind = 'text'): DocJSON => ({
  type: 'paragraph',
  content: [{ type: 'formField', attrs: { label, kind, options: [], value } }]
})

describe('customers', () => {
  it('creates, updates and lists with ticket counts', () => {
    const c = customers.createCustomer(db, { name: ' Jane Doe ', phone: '(555) 123-4567', email: 'jane@example.com' })
    expect(c.name).toBe('Jane Doe')
    customers.updateCustomer(db, c.id, { address: '1 Main St' })
    tickets.createTicket(db, { customerId: c.id, templateId: null })
    tickets.createTicket(db, { customerId: c.id, templateId: null })
    const [row] = customers.listCustomers(db)
    expect(row.address).toBe('1 Main St')
    expect(row.ticketCount).toBe(2)
    expect(row.lastVisit).toBe(localDate())
  })

  it('finds customers by name, email, and phone in any format', () => {
    const jane = customers.createCustomer(db, { name: 'Jane Doe', phone: '(555) 123-4567', email: 'jane@example.com' })
    customers.createCustomer(db, { name: 'Bob Smith', phone: '555-999-0000' })
    const ids = (q: string) => customers.listCustomers(db, { query: q }).map((c) => c.id)
    expect(ids('jane')).toEqual([jane.id])
    expect(ids('doe jane')).toEqual([jane.id])
    expect(ids('example.com')).toEqual([jane.id])
    expect(ids('5551234567')).toEqual([jane.id])
    expect(ids('123-4567')).toEqual([jane.id])
    expect(ids('555')).toHaveLength(2)
    expect(ids('100%')).toEqual([]) // LIKE wildcards are escaped
  })

  it('appears in global search, also by digits-only phone', () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe', phone: '(555) 123-4567' })
    expect(search(db, 'jane').map((r) => [r.type, r.id])).toEqual([['customer', c.id]])
    expect(search(db, '5551234567').map((r) => r.id)).toContain(c.id)
  })

  it('trash hides the customer but keeps their tickets and name on them', () => {
    const c = customers.createCustomer(db, { name: 'Gone Customer' })
    const t = tickets.createTicket(db, { customerId: c.id, templateId: null })
    customers.trashCustomer(db, c.id)
    expect(customers.listCustomers(db)).toHaveLength(0)
    expect(search(db, 'gone').map((r) => r.type)).toEqual(['ticket'])
    expect(tickets.getTicket(db, t.id)!.customerName).toBe('Gone Customer')
  })
})

describe('tickets', () => {
  it('numbers tickets sequentially and starts as intake today', () => {
    const a = tickets.createTicket(db, { templateId: null })
    const b = tickets.createTicket(db, { templateId: null })
    expect([a.number, b.number]).toEqual([1, 2])
    expect(formatTicketNumber(b.number)).toBe('T-0002')
    expect(a.status).toBe('intake')
    expect(a.receivedOn).toBe(localDate())
  })

  it('copies the default template into new tickets, independently', () => {
    templates.ensureStarterTemplate(db)
    templates.ensureStarterTemplate(db) // only once
    expect(templates.listTemplates(db).map((t) => t.name)).toEqual(['Repair intake'])
    const a = tickets.createTicket(db)
    expect(a.templateId).toBe(templates.listTemplates(db)[0].id)
    expect(JSON.stringify(a.content)).toContain('Passcode')
    tickets.updateTicket(db, a.id, { content: { type: 'doc', content: [field('Passcode', '1234')] } })
    const b = tickets.createTicket(db)
    expect(JSON.stringify(b.content)).not.toContain('1234') // template unchanged by edits to a ticket
  })

  it('can start blank and uses a chosen template', () => {
    const t = templates.createTemplate(db, { name: 'Quick', content: { type: 'doc', content: [field('Note', '')] } })
    expect(tickets.createTicket(db, { templateId: null }).content).toBeNull()
    expect(tickets.createTicket(db, { templateId: t.id }).templateId).toBe(t.id)
  })

  it('updates fields, validates status and dates, and tracks closing', () => {
    const t = tickets.createTicket(db, { templateId: null })
    const s = tickets.updateTicket(db, t.id, {
      device: 'iPhone 13',
      issue: 'Cracked screen',
      priceCents: 12999,
      pickupOn: '2026-10-10',
      receivedOn: 'garbage'
    })
    expect(s).toMatchObject({ device: 'iPhone 13', issue: 'Cracked screen', priceCents: 12999, pickupOn: '2026-10-10', receivedOn: null })
    expect(() => tickets.updateTicket(db, t.id, { status: 'nope' as never })).toThrow(/Unknown status/)
    expect(tickets.updateTicket(db, t.id, { status: 'picked_up' }).closedAt).not.toBeNull()
    expect(tickets.updateTicket(db, t.id, { status: 'ready' }).closedAt).toBeNull()
  })

  it('filters by status, customer, date range and query (name, phone, number, device, text)', () => {
    const jane = customers.createCustomer(db, { name: 'Jane Doe', phone: '(555) 123-4567', email: 'jane@x.com' })
    const bob = customers.createCustomer(db, { name: 'Bob Smith' })
    const t1 = tickets.createTicket(db, { customerId: jane.id, templateId: null })
    const t2 = tickets.createTicket(db, { customerId: bob.id, templateId: null })
    tickets.updateTicket(db, t1.id, { device: 'iPhone 13', receivedOn: '2026-09-01', content: { type: 'doc', content: [field('Passcode', 'swordfish')] } })
    tickets.updateTicket(db, t2.id, { device: 'Dell XPS', status: 'picked_up', receivedOn: '2026-10-01' })
    const ids = (f: Parameters<typeof tickets.listTickets>[1]) => tickets.listTickets(db, f).map((t) => t.id)

    expect(ids({})).toEqual([t2.id, t1.id]) // newest number first
    expect(ids({ status: 'open' })).toEqual([t1.id])
    expect(ids({ status: 'picked_up' })).toEqual([t2.id])
    expect(ids({ customerId: bob.id })).toEqual([t2.id])
    expect(ids({ from: '2026-09-15' })).toEqual([t2.id])
    expect(ids({ to: '2026-09-15' })).toEqual([t1.id])
    expect(ids({ query: 'jane' })).toEqual([t1.id])
    expect(ids({ query: 'jane@x' })).toEqual([t1.id])
    expect(ids({ query: '5551234567' })).toEqual([t1.id])
    expect(ids({ query: 'T-0002' })).toEqual([t2.id])
    expect(ids({ query: 'nt2' })).toEqual([t2.id])
    expect(ids({ query: 'xps' })).toEqual([t2.id])
    expect(ids({ query: 'swordfish' })).toEqual([t1.id])
    expect(ids({ query: 'jane xps' })).toEqual([])
  })

  it('is globally searchable, and follows customer renames', () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe' })
    const t = tickets.createTicket(db, { customerId: c.id, templateId: null })
    tickets.updateTicket(db, t.id, { device: 'Pixel 7' })
    expect(search(db, 'pixel')[0]).toMatchObject({ type: 'ticket', id: t.id, title: 'T-0001 · Pixel 7' })
    expect(search(db, 'T-0001')[0].id).toBe(t.id)
    customers.updateCustomer(db, c.id, { name: 'Janet Roe' })
    expect(search(db, 'janet').map((r) => r.type).sort()).toEqual(['customer', 'ticket'])
  })

  it('trash and restore, counts open/ready', () => {
    const a = tickets.createTicket(db, { templateId: null })
    const b = tickets.createTicket(db, { templateId: null })
    tickets.updateTicket(db, b.id, { status: 'ready' })
    expect(tickets.ticketCounts(db)).toEqual({ open: 2, ready: 1 })
    tickets.trashTicket(db, a.id)
    expect(tickets.listTickets(db).map((t) => t.id)).toEqual([b.id])
    expect(tickets.listTickets(db, { trashed: true }).map((t) => t.id)).toEqual([a.id])
    expect(tickets.ticketCounts(db).open).toBe(1)
    tickets.restoreTicket(db, a.id)
    expect(tickets.listTickets(db)).toHaveLength(2)
  })

  it('mentions in tickets create backlinks', () => {
    const c = customers.createCustomer(db, { name: 'Jane' })
    const t = tickets.createTicket(db, { templateId: null })
    tickets.updateTicket(db, t.id, {
      device: 'iPad',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: c.id, label: 'Jane', kind: 'customer' } }] }] }
    })
    expect(backlinks(db, c.id)).toEqual([{ type: 'ticket', id: t.id, title: 'T-0001 · iPad' }])
  })
})

describe('photos', () => {
  it('adds before/after photos in order, moves and removes them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plannr-photos-'))
    const t = tickets.createTicket(db, { templateId: null })
    const f1 = saveFile(db, dir, { name: 'a.jpg', mime: 'image/jpeg', data: new Uint8Array([1]) })
    const f2 = saveFile(db, dir, { name: 'b.jpg', mime: 'image/jpeg', data: new Uint8Array([2]) })
    const list = photos.addPhotos(db, t.id, [f1.id, f2.id], 'before')
    expect(list.map((p) => [p.name, p.kind])).toEqual([['a.jpg', 'before'], ['b.jpg', 'before']])
    expect(list[0].url).toBe(`plannr://file/${f1.id}`)
    photos.setPhotoKind(db, list[1].id, 'after')
    photos.removePhoto(db, list[0].id)
    expect(photos.listPhotos(db, t.id).map((p) => [p.name, p.kind])).toEqual([['b.jpg', 'after']])
    expect(() => photos.addPhotos(db, t.id, [f1.id], 'during' as never)).toThrow()
  })
})

describe('templates and form fields', () => {
  it('extracts form field values as searchable text', () => {
    const doc: DocJSON = { type: 'doc', content: [field('Passcode', '1234'), field('Backup', 'true', 'checkbox')] }
    expect(extractText(doc)).toBe('Passcode: 1234\nBackup: Yes')
  })

  it('removing the default template falls back to another', () => {
    const a = templates.createTemplate(db, { name: 'A' })
    const b = templates.createTemplate(db, { name: 'B' })
    templates.ensureStarterTemplate(db)
    const starter = templates.getDefaultTemplateId(db)!
    templates.removeTemplate(db, starter)
    expect([a.id, b.id]).toContain(templates.getDefaultTemplateId(db))
    templates.updateTemplate(db, a.id, { name: 'Renamed' })
    expect(templates.getTemplate(db, a.id)!.name).toBe('Renamed')
  })
})

describe('search index', () => {
  it('keeps match-only terms out of snippets but still matches them', () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe', phone: '(555) 123-4567', email: 'jane@x.com' })
    const t = tickets.createTicket(db, { customerId: c.id, templateId: null })
    tickets.updateTicket(db, t.id, { issue: 'Cracked screen', status: 'waiting_parts' })
    const [customer] = search(db, 'jane', { types: ['customer'] })
    expect(customer.snippet).not.toContain('5551234567')
    expect(search(db, '5551234567', { types: ['customer'] }).map((r) => r.id)).toEqual([c.id])
    const [ticket] = search(db, 'jane', { types: ['ticket'] })
    expect(ticket.snippet).not.toMatch(/Waiting on parts/)
    expect(search(db, 'waiting', { types: ['ticket'] }).map((r) => r.id)).toEqual([t.id])
  })

  it('rebuilds from the real tables', () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe' })
    db.exec('DELETE FROM search_index')
    expect(search(db, 'jane')).toHaveLength(0)
    rebuildSearchIndex(db)
    expect(search(db, 'jane').map((r) => r.id)).toEqual([c.id])
  })
})
