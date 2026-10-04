import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as cal from '../../src/main/services/calendar'
import * as tickets from '../../src/main/services/tickets'
import * as customers from '../../src/main/services/customers'
import * as notes from '../../src/main/services/notes'
import { dueReminders, fireTime, markReminderFired } from '../../src/main/services/reminders'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
})

const ticketFor = (name: string) => {
  const c = customers.createCustomer(db, { name })
  return tickets.createTicket(db, { customerId: c.id, templateId: null })
}

describe('events', () => {
  it('creates, lists by range, updates and removes', () => {
    const e = cal.createEvent(db, { title: 'Order parts', date: '2026-10-05', startTime: '14:30', endTime: '15:00' })
    expect(e).toMatchObject({ title: 'Order parts', startTime: '14:30', endTime: '15:00', kind: 'event', reminders: ['day_before', 'day_of'] })
    cal.createEvent(db, { title: 'Later', date: '2026-11-01' })
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31').map((x) => x.title)).toEqual(['Order parts'])
    const u = cal.updateEvent(db, e.id, { title: 'Order screen', startTime: null, reminders: ['day_of', 'bogus' as never] })
    expect(u).toMatchObject({ title: 'Order screen', startTime: null, endTime: null, reminders: ['day_of'] })
    cal.removeEvent(db, e.id)
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31')).toHaveLength(0)
  })

  it('rejects bad dates and ignores bad times', () => {
    expect(() => cal.createEvent(db, { date: '10/5/2026' })).toThrow(/Invalid date/)
    expect(cal.createEvent(db, { date: '2026-10-05', startTime: '25:00' }).startTime).toBeNull()
  })
})

describe('ticket pickups', () => {
  it('setting a pickup date on the ticket creates/moves/removes one pickup event', () => {
    const t = ticketFor('Jane Doe')
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-10' })
    let [ev] = cal.eventsForLink(db, t.id)
    expect(ev).toMatchObject({ kind: 'pickup', date: '2026-10-10', title: 'Jane Doe pickup', linkType: 'ticket', linkTitle: 'NT-0001 (Jane Doe)' })
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-12' })
    expect(cal.eventsForLink(db, t.id).map((e) => e.date)).toEqual(['2026-10-12'])
    tickets.updateTicket(db, t.id, { pickupOn: null })
    expect(cal.eventsForLink(db, t.id)).toHaveLength(0)
    ev = cal.dropItem(db, { type: 'ticket', id: t.id }, '2026-10-20')
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBe('2026-10-20')
  })

  it('dropping a ticket twice moves its pickup instead of duplicating', () => {
    const t = ticketFor('Bob')
    const a = cal.dropItem(db, { type: 'ticket', id: t.id }, '2026-10-10')
    const b = cal.dropItem(db, { type: 'ticket', id: t.id }, '2026-10-11', '10:00')
    expect(b.id).toBe(a.id)
    expect(b).toMatchObject({ date: '2026-10-11', startTime: '10:00' })
    expect(cal.eventsForLink(db, t.id)).toHaveLength(1)
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBe('2026-10-11')
  })

  it('moving or deleting the pickup event updates the ticket', () => {
    const t = ticketFor('Jane')
    const ev = cal.dropItem(db, { type: 'ticket', id: t.id }, '2026-10-10')
    cal.updateEvent(db, ev.id, { date: '2026-10-15' })
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBe('2026-10-15')
    cal.updateEvent(db, ev.id, { kind: 'event' }) // no longer the pickup
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBeNull()
    cal.updateEvent(db, ev.id, { kind: 'pickup' })
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBe('2026-10-15')
    cal.removeEvent(db, ev.id)
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBeNull()
  })

  it('pickups hide while the ticket is in the trash', () => {
    const t = ticketFor('Jane')
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-10' })
    tickets.trashTicket(db, t.id)
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31')).toHaveLength(0)
    tickets.restoreTicket(db, t.id)
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31')).toHaveLength(1)
  })

  it('only ticket events can be pickups', () => {
    const e = cal.createEvent(db, { date: '2026-10-05' })
    expect(() => cal.updateEvent(db, e.id, { kind: 'pickup' })).toThrow(/Only ticket/)
  })
})

describe('dropping customers and notes', () => {
  it('creates linked events titled after the item', () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe' })
    const n = notes.createNote(db, { title: 'Order list' })
    const a = cal.dropItem(db, { type: 'customer', id: c.id }, '2026-10-05')
    const b = cal.dropItem(db, { type: 'note', id: n.id }, '2026-10-05', '09:30')
    expect(a).toMatchObject({ title: 'Jane Doe', kind: 'event', linkType: 'customer', linkTitle: 'Jane Doe' })
    expect(b).toMatchObject({ title: 'Order list', startTime: '09:30', linkTitle: 'Order list' })
    notes.trashNote(db, n.id)
    expect(cal.getEvent(db, b.id)!.linkDeleted).toBe(true)
  })
})

describe('reminders', () => {
  const at = (iso: string) => new Date(iso) // local time (no Z)

  it('computes fire times: day before at 9:00, day of at 8:00', () => {
    expect(fireTime('2026-10-10', 'day_before')).toEqual(at('2026-10-09T09:00:00'))
    expect(fireTime('2026-10-10', 'day_of')).toEqual(at('2026-10-10T08:00:00'))
    expect(fireTime('2026-11-01', 'day_before')).toEqual(at('2026-10-31T09:00:00')) // month rollover
  })

  it('fires each reminder once, in its window', () => {
    const t = ticketFor('Jane Doe')
    tickets.updateTicket(db, t.id, { device: 'iPhone 13', pickupOn: '2026-10-10' })
    expect(dueReminders(db, at('2026-10-09T08:59:00'))).toHaveLength(0)
    const due = dueReminders(db, at('2026-10-09T09:01:00'))
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ title: 'Jane Doe pickup', body: 'Tomorrow · NT-0001 · iPhone 13 (Jane Doe)', linkType: 'ticket', linkId: t.id })
    markReminderFired(db, due[0].eventId, due[0].key)
    expect(dueReminders(db, at('2026-10-09T09:02:00'))).toHaveLength(0)
    const dayOf = dueReminders(db, at('2026-10-10T08:00:00'))
    expect(dayOf.map((d) => d.body)).toEqual(['Today · NT-0001 · iPhone 13 (Jane Doe)'])
  })

  it('catches up on recently missed reminders but not stale ones', () => {
    cal.createEvent(db, { title: 'Call supplier', date: '2026-10-10', startTime: '15:00' })
    expect(dueReminders(db, at('2026-10-10T19:00:00')).map((d) => d.body)).toEqual(['Today at 3:00 PM'])
    expect(dueReminders(db, at('2026-10-10T21:00:00'))).toHaveLength(0) // > 12h after 8 AM
  })

  it('moving an event re-arms its reminders; disabled or picked-up ones stay quiet', () => {
    const e = cal.createEvent(db, { title: 'X', date: '2026-10-10' })
    const [first] = dueReminders(db, at('2026-10-10T08:30:00'))
    markReminderFired(db, first.eventId, first.key)
    cal.updateEvent(db, e.id, { date: '2026-10-11' })
    expect(dueReminders(db, at('2026-10-10T09:30:00')).map((d) => d.key)).toEqual(['day_before@2026-10-11'])
    cal.updateEvent(db, e.id, { reminders: [] })
    expect(dueReminders(db, at('2026-10-10T09:30:00'))).toHaveLength(0)

    const t = ticketFor('Jane')
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-10', status: 'picked_up' })
    expect(dueReminders(db, at('2026-10-10T08:30:00'))).toHaveLength(0)
  })
})
