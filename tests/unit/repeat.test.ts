import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as cal from '../../src/main/services/calendar'
import { dueReminders } from '../../src/main/services/reminders'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('repeating events', () => {
  it('works out the dates: daily, weekly, monthly (skipping months without that day), yearly (29 Feb)', () => {
    expect(cal.occurrenceDates('2026-10-30', 'daily', null, '2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(cal.occurrenceDates('2026-10-06', 'weekly', '2026-10-27', '2026-10-01', '2026-12-31')).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'])
    expect(cal.occurrenceDates('2026-01-31', 'monthly', null, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
    expect(cal.occurrenceDates('2024-02-29', 'yearly', null, '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2028-02-29'])
    expect(cal.occurrenceDates('2026-10-06', 'weekly', null, '2026-10-01', '2026-10-31', ['2026-10-13'])).toEqual(['2026-10-06', '2026-10-20', '2026-10-27'])
  })

  it('the calendar shows each occurrence; skipping one leaves the rest; stopping the repeat leaves the first', () => {
    const ev = cal.createEvent(db, { title: 'Supplier call', date: '2026-10-05' })
    cal.updateEvent(db, ev.id, { repeat: 'weekly' })
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31').map((e) => e.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(cal.listEvents(db, '2027-03-01', '2027-03-07').map((e) => e.date)).toEqual(['2027-03-01']) // forever
    cal.skipOccurrence(db, ev.id, '2026-10-12')
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31')).toHaveLength(3)
    cal.updateEvent(db, ev.id, { repeat: '' })
    expect(cal.listEvents(db, '2026-10-01', '2026-10-31').map((e) => e.date)).toEqual(['2026-10-05'])
  })

  it('each occurrence gets its own reminders', () => {
    const ev = cal.createEvent(db, { title: 'Bins out', date: '2026-10-05', reminders: ['day_of'] })
    cal.updateEvent(db, ev.id, { repeat: 'weekly' })
    expect(dueReminders(db, new Date(2026, 9, 12, 8, 30)).map((r) => [r.title, r.date])).toEqual([['Bins out', '2026-10-12']])
  })
})
