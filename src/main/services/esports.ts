import type { Db } from '../db'
import { ESPORTS_GAMES, type EsportsFeed, type EsportsMatch, type EsportsSide } from '../../shared/api'
import type { FetchText } from './news'
import { getSetting, setSetting } from './settings'

/**
 * E-sports: matches from PandaScore's free plan (schedules and results). Each person signs up for their own free
 * token (PandaScore's terms don't allow sharing one), which the app keeps encrypted; this service only gets it passed in.
 * The games you follow are the synced setting `esports.games`; downloaded matches are kept per device in `esports.cache`.
 */

const BASE = 'https://api.pandascore.co'
const DAY = 86_400_000

type Json = Record<string, any>

const gameName = (key: string): string => ESPORTS_GAMES.find((g) => g.key === key)?.name ?? key

export function esportsGames(db: Db): string[] {
  const g = getSetting(db, 'esports.games')
  return Array.isArray(g) ? g.filter((k) => ESPORTS_GAMES.some((x) => x.key === k)) : []
}

export function setEsportsGames(db: Db, games: string[]): void {
  setSetting(db, 'esports.games', [...new Set(games)].filter((k) => ESPORTS_GAMES.some((x) => x.key === k)))
}

const BIG_NAME = /final|playoff|semi|quarter|knockout|bracket/i

/**
 * Important matches: anything at an S-tier event (Majors, Worlds, Masters, The International…), and the playoffs and
 * finals of A-tier ones. The label is the event plus the stage, e.g. "BLAST R6 Major · Grand final".
 */
export function bigMatch(m: Json): string {
  const tier = String(m.tournament?.tier ?? m.serie?.tier ?? '').toLowerCase()
  const stage = String(m.tournament?.name ?? '')
  // PandaScore names matches "Grand final: G2 vs FaZe"; the part before the colon is the round
  const round = /^(.+?):/.exec(String(m.name ?? ''))?.[1] ?? ''
  const playoffs = BIG_NAME.test(round) || BIG_NAME.test(stage)
  if (tier !== 's' && !(tier === 'a' && playoffs)) return ''
  const event = String(m.league?.name ?? m.serie?.full_name ?? 'Major')
  const detail = BIG_NAME.test(round) ? round : playoffs ? stage : ''
  return detail ? `${event} · ${detail.replace(/^./, (s) => s.toUpperCase())}` : event
}

export function parseMatches(json: string, game: string): EsportsMatch[] {
  const list = JSON.parse(json) as Json[]
  if (!Array.isArray(list)) return []
  return list.flatMap((m) => {
    const at = Date.parse(m.begin_at ?? m.scheduled_at)
    const opp = ((m.opponents ?? []) as Json[]).map((o) => o.opponent as Json).filter(Boolean)
    if (Number.isNaN(at) || opp.length !== 2) return []
    const score = (id: unknown): string => {
      const r = ((m.results ?? []) as Json[]).find((x) => x.team_id === id || x.player_id === id)
      return r && r.score != null ? String(r.score) : ''
    }
    const side = (o: Json): EsportsSide => ({
      id: String(o.id ?? ''),
      name: String(o.name ?? ''),
      short: String(o.acronym || o.name || ''),
      logo: String(o.image_url ?? ''),
      score: score(o.id),
      winner: m.winner_id != null && m.winner_id === o.id
    })
    const status = String(m.status ?? '')
    const state = status === 'running' ? 'in' : status === 'finished' ? 'post' : 'pre'
    const streams = (m.streams_list ?? []) as Json[]
    const stream = streams.find((s) => s.main) ?? streams.find((s) => s.official) ?? streams[0]
    return [
      {
        id: `${game}:${m.id}`,
        game,
        gameName: gameName(game),
        at,
        state,
        detail: status === 'canceled' || status === 'postponed' ? status.replace(/^./, (s) => s.toUpperCase()) : '',
        a: side(opp[0]),
        b: side(opp[1]),
        event: [m.league?.name, m.serie?.full_name ?? m.serie?.name, m.tournament?.name].filter(Boolean).join(' · '),
        bestOf: typeof m.number_of_games === 'number' ? m.number_of_games : 0,
        url: String(stream?.raw_url ?? ''),
        big: bigMatch(m)
      }
    ]
  })
}

interface Cache {
  matches: EsportsMatch[]
  refreshedAt: number | null
  errors: string[]
}

function cache(db: Db): Cache {
  const c = getSetting(db, 'esports.cache') as Partial<Cache> | null
  return { matches: c?.matches ?? [], refreshedAt: c?.refreshedAt ?? null, errors: c?.errors ?? [] }
}

export function esportsFeed(db: Db, configured: boolean): EsportsFeed {
  const games = new Set(esportsGames(db))
  const c = cache(db)
  return { configured, games: [...games], matches: c.matches.filter((m) => games.has(m.game)), refreshedAt: c.refreshedAt, errors: c.errors }
}

/** Download the followed games' matches: on now, the next two weeks, and the last few days' results */
export async function refreshEsports(db: Db, token: string, fetchText: FetchText, now = Date.now()): Promise<EsportsFeed> {
  const games = esportsGames(db)
  const matches = new Map<string, EsportsMatch>()
  const errors: string[] = []
  const t = encodeURIComponent(token)
  const jobs = games.flatMap((g) =>
    ['running?per_page=20', 'upcoming?per_page=100&sort=begin_at', 'past?per_page=30&sort=-begin_at'].map((q) => async () => {
      try {
        for (const m of parseMatches(await fetchText(`${BASE}/${g}/matches/${q}&token=${t}`), g)) matches.set(m.id, m)
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e)
        const label = /401|403|token/i.test(msg) ? 'the token (check it on pandascore.co)' : gameName(g)
        if (!errors.includes(label)) errors.push(label)
      }
    })
  )
  // PandaScore's free plan allows 60 requests a minute: a few at a time is plenty
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]()
  }))
  const before = cache(db)
  const c: Cache = {
    matches: [...matches.values()].filter((m) => m.at > now - 3 * DAY && m.at < now + 14 * DAY).sort((a, b) => a.at - b.at),
    refreshedAt: now,
    errors
  }
  // Nothing came back (offline): keep what was there
  if (!c.matches.length && errors.length && before.matches.length) c.matches = before.matches
  setSetting(db, 'esports.cache', c)
  return esportsFeed(db, true)
}

/** Due for a download: every 15 minutes, or every 3 while a shown match is on */
export function esportsStale(db: Db, now = Date.now()): boolean {
  if (!esportsGames(db).length) return false
  const c = cache(db)
  if (!c.refreshedAt) return true
  const live = c.matches.some((m) => m.state === 'in' || (m.state === 'pre' && m.at < now && m.at > now - 6 * 3_600_000))
  return now - c.refreshedAt > (live ? 3 : 15) * 60_000
}
