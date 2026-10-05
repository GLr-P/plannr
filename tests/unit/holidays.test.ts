import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as holidays from '../../src/main/services/holidays'

const FEED = readFileSync(join(__dirname, '../fixtures/us-holidays.ics'), 'utf8') // real Google feed, saved

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('iCalendar parsing', () => {
  it('reads Google’s real US holiday feed', () => {
    const items = holidays.parseIcs(FEED)
    expect(items.length).toBeGreaterThan(200)
    expect(items).toContainEqual(expect.objectContaining({ date: '2026-11-26', title: 'Thanksgiving Day', observance: false }))
    expect(items.find((h) => h.title === 'Daylight Saving Time starts')?.observance).toBe(true)
  })

  it('handles folded lines, escapes and timed starts', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261225',
      'SUMMARY:Christmas\\, Day',
      'UID:a1',
      'DESCRIPTION:Public',
      '  holiday',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260101T000000Z',
      'SUMMARY:New Year',
      'UID:a2',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'SUMMARY:No date',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(holidays.parseIcs(ics)).toEqual([
      { uid: 'a1', date: '2026-12-25', title: 'Christmas, Day', observance: false },
      { uid: 'a2', date: '2026-01-01', title: 'New Year', observance: false }
    ])
  })
})

describe('holiday storage and settings', () => {
  it('defaults to United States, refreshes, lists by range and hides observances on request', async () => {
    expect(holidays.holidayRegion(db)).toBe('en.usa')
    expect(holidays.holidaysStale(db)).toBe(true)
    let requested = ''
    const status = await holidays.refreshHolidays(db, async (url) => {
      requested = url
      return FEED
    })
    expect(requested).toBe('https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics')
    expect(status).toMatchObject({ region: 'en.usa', error: null })
    expect(status.count).toBeGreaterThan(200)
    expect(holidays.holidaysStale(db)).toBe(false)

    const nov = holidays.listHolidays(db, '2026-11-01', '2026-11-30').map((h) => h.title)
    expect(nov).toContain('Thanksgiving Day')
    const march = () => holidays.listHolidays(db, '2026-03-01', '2026-03-31').map((h) => h.title)
    expect(march()).toContain('Daylight Saving Time starts')
    holidays.setHolidayPrefs(db, { showObservances: false })
    expect(march()).not.toContain('Daylight Saving Time starts')
  })

  it('turning holidays off hides them; a new region needs a download', async () => {
    await holidays.refreshHolidays(db, async () => FEED)
    holidays.setHolidayPrefs(db, { region: null })
    expect(holidays.holidayRegion(db)).toBeNull()
    expect(holidays.listHolidays(db, '2026-01-01', '2026-12-31')).toEqual([])
    holidays.setHolidayPrefs(db, { region: 'en.uk' })
    expect(holidays.holidaysStale(db)).toBe(true)
    holidays.setHolidayPrefs(db, { region: 'nonsense' })
    expect(holidays.holidayRegion(db)).toBeNull()
  })

  it('keeps old holidays and reports the problem when a download fails', async () => {
    await holidays.refreshHolidays(db, async () => FEED)
    const status = await holidays.refreshHolidays(db, async () => {
      throw new Error('offline')
    })
    expect(status.error).toMatch(/offline/)
    expect(holidays.listHolidays(db, '2026-11-01', '2026-11-30').length).toBeGreaterThan(0)
    expect((await holidays.refreshHolidays(db, async () => FEED)).error).toBeNull()
  })
})
