import type { Db } from '../db'
import { tx } from '../db'
import { DEFAULT_HOLIDAY_REGION, HOLIDAY_REGIONS, type Holiday, type HolidayStatus } from '../../shared/api'
import { getSetting, setSetting } from './settings'

export interface ParsedHoliday {
  uid: string
  date: string
  title: string
  observance: boolean
}

const REGION_IDS = new Set<string>(HOLIDAY_REGIONS.map((r) => r.id))

export const holidayFeedUrl = (region: string): string =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(`${region}#holiday@group.v.calendar.google.com`)}/public/basic.ics`

const unescapeIcs = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/** Parses all-day VEVENTs from an iCalendar (.ics) file. */
export function parseIcs(text: string): ParsedHoliday[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '') // long lines continue on lines starting with a space
  const out: ParsedHoliday[] = []
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0]
    const field = (name: string): string | undefined => {
      const m = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm').exec(body)
      return m ? unescapeIcs(m[1].trim()) : undefined
    }
    const start = field('DTSTART')
    const summary = field('SUMMARY')
    const m = start && /^(\d{4})(\d{2})(\d{2})/.exec(start)
    if (!m || !summary) continue
    out.push({
      uid: field('UID') ?? `${m[0]}-${summary}`,
      date: `${m[1]}-${m[2]}-${m[3]}`,
      title: summary,
      observance: /^observance/i.test(field('DESCRIPTION') ?? '')
    })
  }
  return out
}

export function replaceHolidays(db: Db, region: string, items: ParsedHoliday[]): void {
  tx(db, () => {
    db.prepare('DELETE FROM holidays WHERE region = ?').run(region)
    const insert = db.prepare('INSERT OR REPLACE INTO holidays (region, uid, date, title, observance) VALUES (?, ?, ?, ?, ?)')
    for (const h of items) insert.run(region, h.uid, h.date, h.title, h.observance ? 1 : 0)
  })
}

/** The chosen region; holidays are on (United States) until turned off. */
export function holidayRegion(db: Db): string | null {
  const saved = getSetting(db, 'holidayRegion')
  if (saved === null) return DEFAULT_HOLIDAY_REGION
  return saved === 'off' || typeof saved !== 'string' || !REGION_IDS.has(saved) ? null : saved
}

export function listHolidays(db: Db, from: string, to: string): Holiday[] {
  const region = holidayRegion(db)
  if (!region) return []
  const showObservances = getSetting(db, 'holidayObservances') !== false
  const rows = db
    .prepare(
      `SELECT uid, date, title, observance FROM holidays
       WHERE region = ? AND date BETWEEN ? AND ? ${showObservances ? '' : 'AND observance = 0'} ORDER BY date, title`
    )
    .all(region, from, to) as { uid: string; date: string; title: string; observance: number }[]
  return rows.map((r) => ({ id: `holiday:${r.uid}`, date: r.date, title: r.title, observance: r.observance === 1 }))
}

export function holidayStatus(db: Db): HolidayStatus {
  const region = holidayRegion(db)
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM holidays WHERE region = ?').get(region ?? '') as { count: number }
  const fetched = getSetting(db, 'holidaysFetched') as { region: string; at: number } | null
  return {
    region,
    showObservances: getSetting(db, 'holidayObservances') !== false,
    count,
    fetchedAt: fetched?.region === region ? fetched.at : null,
    error: (getSetting(db, 'holidaysError') as string | null) ?? null
  }
}

export function setHolidayPrefs(db: Db, opts: { region?: string | null; showObservances?: boolean }): void {
  if (opts.region !== undefined) setSetting(db, 'holidayRegion', opts.region && REGION_IDS.has(opts.region) ? opts.region : 'off')
  if (opts.showObservances !== undefined) setSetting(db, 'holidayObservances', opts.showObservances)
}

/** True when the region's holidays were never downloaded or are over a week old. */
export function holidaysStale(db: Db, now = Date.now()): boolean {
  const region = holidayRegion(db)
  if (!region) return false
  const fetched = getSetting(db, 'holidaysFetched') as { region: string; at: number } | null
  return !fetched || fetched.region !== region || now - fetched.at > 7 * 86_400_000
}

/** Downloads and stores the chosen region's holidays. `fetchText` is injected (Electron's net.fetch in the app). */
export async function refreshHolidays(db: Db, fetchText: (url: string) => Promise<string>): Promise<HolidayStatus> {
  const region = holidayRegion(db)
  if (!region) return holidayStatus(db)
  try {
    const items = parseIcs(await fetchText(holidayFeedUrl(region)))
    if (items.length === 0) throw new Error('No holidays found in the download')
    replaceHolidays(db, region, items)
    setSetting(db, 'holidaysFetched', { region, at: Date.now() })
    setSetting(db, 'holidaysError', null)
  } catch (err) {
    // Keep whatever was downloaded before; show the problem in Settings.
    setSetting(db, 'holidaysError', `Couldn’t update holidays (${err instanceof Error ? err.message : String(err)}). Will retry later.`)
  }
  return holidayStatus(db)
}
