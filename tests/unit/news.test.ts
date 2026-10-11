import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as news from '../../src/main/services/news'
import { findWhen, findTimes } from '../../src/shared/news-dates'
import type { NewsSource } from '../../src/shared/api'

// Real feeds and pages, saved (trimmed) so tests never need the internet
const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures/news', name), 'utf8')

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

const source = (kind: NewsSource['kind'], url: string, name: string = kind): NewsSource => ({ id: `s-${kind}`, kind, name, url, enabled: true })

/** Answers downloads from the saved copies */
const fakeFetch: news.FetchText = async (url) => {
  if (url.includes('castanet')) return fixture('castanet.xml')
  if (url.includes('news.google')) return fixture('google.xml')
  if (url.includes('open511')) return fixture('roads.json')
  if (url.includes('weather.gc.ca')) return fixture('weather.xml')
  if (url.includes('geocoding')) return fixture('geocode.json')
  if (url.includes('osoyoos.ca')) return fixture('town-news.html')
  throw new Error(`offline: ${url}`)
}

describe('reading sources', () => {
  it('reads a real RSS feed (Castanet): titles, links, dates, summaries and photos', () => {
    const items = news.parseFeed(fixture('castanet.xml'))
    expect(items).toHaveLength(5)
    const first = items[0]
    expect(first.title).toBe('Osoyoos community groups could receive $11,200 in grant funding')
    expect(first.url).toMatch(/^https:\/\/www\.castanet\.net\/news\/Oliver-Osoyoos\/634097\//)
    expect(first.image).toMatch(/\.jpg$/)
    expect(first.publishedAt).toBe(Date.parse('2026-10-11T14:43:00-07:00'))
    expect(first.summary).toMatch(/^Three Osoyoos community groups/)
    expect(items.every((i) => !i.summary.includes('&quot;') && !i.summary.includes('<'))).toBe(true)
  })

  it('reads Google News (no repeated headline as the summary)', () => {
    const items = news.parseFeed(fixture('google.xml'))
    expect(items.length).toBeGreaterThan(2)
    expect(items[0].url).toMatch(/^https:\/\/news\.google\.com\//)
    expect(items.every((i) => i.summary === '')).toBe(true)
  })

  it('reads a news web page that has no feed (Town of Osoyoos)', () => {
    const items = news.parsePage(fixture('town-news.html'), 'https://www.osoyoos.ca/community/news-alerts')
    const titles = items.map((i) => i.title)
    expect(titles).toContain('Second Advance Voting - Today')
    expect(titles).toContain('Water Quality Advisory')
    const voting = items.find((i) => i.title === 'Second Advance Voting - Today')!
    expect(voting.url).toBe('https://www.osoyoos.ca/community/news-alerts/second-advance-voting-today')
    expect(voting.publishedAt).toBe(Date.parse('2026-10-10T12:00:00Z'))
    expect(voting.summary).toMatch(/Sonora Community Centre/)
    expect(new Set(items.map((i) => i.url)).size).toBe(items.length) // each story once
    expect(titles.some((t) => /menu|navigation/i.test(t))).toBe(false)
  })

  it('reads DriveBC road events', () => {
    const [road] = news.parseRoads(fixture('roads.json'))
    expect(road.title).toMatch(/: Construction – Mowing from Highway 97/)
    expect(road.summary).not.toMatch(/Last update/)
    expect(road.severe).toBe(false)
  })

  it('reads Environment Canada weather: now, forecast, and warnings only when there are some', () => {
    const w = news.parseEcWeather(fixture('weather.xml'))
    expect(w.place).toBe('Osoyoos')
    expect(w.temp).toBe(14)
    expect(w.forecast[0].label).toBe('Sunday night')
    expect(w.forecast[0].text).toMatch(/Clear/)
    expect(w.warnings).toEqual([])
    const warned = fixture('weather.xml').replace('No watches or warnings in effect, Osoyoos', 'SPECIAL WEATHER STATEMENT IN EFFECT')
    expect(news.parseEcWeather(warned).warnings[0].title).toBe('SPECIAL WEATHER STATEMENT IN EFFECT')
  })
})

describe('when things happen', () => {
  const sun = new Date('2026-10-11T10:00:00')
  it('finds named dates and times', () => {
    expect(findWhen('Voting day is Saturday, Oct. 17 from 8 a.m. to 8 p.m. at Sonora Centre.', sun)).toEqual({ date: '2026-10-17', startTime: '08:00', endTime: '20:00' })
    expect(findWhen('The craft fair runs November 21st, 10am–3pm.', sun)).toEqual({ date: '2026-11-21', startTime: '10:00', endTime: '15:00' })
    expect(findWhen('Light-up is Dec 5 at 6:30 p.m.', sun)).toEqual({ date: '2026-12-05', startTime: '18:30', endTime: null })
    expect(findWhen('Join us on 3 January for the polar dip', sun)?.date).toBe('2027-01-03') // next year
    expect(findTimes('Doors 7-9 p.m.')).toEqual({ startTime: '19:00', endTime: '21:00' })
    expect(findTimes('From 11 to 1 pm')).toEqual({ startTime: '11:00', endTime: '13:00' })
  })
  it('reads "this Saturday", "tomorrow" and "today"', () => {
    expect(findWhen('The market returns this Saturday', sun)?.date).toBe('2026-10-17')
    expect(findWhen('Road paving starts tomorrow', sun)?.date).toBe('2026-10-12')
    expect(findWhen('Second advance voting - today', sun)?.date).toBe('2026-10-11')
  })
  it('ignores stories about the past', () => {
    expect(findWhen('The open house on Oct. 3 drew 70 visitors', sun)).toBeNull()
    expect(findWhen('Firefighters visited the school last week', sun)).toBeNull()
    expect(findWhen('The fire crews held drills Sunday', sun)).toBeNull() // a weekday on its own isn't enough
  })
})

describe('topics', () => {
  it('sorts stories into topics; sad news and markets are recognised', () => {
    expect(news.topicOf('Water Quality Advisory remains in effect', 'page')).toBe('alerts')
    expect(news.topicOf('Advance voting day two totals', 'page')).toBe('civic')
    expect(news.topicOf('Fall craft fair this weekend', 'rss')).toBe('events')
    expect(news.topicOf('Man dies after crash on Highway 3', 'rss')).toBe('sad')
    expect(news.topicOf('TSX closes higher as oil prices rise', 'rss')).toBe('markets')
    expect(news.topicOf('Local photographer captures aurora', 'rss')).toBe('community')
    expect(news.topicOf('anything', 'roads')).toBe('alerts')
  })
})

describe('the feed', () => {
  it('downloads every source, leaves out hidden topics, and drops Google copies of the same story', async () => {
    const sources = [source('rss', 'https://www.castanet.net/rss/page-87.xml', 'Castanet'), source('page', 'https://www.osoyoos.ca/community/news-alerts', 'Town of Osoyoos')]
    sources.push({ ...source('rss', 'https://news.google.com/rss/search?q=Osoyoos', 'Google News'), id: 's-google' })
    sources.push(source('weather', 'https://weather.gc.ca/rss/weather/49.03_-119.46_e.xml', 'Weather'))
    sources.push(source('roads', 'https://api.open511.gov.bc.ca/events?bbox=1', 'Roads'))
    news.configureNews(db, { sources })
    const now = Date.parse('2026-10-11T16:00:00-07:00')
    const { feed } = await news.refreshNews(db, fakeFetch, now)
    expect(feed.errors).toEqual([])
    expect(feed.weather?.temp).toBe(14)
    // Castanet and Google both have this story: it shows once, from Castanet
    const grants = feed.items.filter((i) => /grant funding/.test(i.title))
    expect(grants).toHaveLength(1)
    expect(grants[0].sourceName).toBe('Castanet')
    const voting = feed.items.find((i) => i.title === 'Second Advance Voting - Today')!
    expect(voting.topic).toBe('civic')
    expect(voting.important).toBe(false) // voting was yesterday: no longer need-to-know
    expect(voting.when).toBeNull()
    const closed = feed.items.find((i) => i.title === 'Holiday Hours')!
    expect(closed).toMatchObject({ topic: 'alerts', important: true }) // facilities closed tomorrow
    expect(closed.when?.date).toBe('2026-10-12')
    expect(feed.items.find((i) => i.sourceKind === 'roads')?.when).toBeNull() // road work's end date isn't an event
    expect(feed.items.some((i) => i.sourceKind === 'roads')).toBe(true)

    // Mute a word: those stories are kept but marked as left out
    news.configureNews(db, { prefs: { muted: ['aurora'] } })
    const muted = news.newsFeed(db, now).items.find((i) => /aurora/i.test(i.title))
    expect(muted?.filtered).toBe(true)
    // Boost a word: it goes to Need to know (even if muted)
    news.configureNews(db, { prefs: { boost: ['aurora'] } })
    expect(news.newsFeed(db, now).items.find((i) => /aurora/i.test(i.title))).toMatchObject({ important: true, filtered: false })
  })

  it('keeps read/saved/hidden marks when a story is downloaded again, and clears old stories', async () => {
    news.configureNews(db, { sources: [source('rss', 'https://www.castanet.net/rss/page-87.xml', 'Castanet')] })
    const now = Date.parse('2026-10-11T16:00:00-07:00')
    let { feed } = await news.refreshNews(db, fakeFetch, now)
    const [a, b, c] = feed.items
    news.markNews(db, a.id, { saved: true })
    news.markNews(db, b.id, { hidden: true })
    news.markNews(db, c.id, { read: true, eventId: 'event-1' })
    ;({ feed } = await news.refreshNews(db, fakeFetch, now + 60_000))
    expect(feed.items.find((i) => i.id === a.id)?.saved).toBe(true)
    expect(feed.items.find((i) => i.id === b.id)).toBeUndefined()
    expect(feed.items.find((i) => i.id === c.id)).toMatchObject({ read: true, eventId: 'event-1' })
    // Two months later (and the feed no longer has them): only the saved one and the one on the calendar stay
    const later = now + 60 * 86_400_000
    const empty: news.FetchText = async () => '<rss><channel></channel></rss>'
    ;({ feed } = await news.refreshNews(db, empty, later))
    expect(feed.items.map((i) => i.id).sort()).toEqual([a.id, c.id].sort())
  })

  it('announces each urgent story once', async () => {
    news.configureNews(db, { sources: [source('page', 'https://www.osoyoos.ca/community/news-alerts', 'Town')] })
    const now = Date.parse('2026-10-10T09:00:00-07:00') // the morning of advance voting
    const first = await news.refreshNews(db, fakeFetch, now)
    expect(first.urgent.map((i) => i.title)).toContain('Second Advance Voting - Today')
    const second = await news.refreshNews(db, fakeFetch, now + 600_000)
    expect(second.urgent).toEqual([])
  })

  it('removing a source removes its stories', async () => {
    news.configureNews(db, { sources: [source('rss', 'https://www.castanet.net/rss/page-87.xml')] })
    await news.refreshNews(db, fakeFetch)
    news.configureNews(db, { sources: [] })
    expect(news.newsFeed(db).items).toEqual([])
  })
})

describe('setting up', () => {
  it('finds a place and suggests local sources', async () => {
    const [place] = await news.findPlace('Osoyoos', fakeFetch)
    expect(place).toMatchObject({ name: 'Osoyoos', region: 'British Columbia', countryCode: 'CA' })
    const suggested = news.suggestSources(place)
    const kinds = suggested.map((s) => s.kind)
    expect(kinds).toEqual(expect.arrayContaining(['rss', 'weather', 'roads']))
    expect(suggested.find((s) => s.kind === 'weather')?.url).toBe('https://weather.gc.ca/rss/weather/49.03_-119.45_e.xml')
    expect(suggested.map((s) => s.name)).toContain('Castanet – Oliver / Osoyoos')
    // Somewhere else: no BC roads or Okanagan news, and the weather comes from Open-Meteo
    const elsewhere = news.suggestSources({ name: 'Bath', region: 'England', country: 'United Kingdom', countryCode: 'GB', lat: 51.38, lon: -2.36 })
    expect(elsewhere.map((s) => s.kind)).toEqual(['rss', 'weather'])
    expect(elsewhere[1].url).toMatch(/open-meteo/)
  })

  it('works out what a pasted link is', async () => {
    expect((await news.detectSource('https://www.facebook.com/profile.php?id=61584567862257', fakeFetch)).kind).toBe('facebook')
    expect(await news.detectSource('castanet.net/rss/page-87.xml', fakeFetch)).toMatchObject({ kind: 'rss', name: 'Castanet.net - Oliver/Osoyoos' })
    expect(await news.detectSource('https://www.osoyoos.ca/community/news-alerts', fakeFetch)).toMatchObject({ kind: 'page', name: 'Osoyoos – News' })
  })
})
