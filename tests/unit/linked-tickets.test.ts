import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as customers from '../../src/main/services/customers'
import * as tickets from '../../src/main/services/tickets'
import { search } from '../../src/main/services/search'

// Randy has tickets for himself, for his business and for his wife's computer; they should all be easy to find together.
let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:') as unknown as Db
  migrate(db)
})

function family() {
  const randy = customers.createCustomer(db, { name: 'Randy', phone: '250 555 0101', company: 'Ropate Refinishers' })
  const jane = customers.createCustomer(db, { name: 'Jane', phone: '250 555 0102' })
  const kid = customers.createCustomer(db, { name: 'Sam' })
  customers.updateCustomer(db, randy.id, { related: [{ id: jane.id, relation: 'Wife' }] })
  customers.updateCustomer(db, kid.id, { related: [{ id: randy.id, relation: 'Parent' }] })
  return { randy, jane, kid }
}

describe('linked customers', () => {
  it('shows links from both sides, with the relation as typed', () => {
    const { randy, jane, kid } = family()
    const fromRandy = customers.linkedCustomers(db, randy.id)
    expect(fromRandy.map((l) => [l.name, l.relation, l.reverse])).toEqual([
      ['Jane', 'Wife', false],
      ['Sam', 'Parent', true]
    ])
    expect(customers.linkedCustomers(db, jane.id).map((l) => [l.name, l.relation, l.reverse])).toEqual([['Randy', 'Wife', true]])
    expect(customers.linkedCustomers(db, kid.id).map((l) => l.name)).toEqual(['Randy'])
  })

  it('drops self-links, duplicates and bad data; trashed people disappear', () => {
    const { randy, jane } = family()
    customers.updateCustomer(db, randy.id, { related: [{ id: randy.id, relation: 'Me' }, { id: jane.id, relation: 'Wife' }, { id: jane.id, relation: 'Again' }] })
    expect(customers.getCustomer(db, randy.id)!.related).toEqual([{ id: jane.id, relation: 'Wife' }])
    db.prepare("UPDATE customers SET related = 'not json' WHERE id = ?").run(randy.id)
    expect(customers.getCustomer(db, randy.id)!.related).toEqual([])
    customers.updateCustomer(db, randy.id, { related: [{ id: jane.id, relation: 'Wife' }] })
    customers.trashCustomer(db, jane.id)
    expect(customers.linkedCustomers(db, randy.id).map((l) => l.name)).toEqual(['Sam'])
  })
})

describe('tickets for someone else or for a business', () => {
  it('keeps who it is for, the business flag and added parts', () => {
    const { randy, jane } = family()
    const t = tickets.createTicket(db, { customerId: randy.id, templateId: null })
    expect([t.forId, t.business, t.parts]).toEqual([null, false, []])
    const s = tickets.updateTicket(db, t.id, { forId: jane.id, business: false, parts: ['photos', 'pickup', 'photos', 'bogus' as never] })
    expect([s.forName, s.parts]).toEqual(['Jane', ['photos', 'pickup']])
    const b = tickets.updateTicket(db, t.id, { forId: null, business: true })
    expect([b.forId, b.business, b.customerCompany]).toEqual([null, true, 'Ropate Refinishers'])
  })

  it("a ticket for Randy's wife is on her list too, and search finds it by her name", () => {
    const { randy, jane } = family()
    const own = tickets.createTicket(db, { customerId: randy.id, templateId: null })
    const hers = tickets.createTicket(db, { customerId: randy.id, templateId: null })
    tickets.updateTicket(db, hers.id, { forId: jane.id, device: 'Aspire desktop' })
    const work = tickets.createTicket(db, { customerId: randy.id, templateId: null })
    tickets.updateTicket(db, work.id, { business: true, device: 'Business laptop' })

    expect(tickets.listTickets(db, { customerId: randy.id }).map((t) => t.id).sort()).toEqual([own.id, hers.id, work.id].sort())
    expect(tickets.listTickets(db, { customerId: jane.id }).map((t) => t.id)).toEqual([hers.id])
    expect(tickets.listTickets(db, { query: 'Jane' }).map((t) => t.id)).toEqual([hers.id])
    expect(tickets.listTickets(db, { query: 'Ropate' }).map((t) => t.id).sort()).toEqual([own.id, hers.id, work.id].sort()) // the customer's business
    expect(search(db, 'Jane').some((r) => r.id === hers.id)).toBe(true)
    expect(search(db, 'Ropate').some((r) => r.id === work.id)).toBe(true)
  })
})

describe('renaming', () => {
  it('a renamed person still finds the tickets done for them', () => {
    const { randy, jane } = family()
    const t = tickets.createTicket(db, { customerId: randy.id, templateId: null })
    tickets.updateTicket(db, t.id, { forId: jane.id })
    customers.updateCustomer(db, jane.id, { name: 'Janet' })
    expect(search(db, 'Janet').some((r) => r.id === t.id)).toBe(true)
  })
})
