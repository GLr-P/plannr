import type { Db } from '../db'
import { SPORTS_LEAGUES, type SportsFeed, type SportsGame, type SportsNews, type SportsPrefs, type SportsSide, type SportsTeam } from '../../shared/api'
import type { FetchText } from './news'
import { getSetting, setSetting } from './settings'

/**
 * Sports: games, scores and headlines from ESPN's public site data (no account or key). What you follow is the
 * synced setting `sports.prefs`: leagues where you want every game, and favourite teams (whose games show even when
 * the rest of their league doesn't). Downloaded games and news are kept per device in `sports.cache`.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const DAY = 86_400_000

export function sportsPrefs(db: Db): SportsPrefs {
  const p = getSetting(db, 'sports.prefs') as Partial<SportsPrefs> | null
  return { leagues: Array.isArray(p?.leagues) ? p.leagues : [], teams: Array.isArray(p?.teams) ? p.teams : [] }
}

const leagueName = (key: string): string => SPORTS_LEAGUES.find((l) => l.key === key)?.name ?? key

/** ESPN's answers, read defensively */
type Json = Record<string, any>

/** The teams of a league, for picking favourites */
export function parseTeams(json: string, league: string): SportsTeam[] {
  const j = JSON.parse(json) as Json
  const list = (j.sports?.[0]?.leagues?.[0]?.teams ?? []) as Json[]
  return list
    .map(({ team: t }) => ({ league, id: String(t.id), name: String(t.displayName ?? ''), short: String(t.shortDisplayName ?? t.name ?? ''), abbr: String(t.abbreviation ?? ''), logo: String(t.logos?.[0]?.href ?? t.logo ?? '') }))
    .filter((t) => t.id && t.name && t.name !== 'TBD')
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function leagueTeams(league: string, fetchText: FetchText): Promise<SportsTeam[]> {
  if (!SPORTS_LEAGUES.some((l) => l.key === league)) throw new Error('Unknown league')
  return parseTeams(await fetchText(`${BASE}/${league}/teams?limit=500`), league)
}

/** A score is "3" on scoreboards and { displayValue: "3" } on team schedules */
const score = (s: unknown): string => (typeof s === 'string' ? s : s && typeof s === 'object' ? String((s as Json).displayValue ?? '') : '')

/** TV channels: scoreboards list { names: [...] }, team schedules { media: { shortName } } */
function channels(broadcasts: unknown): string {
  const names = ((Array.isArray(broadcasts) ? broadcasts : []) as Json[]).flatMap((b) => (Array.isArray(b.names) ? b.names : b.media?.shortName ? [b.media.shortName] : []) as string[])
  return [...new Set(names)].slice(0, 3).join(', ')
}

const BIG_NOTE = /final|championship|playoff|bowl|stanley cup|world series|all-star|derby|classic/i
const BIG_STAGE = /final|semi|quarter|round-of|knockout|playoff/i

/**
 * Important games: the postseason (ESPN season type 3), a knockout stage (soccer: the season slug), or a named event
 * ("Super Bowl LX", "NBA Finals - Game 4", "Rose Bowl"). Soccer notes also hold results ("win 4-3 on penalties"), so only
 * names that sound like an event count.
 */
export function bigGame(e: Json, c: Json): string {
  const note = ((c.notes ?? []) as Json[]).map((n) => String(n.headline ?? '')).find((h) => BIG_NOTE.test(h)) ?? ''
  if (note) return note.replace(/\s+presented by .*$/i, '')
  const slug = String(e.season?.slug ?? '')
  if (e.season?.type === 3 || e.seasonType?.type === 3 || /post-season/.test(slug)) return 'Playoffs'
  if (BIG_STAGE.test(slug)) return slug.replace(/-/g, ' ').replace(/^./, (s) => s.toUpperCase())
  return ''
}

/** Games from a scoreboard (one day of a league) or a team's schedule (its season) */
export function parseGames(json: string, league: string, mine: Set<string>): SportsGame[] {
  const j = JSON.parse(json) as Json
  return ((j.events ?? []) as Json[]).flatMap((e) => {
    const c = e.competitions?.[0] as Json | undefined
    const status = (e.status ?? c?.status)?.type as Json | undefined
    const sides = (c?.competitors ?? []) as Json[]
    if (!c || !status || sides.length !== 2) return []
    const side = (x: Json): SportsSide => ({
      id: String(x.team?.id ?? ''),
      name: String(x.team?.displayName ?? ''),
      short: String(x.team?.shortDisplayName ?? x.team?.displayName ?? ''),
      abbr: String(x.team?.abbreviation ?? ''),
      logo: String(x.team?.logo ?? x.team?.logos?.[0]?.href ?? ''),
      score: score(x.score),
      // Win-loss record (scoreboards have it; team schedules don't)
      record: String(x.records?.[0]?.summary ?? ''),
      winner: x.winner === true
    })
    const home = side(sides.find((x) => x.homeAway === 'home') ?? sides[0])
    const away = side(sides.find((x) => x.homeAway === 'away') ?? sides[1])
    const state = status.state === 'in' ? 'in' : status.state === 'post' ? 'post' : 'pre'
    const at = Date.parse(e.date)
    if (Number.isNaN(at)) return []
    return [
      {
        id: `${league}:${e.id}`,
        league,
        leagueName: leagueName(league),
        at,
        state,
        // "Final", "2nd 12:31", "Postponed"; before the game the time is shown from `at` instead
        detail: state === 'pre' ? (/postponed|canceled|cancelled|delayed/i.test(String(status.description)) ? String(status.description) : '') : String(status.shortDetail ?? status.detail ?? ''),
        home,
        away,
        url: String((e.links as Json[] | undefined)?.find((l) => (l.rel as string[] | undefined)?.includes('summary'))?.href ?? e.links?.[0]?.href ?? ''),
        tv: channels(c.broadcasts),
        venue: [c.venue?.fullName, c.venue?.address?.city].filter(Boolean).join(', '),
        mine: mine.has(`${league}:${home.id}`) || mine.has(`${league}:${away.id}`),
        big: bigGame(e, c)
      }
    ]
  })
}

/** Headlines. `team` = only stories mostly about that team (ESPN tags league-wide roundups with every team) */
export function parseNews(json: string, league: string, mine: Set<string>, team?: string): SportsNews[] {
  const j = JSON.parse(json) as Json
  return ((j.articles ?? []) as Json[]).flatMap((a) => {
    const teams = ((a.categories ?? []) as Json[]).filter((c) => c.type === 'team' && c.teamId != null).map((c) => String(c.teamId))
    if (team && (!teams.includes(team) || teams.length > 3)) return []
    const url = String(a.links?.web?.href ?? '')
    const at = Date.parse(a.published)
    if (!a.headline || !url) return []
    return [
      {
        id: `${league}:${a.id}`,
        league,
        leagueName: leagueName(league),
        title: String(a.headline),
        summary: String(a.description ?? ''),
        url,
        image: String(a.images?.[0]?.url ?? ''),
        publishedAt: Number.isNaN(at) ? 0 : at,
        mine: teams.some((t) => mine.has(`${league}:${t}`)),
        teamIds: teams.slice(0, 10)
      }
    ]
  })
}

/** ESPN's scoreboard day (its days follow US time; a day either side covers the difference) */
const ymd = (t: number): string => new Date(t).toISOString().slice(0, 10).replace(/-/g, '')

interface Cache {
  games: SportsGame[]
  news: SportsNews[]
  refreshedAt: number | null
  errors: string[]
}

function cache(db: Db): Cache {
  const c = getSetting(db, 'sports.cache') as Partial<Cache> | null
  return { games: c?.games ?? [], news: c?.news ?? [], refreshedAt: c?.refreshedAt ?? null, errors: c?.errors ?? [] }
}

/** Only what you follow: every game of a followed league, and your teams' games in the others */
function shown(prefs: SportsPrefs, c: Cache): Pick<SportsFeed, 'games' | 'news'> {
  const mine = new Set(prefs.teams.map((t) => `${t.league}:${t.id}`))
  const all = new Set(prefs.leagues)
  const keep = (league: string, isMine: boolean): boolean => all.has(league) || (isMine && prefs.teams.some((t) => t.league === league))
  return {
    games: c.games.map((g) => ({ ...g, mine: mine.has(`${g.league}:${g.home.id}`) || mine.has(`${g.league}:${g.away.id}`) })).filter((g) => keep(g.league, g.mine)),
    news: c.news
      .map((n) => {
        const teamIds = n.teamIds ?? []
        return { ...n, teamIds, mine: teamIds.some((t) => mine.has(`${n.league}:${t}`)) }
      })
      .filter((n) => keep(n.league, n.mine))
  }
}

export function sportsFeed(db: Db): SportsFeed {
  const prefs = sportsPrefs(db)
  const c = cache(db)
  return { prefs, ...shown(prefs, c), refreshedAt: c.refreshedAt, errors: c.errors }
}

export function setSportsPrefs(db: Db, prefs: SportsPrefs): SportsFeed {
  const known = new Set(SPORTS_LEAGUES.map((l) => l.key))
  const teams = prefs.teams.filter((t, i, a) => known.has(t.league) && a.findIndex((x) => x.league === t.league && x.id === t.id) === i)
  setSetting(db, 'sports.prefs', { leagues: [...new Set(prefs.leagues)].filter((l) => known.has(l)), teams })
  return sportsFeed(db)
}

/** Download games (two days back, a week or two ahead) and headlines for everything followed */
export async function refreshSports(db: Db, fetchText: FetchText, now = Date.now()): Promise<SportsFeed> {
  const prefs = sportsPrefs(db)
  const mine = new Set(prefs.teams.map((t) => `${t.league}:${t.id}`))
  const games = new Map<string, SportsGame>()
  const news = new Map<string, SportsNews>()
  const errors: string[] = []
  const jobs: (() => Promise<void>)[] = []
  const job = (label: string, run: () => Promise<void>): void => {
    jobs.push(() => run().catch(() => void (errors.includes(label) || errors.push(label))))
  }
  for (const league of prefs.leagues) {
    for (let d = -2; d <= 6; d++)
      job(leagueName(league), async () => {
        for (const g of parseGames(await fetchText(`${BASE}/${league}/scoreboard?dates=${ymd(now + d * DAY)}`), league, mine)) games.set(g.id, g)
      })
    job(leagueName(league), async () => {
      for (const n of parseNews(await fetchText(`${BASE}/${league}/news?limit=20`), league, mine)) news.set(n.id, n)
    })
  }
  for (const t of prefs.teams) {
    // A team's season schedule (also for teams in followed leagues: it reaches further ahead than the week of scoreboards)
    job(t.name, async () => {
      for (const g of parseGames(await fetchText(`${BASE}/${t.league}/teams/${t.id}/schedule`), t.league, mine)) if (!games.has(g.id) || g.state !== 'pre') games.set(g.id, g)
    })
    job(t.name, async () => {
      for (const n of parseNews(await fetchText(`${BASE}/${t.league}/news?team=${t.id}&limit=15`), t.league, mine, t.id)) news.set(n.id, n)
    })
  }
  let next = 0
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]()
  }))
  const before = cache(db)
  const c: Cache = {
    // Recent results and the next three weeks
    games: [...games.values()].filter((g) => g.at > now - 3 * DAY && g.at < now + 21 * DAY).sort((a, b) => a.at - b.at),
    news: [...news.values()].filter((n) => n.publishedAt > now - 10 * DAY).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 150),
    refreshedAt: now,
    errors
  }
  // Nothing came back (offline): keep what was there
  if (!c.games.length && !c.news.length && errors.length && (before.games.length || before.news.length)) c.games = before.games, c.news = before.news
  setSetting(db, 'sports.cache', c)
  return sportsFeed(db)
}

/** Due for a download: every 15 minutes, or every 2 while one of the shown games is on */
export function sportsStale(db: Db, now = Date.now()): boolean {
  const prefs = sportsPrefs(db)
  if (!prefs.leagues.length && !prefs.teams.length) return false
  const feed = sportsFeed(db)
  if (!feed.refreshedAt) return true
  const live = feed.games.some((g) => g.state === 'in' || (g.state === 'pre' && g.at < now))
  return now - feed.refreshedAt > (live ? 2 : 15) * 60_000
}
