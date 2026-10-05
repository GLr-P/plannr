import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as cal from '../../src/main/services/calendar'
import * as tickets from '../../src/main/services/tickets'
import * as customers from '../../src/main/services/customers'
import {
  clearGoogleData,
  fromGoogleTimes,
  GoogleHttpError,
  listGoogleEvents,
  setSelectedCalendars,
  syncGoogle,
  type GCalendar,
  type GEvent,
  type GoogleApi
} from '../../src/main/services/google'

/** In-memory stand-in for the Google Calendar API (the parts Plannr uses). */
class FakeGoogle implements GoogleApi {
  calendars: GCalendar[] = [
    { id: 'primary-cal', summary: 'me@gmail.com', primary: true, accessRole: 'owner', backgroundColor: '#4285f4' },
    { id: 'family-cal', summary: 'Family', accessRole: 'reader', backgroundColor: '#e67c73' }
  ]
  events = new Map<string, GEvent[]>([
    ['primary-cal', []],
    ['family-cal', []]
  ])
  private seq = 0
  private clock = Date.now() // Google stamps changes with (its) real time
  calls: string[] = []

  tick(): string {
    this.clock = Math.max(Date.now(), this.clock + 1)
    return new Date(this.clock).toISOString()
  }
  list(cal: string): GEvent[] {
    return this.events.get(cal) ?? []
  }
  async listCalendars() {
    return this.calendars
  }
  async createCalendar(summary: string) {
    const c = { id: `cal-${++this.seq}`, summary, accessRole: 'owner' }
    this.calendars.push(c)
    this.events.set(c.id, [])
    this.calls.push('createCalendar')
    return c
  }
  async listEvents(calendarId: string, params: Record<string, string>) {
    let items = this.list(calendarId)
    if (params.updatedMin) items = items.filter((e) => Date.parse(e.updated!) >= Date.parse(params.updatedMin))
    if (params.showDeleted !== 'true') items = items.filter((e) => e.status !== 'cancelled')
    return items.map((e) => structuredClone(e))
  }
  async insertEvent(calendarId: string, body: Partial<GEvent>) {
    const e: GEvent = { ...structuredClone(body), id: `g-${++this.seq}`, status: 'confirmed', updated: this.tick(), htmlLink: 'https://calendar.google.com/x' }
    this.list(calendarId).push(e)
    this.calls.push('insert')
    return e
  }
  async patchEvent(calendarId: string, eventId: string, body: Partial<GEvent>) {
    const e = this.list(calendarId).find((x) => x.id === eventId && x.status !== 'cancelled')
    if (!e) throw new GoogleHttpError(404, 'Not Found')
    Object.assign(e, structuredClone(body), { updated: this.tick() })
    this.calls.push('patch')
    return e
  }
  async deleteEvent(calendarId: string, eventId: string) {
    const e = this.list(calendarId).find((x) => x.id === eventId)
    if (!e || e.status === 'cancelled') throw new GoogleHttpError(410, 'Gone')
    e.status = 'cancelled'
    e.updated = this.tick()
    this.calls.push('delete')
  }
  /** Simulates editing in the Google Calendar app. */
  editInGoogle(calendarId: string, eventId: string, patch: Partial<GEvent>) {
    Object.assign(this.list(calendarId).find((x) => x.id === eventId)!, patch, { updated: this.tick() })
  }
  addInGoogle(calendarId: string, e: Partial<GEvent>) {
    const ev: GEvent = { id: `g-${++this.seq}`, status: 'confirmed', updated: this.tick(), ...e }
    this.list(calendarId).push(ev)
    return ev
  }
}

const TZ = 'America/New_York'
let db: Db
let google: FakeGoogle
const sync = () => syncGoogle(db, google, { timeZone: TZ, today: new Date(2026, 9, 4) })
const plannrCal = () => google.calendars.find((c) => c.summary === 'Plannr')!.id
// Google stamps edits with its own clock; make local edits look newer when a test needs that
const later = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  google = new FakeGoogle()
})

