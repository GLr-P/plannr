import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as sports from '../../src/main/services/sports'
import type { SportsTeam } from '../../src/shared/api'

// Sports: following whole leagues or just favourite teams, games and scores, headlines (saved ESPN answers).
const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures/news', name), 'utf8')
const urls: string[] = []
const fetchText = async (url: string): Promise<string> => {
  urls.push(url)
  if (url.includes('/teams/26/schedule')) return fixture('espn-schedule.json')
  if (/\/schedule/.test(url)) return '{"events":[]}'
  if (url.includes('/mlb/teams')) return fixture('espn-mlb-teams.json')
  if (url.includes('/nhl/teams')) return fixture('espn-nhl-teams.json')
  if (url.includes('/nhl/scoreboard')) return fixture('espn-scoreboard.json')
  if (url.includes('/scoreboard')) return '{"events":[]}'
  if (url.includes('/mlb/news?team=19')) return fixture('espn-team-news.json')
  if (url.includes('/mlb/news')) return fixture('espn-news.json')
  if (url.includes('/news')) return '{"articles":[]}'
  throw new Error(`unexpected ${url}`)
}
// The saved answers are from 3 November 2026
const NOW = Date.parse('2026-11-03T22:00:00Z')

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  urls.length = 0
})

const team = async (league: string, abbr: string): Promise<SportsTeam> => (await sports.leagueTeams(league, fetchText)).find((t) => t.abbr === abbr)!

describe('sports', () => {
  it('lists a league’s teams with names and logos', async () => {
    const teams = await sports.leagueTeams('baseball/mlb', fetchText)
    expect(teams.length).toBe(30)
    const lad = teams.find((t) => t.abbr === 'LAD')!
    expect(lad).toMatchObject({ league: 'baseball/mlb', id: '19', name: 'Los Angeles Dodgers', short: 'Dodgers' })
    expect(lad.logo).toMatch(/^https:\/\/a\.espncdn\.com\//)
    await expect(sports.leagueTeams('curling/xyz', fetchText)).rejects.toThrow()
  })

  it('shows only a favourite team’s games when its league isn’t followed', async () => {
    const fla = await team('hockey/nhl', 'FLA')
    sports.setSportsPrefs(db, { leagues: [], teams: [fla] })
    const feed = await sports.refreshSports(db, fetchText, NOW)
    expect(urls.some((u) => u.includes('scoreboard'))).toBe(false)
    expect(feed.games.length).toBeGreaterThan(3)
    expect(feed.games.every((g) => g.mine && (g.home.abbr === 'FLA' || g.away.abbr === 'FLA'))).toBe(true)
    // Recent results with scores, upcoming games with a time and TV
    const done = feed.games.find((g) => g.state === 'post')!
    expect(done.home.score).toMatch(/^\d+$/)
    expect(done.detail).toMatch(/final/i)
    const next = feed.games.find((g) => g.state === 'pre')!
    expect(next.at).toBeGreaterThan(NOW)
    expect(next.detail).toBe('')
    expect(next.tv).toBeTruthy()
    expect(next.url).toMatch(/espn\.com\/nhl\/game/)
    // Sorted by start time; nothing older than three days
    expect(feed.games.map((g) => g.at)).toEqual([...feed.games.map((g) => g.at)].sort((a, b) => a - b))
    expect(feed.games.every((g) => g.at > NOW - 3 * 86_400_000)).toBe(true)
  })

  it('follows every game of a league, marking your team’s', async () => {
    const fla = await team('hockey/nhl', 'FLA')
    sports.setSportsPrefs(db, { leagues: ['hockey/nhl'], teams: [fla] })
    const feed = await sports.refreshSports(db, fetchText, NOW)
    expect(feed.games.some((g) => !g.mine && g.home.abbr === 'TOR')).toBe(true)
    expect(feed.games.some((g) => g.mine)).toBe(true)
    // The same game from the scoreboard and the team's schedule is listed once
    expect(new Set(feed.games.map((g) => g.id)).size).toBe(feed.games.length)
    expect(feed.games.every((g) => g.leagueName === 'NHL')).toBe(true)
  })

  it('a favourite team in an unfollowed sport: only its own headlines', async () => {
    const lad = await team('baseball/mlb', 'LAD')
    const feed = sports.setSportsPrefs(db, { leagues: [], teams: [lad] })
    expect(feed.prefs.teams).toHaveLength(1)
    const after = await sports.refreshSports(db, fetchText, NOW)
    const titles = after.news.map((n) => n.title)
    expect(titles).toContain('Dodgers executive Bob Wolfe shifting to advisory role')
    // League-wide roundups tag every team: left out
    expect(titles.some((t) => /Top 50 2026-27 MLB free agents/.test(t))).toBe(false)
    expect(after.news.every((n) => n.mine)).toBe(true)
    expect(urls.some((u) => /mlb\/news\?limit/.test(u))).toBe(false)
  })

  it('a followed league brings its top headlines, newest first', async () => {
    sports.setSportsPrefs(db, { leagues: ['baseball/mlb'], teams: [] })
    const feed = await sports.refreshSports(db, fetchText, NOW)
    expect(feed.news.length).toBeGreaterThan(3)
    expect(feed.news[0].publishedAt).toBeGreaterThanOrEqual(feed.news[1].publishedAt)
    expect(feed.news[0].url).toMatch(/^https:\/\/www\.espn\.com\//)
    // Unfollowing hides it at once, without downloading again
    expect(sports.setSportsPrefs(db, { leagues: [], teams: [] }).news).toHaveLength(0)
  })

  it('keeps the last download when offline, and knows when it’s due', async () => {
    const fla = await team('hockey/nhl', 'FLA')
    sports.setSportsPrefs(db, { leagues: [], teams: [fla] })
    expect(sports.sportsStale(db, NOW)).toBe(true)
    const first = await sports.refreshSports(db, fetchText, NOW)
    expect(sports.sportsStale(db, NOW + 60_000)).toBe(false)
    expect(sports.sportsStale(db, NOW + 16 * 60_000)).toBe(true)
    const offline = await sports.refreshSports(db, async () => Promise.reject(new Error('offline')), NOW + 60_000)
    expect(offline.games).toEqual(first.games)
    expect(offline.errors).toEqual(['Florida Panthers'])
  })

  it('ignores unknown leagues and duplicate teams; prefs sync', async () => {
    const fla = await team('hockey/nhl', 'FLA')
    const feed = sports.setSportsPrefs(db, { leagues: ['hockey/nhl', 'nope/x', 'hockey/nhl'], teams: [fla, fla, { ...fla, league: 'nope/x' }] })
    expect(feed.prefs).toEqual({ leagues: ['hockey/nhl'], teams: [fla] })
    const dirty = db.prepare("SELECT id FROM sync_dirty WHERE tbl = 'settings' AND id = 'sports.prefs'").all()
    expect(dirty).toHaveLength(1)
  })
})
