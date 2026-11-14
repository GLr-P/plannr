import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as tickets from '../../src/main/services/tickets'
import * as customers from '../../src/main/services/customers'
import { search } from '../../src/main/services/search'
import { saveDisplayPrefs } from '../../src/main/display'
import { cleanLayout, customerLayout, DEFAULT_DISPLAY, normalizeStatuses, setDisplayPrefs, statusLabel, ticketStatuses } from '../../src/shared/api'
import { allSections, blankCopy, findSection, sectionLibrary } from '../../src/shared/ticket-sections'

// "I want everything customizable": statuses, every box on a ticket, sections, customer fields.
let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:') as unknown as Db
  migrate(db)
  setDisplayPrefs({ ...DEFAULT_DISPLAY, statuses: undefined, statusLabels: {} })
})

describe('your statuses', () => {
  it('start as the standard ones, keeping names you gave them before', () => {
    expect(normalizeStatuses(undefined, { intake: 'Received' }).map((s) => s.label)).toEqual(['Received', 'In progress', 'Waiting', 'Ready', 'Done'])
    expect(normalizeStatuses([{ id: 'bad id!' }, { id: 'a', label: 'A', color: 'nope', done: true, ready: true }])).toEqual([{ id: 'a', label: 'A', color: 'gray', done: true, ready: false }])
  })

  it('decide what counts as open, finished and ready; tickets move when one is removed', () => {
    saveDisplayPrefs(db, {
      statuses: [
        { id: 'new', label: 'New order', color: 'blue', done: false, ready: false },
        { id: 'quoted', label: 'Quoted', color: 'yellow', done: false, ready: true },
        { id: 'delivered', label: 'Delivered', color: 'green', done: true, ready: false }
      ]
    })
    expect(ticketStatuses().map((s) => s.id)).toEqual(['new', 'quoted', 'delivered'])
    const a = tickets.createTicket(db, { templateId: null })
    expect(a.status).toBe('new') // the first status
    const b = tickets.createTicket(db, { templateId: null })
    tickets.updateTicket(db, b.id, { status: 'quoted' })
    const c = tickets.createTicket(db, { templateId: null })
    const done = tickets.updateTicket(db, c.id, { status: 'delivered' })
    expect(done.closedAt).not.toBeNull()
    expect(tickets.ticketCounts(db)).toEqual({ open: 2, ready: 1 })
    expect(tickets.listTickets(db, { status: 'open' }).map((t) => t.id).sort()).toEqual([a.id, b.id].sort())
    expect(tickets.moveStatus(db, 'quoted', 'new')).toBe(1)
    expect(tickets.statusCounts(db)).toEqual({ new: 2, delivered: 1 })
    expect(statusLabel('gone_status')).toBe('gone status') // a removed status still reads sensibly
  })
})

describe("a ticket's own layout", () => {
  it('renames and removes boxes on top of its template, and resets', () => {
    const t = tickets.createTicket(db)
    tickets.updateTicket(db, t.id, { layout: { customerLabel: 'Client', showCustomerPhone: false, showStatus: false, bogus: 1 } as never })
    const got = tickets.getTicket(db, t.id)!
    expect(got.ownLayout).toEqual({ customerLabel: 'Client', showCustomerPhone: false, showStatus: false })
    expect([got.layout.customerLabel, got.layout.showCustomerPhone, got.layout.showStatus, got.layout.summaryLabel]).toEqual(['Client', false, false, 'Details'])
    tickets.updateTicket(db, t.id, { layout: null })
    expect(tickets.getTicket(db, t.id)!.layout.customerLabel).toBe('Customer')
    expect(cleanLayout({ nope: 1 })).toBeNull()
  })
})

describe('your sections', () => {
  it('your version of a built-in one replaces it; your own are added; hidden ones are left out', () => {
    const lib = sectionLibrary({
      custom: [
        { id: 'work', title: 'What I did', icon: 'Wrench', group: 'work', hint: '', content: [{ type: 'paragraph' }] },
        { id: 'my:1', title: 'Battery health', icon: 'Battery', group: 'device', hint: '', content: [{ type: 'paragraph' }] }
      ],
      hidden: ['delivery']
    })
    const list = allSections(lib)
    expect(list.find((s) => s.id === 'work')!.title).toBe('What I did')
    expect(list.find((s) => s.id === 'my:1')!.mine).toBe(true)
    expect(list.some((s) => s.id === 'delivery')).toBe(false)
    expect(findSection('delivery', lib)!.title).toBe('Delivery') // still known for tickets that have it
  })

  it('saved copies drop answers, ticks and pictures', () => {
    const copy = blankCopy([
      { type: 'paragraph', content: [{ type: 'formField', attrs: { label: 'Passcode', value: '4540' } }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] }] },
      { type: 'image', attrs: { src: 'x' } }
    ])
    expect(JSON.stringify(copy)).not.toContain('4540')
    expect(JSON.stringify(copy)).toContain('"checked":false')
    expect(copy).toHaveLength(2)
  })
})

describe('your customer fields', () => {
  it('are kept per customer and searchable; the page setup is cleaned', () => {
    const c = customers.createCustomer(db, { name: 'Dot' })
    customers.updateCustomer(db, c.id, { fields: { f_bday: '1950-04-02', f_pref: 'Text, not calls', bad: 5 as never } })
    expect(customers.getCustomer(db, c.id)!.fields).toEqual({ f_bday: '1950-04-02', f_pref: 'Text, not calls' })
    expect(search(db, 'calls').some((r) => r.id === c.id)).toBe(true)
    expect(customerLayout({ hidden: ['notes', 3], labels: { phone: 'Cell', email: ' ' }, fields: [{ id: 'f', label: 'Birthday', kind: 'date' }, { id: 'g', label: 'X', kind: 'weird' }] })).toEqual({
      hidden: ['notes'],
      labels: { phone: 'Cell' },
      fields: [
        { id: 'f', label: 'Birthday', kind: 'date' },
        { id: 'g', label: 'X', kind: 'text' }
      ]
    })
  })
})