describe('time conversion', () => {
  it('reads all-day and timed events in local time', () => {
    expect(fromGoogleTimes({ date: '2026-10-10' }, { date: '2026-10-11' })).toEqual({ date: '2026-10-10', endDate: null, startTime: null, endTime: null })
    expect(fromGoogleTimes({ date: '2026-10-10' }, { date: '2026-10-13' })).toEqual({ date: '2026-10-10', endDate: '2026-10-12', startTime: null, endTime: null })
    const local = new Date(2026, 9, 10, 14, 30)
    const r = fromGoogleTimes({ dateTime: local.toISOString() }, { dateTime: new Date(2026, 9, 10, 15, 0).toISOString() })
    expect(r).toEqual({ date: '2026-10-10', endDate: null, startTime: '14:30', endTime: '15:00' })
    expect(fromGoogleTimes({}, {})).toBeNull()
  })
})

describe('Plannr → Google', () => {
  it('creates a "Plannr" calendar once and uploads events (all-day and timed)', async () => {
    cal.createEvent(db, { title: 'Order parts', date: '2026-10-10' })
    cal.createEvent(db, { title: 'Call supplier', date: '2026-10-11', startTime: '09:30', notes: 'Ask about OLED' })
    const r = await sync()
    expect(r.pushed).toBe(2)
    const items = google.list(plannrCal())
    expect(items.map((e) => [e.summary, e.start])).toEqual([
      ['Order parts', { date: '2026-10-10' }],
      ['Call supplier', { dateTime: '2026-10-11T09:30:00', timeZone: TZ }]
    ])
    expect(items[1].end).toEqual({ dateTime: '2026-10-11T10:30:00', timeZone: TZ }) // default 1 hour
    expect(items[1].description).toBe('Ask about OLED\n\n— From Plannr')
    expect(items[0].extendedProperties?.private?.plannrId).toBeTruthy()
    await sync() // nothing changed: no new calendar, no re-upload
    expect(google.calls.filter((c) => c === 'createCalendar')).toHaveLength(1)
    expect(google.calls.filter((c) => c === 'insert')).toHaveLength(2)
  })

  it('pushes edits and deletes; ticket pickups carry the ticket in the description', async () => {
    const c = customers.createCustomer(db, { name: 'Jane Doe' })
    const t = tickets.createTicket(db, { customerId: c.id, templateId: null })
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-12' })
    const plain = cal.createEvent(db, { title: 'Dentist', date: '2026-10-13' })
    await sync()
    const pickupG = google.list(plannrCal()).find((e) => e.summary === 'Jane Doe pickup')!
    expect(pickupG.description).toBe('— From Plannr: T-0001 (Jane Doe)')

    await later()
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-14' }) // moving the pickup on the ticket
    cal.removeEvent(db, plain.id)
    await sync()
    expect(pickupG.start).toEqual({ date: '2026-10-14' })
    expect(google.list(plannrCal()).find((e) => e.summary === 'Dentist')!.status).toBe('cancelled')
  })

  it('a trashed ticket removes its pickup from Google; restoring brings it back', async () => {
    const t = tickets.createTicket(db, { templateId: null })
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-12' })
    await sync()
    await later()
    tickets.trashTicket(db, t.id)
    db.prepare('UPDATE events SET updated_at = ? WHERE link_id = ?').run(Date.now(), t.id) // trashing touches its pickup
    await sync()
    expect(google.list(plannrCal()).filter((e) => e.status !== 'cancelled')).toHaveLength(0)
  })

  it('recreates an event that was deleted in Google while Plannr also edited it', async () => {
    const ev = cal.createEvent(db, { title: 'Meeting', date: '2026-10-10' })
    await sync()
    const g = google.list(plannrCal())[0]
    g.status = 'cancelled' // gone from Google without Plannr knowing yet (and older than the next edit)
    g.updated = '2000-01-01T00:00:00Z'
    await later()
    cal.updateEvent(db, ev.id, { title: 'Meeting (moved)' })
    await sync()
    expect(google.list(plannrCal()).filter((e) => e.status !== 'cancelled').map((e) => e.summary)).toEqual(['Meeting (moved)'])
  })
})

