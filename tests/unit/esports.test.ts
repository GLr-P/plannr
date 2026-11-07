import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as esports from '../../src/main/services/esports'

// Match objects shaped like PandaScore's documented answers (the free plan's /matches/upcoming, running and past)
const NOW = Date.parse('2026-11-07T20:00:00Z')
const team = (id: number, name: string, acronym: string) => ({ type: 'Team', opponent: { id, name, acronym, image_url: `https://cdn.pandascore.co/images/team/image/${id}/x.png` } })
const match = (over: Record<string, unknown>) => ({
  id: 1,
  name: 'G2 vs FaZe',
  begin_at: '2026-11-08T17:00:00Z',
  scheduled_at: '2026-11-08T17:00:00Z',
  status: 'not_started',
  number_of_games: 3,
  opponents: [team(10, 'G2 Esports', 'G2'), team(11, 'FaZe Clan', 'FaZe')],
  results: [],
  winner_id: null,
  streams_list: [{ raw_url: 'https://www.twitch.tv/rainbow6', main: true, official: true, language: 'en', embed_url: null }],
  league: { id: 1, name: 'BLAST R6 Major' },
  serie: { id: 2, full_name: 'Osaka 2026', name: 'Osaka' },
  tournament: { id: 3, name: 'Playoffs', tier: 's' },
  ...over
})

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('esports', () => {
  it('marks important matches: S-tier events, and A-tier playoffs and finals', () => {
    expect(esports.bigMatch(match({ name: 'Grand final: G2 vs FaZe' }))).toBe('BLAST R6 Major · Grand final')
    expect(esports.bigMatch(match({ tournament: { name: 'Group A', tier: 's' } }))).toBe('BLAST R6 Major')
    expect(esports.bigMatch(match({ league: { name: 'VCT Americas' }, tournament: { name: 'Playoffs', tier: 'a' } }))).toBe('VCT Americas · Playoffs')
    expect(esports.bigMatch(match({ league: { name: 'VCT Americas' }, tournament: { name: 'Regular season', tier: 'a' } }))).toBe('')
    expect(esports.bigMatch(match({ league: { name: 'Some Cup' }, name: 'Grand final: X vs Y', tournament: { name: 'Playoffs', tier: 'c' } }))).toBe('')
    expect(esports.bigMatch(match({ tournament: { name: 'Playoffs', tier: null } }))).toBe('')
  })

  it('reads matches: teams, scores, winner, stream, best-of', () => {
    const [m, done] = esports.parseMatches(
      JSON.stringify([
        match({}),
        match({ id: 2, status: 'finished', begin_at: '2026-11-06T17:00:00Z', results: [{ team_id: 10, score: 2 }, { team_id: 11, score: 1 }], winner_id: 10, tournament: { name: 'Group A', tier: 'b' } }),
        match({ id: 3, opponents: [] }) // TBD vs TBD: skipped
      ]),
      'r6siege'
    )
    expect(m).toMatchObject({ id: 'r6siege:1', gameName: 'Rainbow Six Siege', state: 'pre', bestOf: 3, url: 'https://www.twitch.tv/rainbow6', event: 'BLAST R6 Major · Osaka 2026 · Playoffs', big: 'BLAST R6 Major · Playoffs' })
    expect(m.a).toMatchObject({ name: 'G2 Esports', short: 'G2', score: '' })
    expect(done).toMatchObject({ state: 'post', big: '' })
    expect(done.a).toMatchObject({ score: '2', winner: true })
    expect(done.b).toMatchObject({ score: '1', winner: false })
  })

  it('downloads only the followed games, with the token, and keeps the last download when offline', async () => {
    const urls: string[] = []
    const ok = async (url: string): Promise<string> => {
      urls.push(url)
      return url.includes('/upcoming') ? JSON.stringify([match({})]) : '[]'
    }
    expect(esports.esportsStale(db, NOW)).toBe(false) // nothing followed
    esports.setEsportsGames(db, ['r6siege', 'nope', 'r6siege'])
    expect(esports.esportsGames(db)).toEqual(['r6siege'])
    expect(esports.esportsStale(db, NOW)).toBe(true)
    const feed = await esports.refreshEsports(db, 'secret', ok, NOW)
    expect(urls.length).toBe(3)
    expect(urls.every((u) => u.startsWith('https://api.pandascore.co/r6siege/matches/') && u.endsWith('token=secret'))).toBe(true)
    expect(feed.matches.map((m) => m.id)).toEqual(['r6siege:1'])
    expect(esports.esportsStale(db, NOW + 60_000)).toBe(false)

    const offline = await esports.refreshEsports(db, 'secret', async () => { throw new Error('HTTP 401') }, NOW + 20 * 60_000)
    expect(offline.matches.length).toBe(1)
    expect(offline.errors).toEqual(['the token (check it on pandascore.co)'])
    // Unfollowed games disappear at once
    esports.setEsportsGames(db, [])
    expect(esports.esportsFeed(db, true).matches).toEqual([])
  })

  it('the followed games sync', () => {
    esports.setEsportsGames(db, ['valorant'])
    expect(db.prepare("SELECT id FROM sync_dirty WHERE tbl = 'settings' AND id = 'esports.games'").all().length).toBe(1)
  })
})