describe('Google → Plannr', () => {
  it('applies edits and deletions made in Google; a moved pickup moves the ticket', async () => {
    const t = tickets.createTicket(db, { templateId: null })
    tickets.updateTicket(db, t.id, { pickupOn: '2026-10-12' })
    const ev = cal.createEvent(db, { title: 'Order parts', date: '2026-10-10' })
    await sync()
    const cid = plannrCal()
    const pickupG = google.list(cid).find((e) => e.summary?.includes('pickup'))!
    const orderG = google.list(cid).find((e) => e.summary === 'Order parts')!

    google.editInGoogle(cid, pickupG.id, { start: { date: '2026-10-15' }, end: { date: '2026-10-16' } })
    google.editInGoogle(cid, orderG.id, { summary: 'Order screens', description: 'From phone\n\n— From Plannr' })
    await sync()
    expect(tickets.getTicket(db, t.id)!.pickupOn).toBe('2026-10-15')
    expect(cal.getEvent(db, ev.id)).toMatchObject({ title: 'Order screens', notes: 'From phone' })

    await google.deleteEvent(cid, orderG.id)
    await sync()
    expect(cal.getEvent(db, ev.id)).toBeNull()
    const pushesBefore = google.calls.length
    await sync() // the pulled changes aren't echoed back to Google
    expect(google.calls.length).toBe(pushesBefore)
  })

  it('events created in Google on the Plannr calendar appear in Plannr', async () => {
    await sync()
    google.addInGoogle(plannrCal(), { summary: 'Added on phone', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })
    await sync()
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31').map((e) => e.title)).toEqual(['Added on phone'])
  })

  it('when both sides changed, the most recent edit wins', async () => {
    const ev = cal.createEvent(db, { title: 'Original', date: '2026-10-10' })
    await sync()
    const g = google.list(plannrCal())[0]
    google.editInGoogle(plannrCal(), g.id, { summary: 'Edited in Google', updated: '2000-01-01T00:00:00Z' }) // older edit
    g.updated = '2000-01-01T00:00:00Z'
    await later()
    cal.updateEvent(db, ev.id, { title: 'Edited in Plannr' }) // newer
    await sync()
    expect(cal.getEvent(db, ev.id)!.title).toBe('Edited in Plannr')
    expect(g.summary).toBe('Edited in Plannr')
  })
})

describe('other Google calendars (read-only)', () => {
  it('shows the main calendar by default, and chosen ones after that', async () => {
    google.addInGoogle('primary-cal', { summary: 'Dinner', start: { dateTime: new Date(2026, 9, 10, 19).toISOString() }, end: { dateTime: new Date(2026, 9, 10, 21).toISOString() }, htmlLink: 'https://g/1' })
    google.addInGoogle('family-cal', { summary: 'Soccer', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } })
    google.addInGoogle('primary-cal', { summary: 'Cancelled thing', status: 'cancelled', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } })
    await sync()
    expect(listGoogleEvents(db, '2026-10-01', '2026-10-31').map((e) => [e.title, e.startTime, e.calendarName, e.color])).toEqual([
      ['Dinner', '19:00', 'me@gmail.com', '#4285f4']
    ])
    setSelectedCalendars(db, ['primary-cal', 'family-cal'])
    await sync()
    expect(listGoogleEvents(db, '2026-10-01', '2026-10-31').map((e) => e.title)).toEqual(['Dinner', 'Soccer'])
    setSelectedCalendars(db, ['family-cal'])
    expect(listGoogleEvents(db, '2026-10-01', '2026-10-31').map((e) => e.title)).toEqual(['Soccer'])
  })

  it('multi-day events show on every day they cover', async () => {
    google.addInGoogle('primary-cal', { summary: 'Vacation', start: { date: '2026-10-20' }, end: { date: '2026-10-25' } })
    await sync()
    expect(listGoogleEvents(db, '2026-10-22', '2026-10-22').map((e) => [e.title, e.endDate])).toEqual([['Vacation', '2026-10-24']])
  })
})

describe('errors and disconnect', () => {
  it('records sync errors and clears them on success', async () => {
    const broken = Object.assign(new FakeGoogle(), { listCalendars: async () => { throw new Error('offline') } })
    await expect(syncGoogle(db, broken, { timeZone: TZ })).rejects.toThrow('offline')
    expect(db.prepare("SELECT value FROM settings WHERE key = 'google.error'").get()).toEqual({ value: '"offline"' })
    await sync()
    expect(db.prepare("SELECT value FROM settings WHERE key = 'google.error'").get()).toEqual({ value: 'null' })
  })

  it('disconnecting forgets Google ids; reconnecting uploads again without duplicating', async () => {
    cal.createEvent(db, { title: 'Keep', date: '2026-10-10' })
    await sync()
    clearGoogleData(db)
    expect(listGoogleEvents(db, '2026-01-01', '2026-12-31')).toEqual([])
    await sync() // finds the existing "Plannr" calendar by name
    expect(google.calls.filter((c) => c === 'createCalendar')).toHaveLength(1)
  })
})
