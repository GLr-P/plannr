import type { Db } from '../db'
import type { DiscoverItem, DiscoverSection, DiscoverTab, MediaItem, MediaResult } from '../../shared/api'
import { getSetting, setSetting } from './settings'
import { newsPrefs, parseFeed, type FetchText } from './news'
import { listMedia, parseOpenLibrary, showResult, type TvShow } from './media'
import { entChannels } from './entertainment'

/**
 * Discover: top picks and popular lists for each Entertainment tab, plus picks for you from what's on your lists.
 * No accounts or keys: TVmaze schedules (shows with a new episode out now), Apple's charts (movies, books,
 * podcasts), Open Library (trending books, books by subject), Steam and CheapShark (games), Reddit's popular
 * posts, and a starter list of YouTube channels. Downloads are kept for 6 hours on this device (`discover.<tab>`).
 */

interface Cache {
  at: number
  cc: string
  sections: DiscoverSection[]
  /** Everything downloaded, with genres, for the picks for you */
  pool: MediaResult[]
  /** Books by subject, for the picks for you */
  subjects?: Record<string, { at: number; items: MediaResult[] }>
}

const FRESH_MS = 6 * 3_600_000

const country = (db: Db): string => (newsPrefs(db).place?.countryCode || 'us').toLowerCase()
const year = (v: unknown): number | null => {
  const n = Number(String(v ?? '').slice(0, 4))
  return n > 1800 && n < 2200 ? n : null
}
const join = (...parts: (string | number | null | undefined)[]): string => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ')
/** Apple's artwork links take a size */
const appleArt = (url: string, size: string): string => url.replace(/\/\d+x\d+bb\.(png|jpg)$/, `/${size}bb.jpg`)
const settle = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null)
const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '')
const listText = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

const mediaItem = (m: MediaResult, badge = ''): DiscoverItem => ({ title: m.title, subtitle: m.subtitle, image: m.image, url: m.url, summary: m.summary, badge, media: m })
const section = (id: string, title: string, note: string, items: DiscoverItem[]): DiscoverSection => ({ id, title, note, items })

// ---------- Shows ----------

const LEFT_OUT_TYPES = /^(news|talk show|sports|game show|panel show)$/i

async function shows(fetchText: FetchText, cc: string, today: string): Promise<Omit<Cache, 'at' | 'cc'>> {
  const [web, network] = await Promise.all([settle(fetchText(`https://api.tvmaze.com/schedule/web?date=${today}`)), settle(fetchText(`https://api.tvmaze.com/schedule?country=${cc.toUpperCase()}&date=${today}`))])
  if (web === null && network === null) throw new Error('Couldn’t reach TVmaze')
  const byId = new Map<number, TvShow>()
  for (const e of JSON.parse(web ?? '[]') as { _embedded?: { show?: TvShow } }[]) {
    const s = e._embedded?.show
    if (s && (s.language === 'English' || !s.language)) byId.set(s.id, s)
  }
  for (const e of JSON.parse(network ?? '[]') as { show?: TvShow }[]) if (e.show) byId.set(e.show.id, e.show)
  const all = [...byId.values()].filter((s) => !LEFT_OUT_TYPES.test(s.type ?? ''))
  // Top picks lean to newer shows (long-running soaps and daily shows are popular but rarely news to anyone)
  const recent = (sh: TvShow): boolean => !sh.premiered || Number(sh.premiered.slice(0, 4)) >= Number(today.slice(0, 4)) - 6
  // Popularity, with a lift for well-rated drama and comedy over court, reality and daily shows
  const rank = (sh: TvShow): number => (sh.weight ?? 0) + (/^(scripted|animation)$/i.test(sh.type ?? '') ? 15 : 0) + (sh.rating?.average ?? 0) * 2
  const byWeight = [...all].sort((a, b) => rank(b) - rank(a))
  const popular = byWeight.filter(recent).length >= 6 ? byWeight.filter(recent) : byWeight
  const rated = all.filter((s) => (s.rating?.average ?? 0) >= 7.5).sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0))
  const star = (s: TvShow): string => (s.rating?.average ? `★ ${s.rating.average}` : '')
  return {
    sections: [
      section('top', 'Top picks: new episodes out now', 'Popular shows with a new episode today', popular.slice(0, 18).map((s) => mediaItem(showResult(s), star(s)))),
      section('rated', 'Highest rated, airing now', 'Rated 7.5 or more by TVmaze viewers', rated.slice(0, 18).map((s) => mediaItem(showResult(s), star(s))))
    ],
    pool: all.map(showResult)
  }
}

// ---------- Movies ----------

interface ItunesEntry {
  'im:name': { label: string }
  'im:image'?: { label: string }[]
  summary?: { label: string }
  link?: { attributes?: { href?: string } }
  id?: { attributes?: { 'im:id'?: string } }
  category?: { attributes?: { label?: string } }
  'im:releaseDate'?: { label?: string }
}

async function movies(fetchText: FetchText, cc: string, now: number): Promise<Omit<Cache, 'at' | 'cc'>> {
  const entries = ((JSON.parse(await fetchText(`https://itunes.apple.com/${cc}/rss/topmovies/limit=50/json`)) as { feed?: { entry?: ItunesEntry[] } }).feed?.entry ?? [])
  const results = entries.map((e) => {
    const img = e['im:image']?.[e['im:image'].length - 1]?.label ?? ''
    const genre = e.category?.attributes?.label ?? ''
    const released = e['im:releaseDate']?.label ?? ''
    return {
      released,
      result: {
        kind: 'movie' as const,
        extId: `itunes:${e.id?.attributes?.['im:id'] ?? norm(e['im:name'].label)}`,
        title: e['im:name'].label,
        subtitle: join(year(released), genre),
        image: img ? appleArt(img, '300x450') : '',
        url: e.link?.attributes?.href ?? '',
        year: year(released),
        summary: e.summary?.label ?? '',
        total: 0,
        genres: genre ? [genre] : []
      }
    }
  })
  const recent = results.filter((r) => r.released && now - Date.parse(r.released) < 200 * 86_400_000).sort((a, b) => b.released.localeCompare(a.released))
  const genreCount = new Map<string, number>()
  for (const r of results) for (const g of r.result.genres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1)
  const genres = [...genreCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g)
  return {
    sections: [
      section('top', 'Top picks: popular right now', 'The most bought and rented movies this week', results.slice(0, 20).map((r, i) => mediaItem(r.result, `#${i + 1}`))),
      section('new', 'New releases', 'Out in the last few months', recent.slice(0, 18).map((r) => mediaItem(r.result))),
      ...genres.map((g) => section(`genre:${g}`, `Popular ${g.toLowerCase()}`, '', results.filter((r) => r.result.genres.includes(g)).slice(0, 18).map((r) => mediaItem(r.result))))
    ],
    pool: results.map((r) => r.result)
  }
}

// ---------- Books ----------

interface AppleChartItem {
  id: string
  name: string
  artistName?: string
  artworkUrl100?: string
  url?: string
  releaseDate?: string
  genres?: { name: string }[]
}
const appleChart = (json: string): AppleChartItem[] => (JSON.parse(json) as { feed?: { results?: AppleChartItem[] } }).feed?.results ?? []

async function books(fetchText: FetchText, cc: string): Promise<Omit<Cache, 'at' | 'cc'>> {
  const [chart, trending] = await Promise.all([settle(fetchText(`https://rss.applemarketingtools.com/api/v2/${cc}/books/top-paid/25/books.json`)), settle(fetchText('https://openlibrary.org/trending/weekly.json?limit=24'))])
  if (chart === null && trending === null) throw new Error('Couldn’t reach the book lists')
  const best: MediaResult[] = appleChart(chart ?? '{}').map((b) => ({
    kind: 'book',
    extId: `apple:${b.id}`,
    title: b.name,
    subtitle: join(b.artistName, year(b.releaseDate)),
    image: b.artworkUrl100 ? appleArt(b.artworkUrl100, '300x450') : '',
    url: b.url ?? '',
    year: year(b.releaseDate),
    summary: '',
    total: 0,
    genres: (b.genres ?? []).map((g) => g.name).filter((g) => g !== 'Books')
  }))
  const trend = trending ? parseOpenLibrary(trending) : []
  return {
    sections: [
      section('top', 'Top picks: bestsellers', 'The best-selling books this week', best.slice(0, 20).map((b, i) => mediaItem(b, `#${i + 1}`))),
      section('trending', 'Trending this week', 'What Open Library readers are reading', trend.map((b) => mediaItem(b)))
    ],
    pool: best
  }
}

interface OlSubjectWork {
  key: string
  title: string
  authors?: { name: string }[]
  cover_id?: number
  first_publish_year?: number
}
const subjectSlug = (g: string): string => g.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
export function parseSubject(json: string): MediaResult[] {
  return ((JSON.parse(json) as { works?: OlSubjectWork[] }).works ?? []).map((w) => ({
    kind: 'book',
    extId: w.key,
    title: w.title,
    subtitle: join((w.authors ?? []).slice(0, 2).map((a) => a.name).join(', '), w.first_publish_year),
    image: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : '',
    url: `https://openlibrary.org${w.key}`,
    year: w.first_publish_year ?? null,
    summary: '',
    total: 0,
    genres: []
  }))
}

// ---------- Games ----------

interface SteamItem {
  id: number
  name: string
  discount_percent?: number
  final_price?: number
  currency?: string
  header_image?: string
}
const money = (cents: number | undefined, currency = 'USD'): string => (cents === undefined ? '' : cents === 0 ? 'Free' : `${(cents / 100).toLocaleString('en', { style: 'currency', currency })}`)
const steamGame = (g: SteamItem): MediaResult => ({
  kind: 'game',
  extId: `steam:${g.id}`,
  title: g.name,
  subtitle: join('PC (Steam)', money(g.final_price, g.currency)),
  image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/header.jpg`,
  url: `https://store.steampowered.com/app/${g.id}`,
  year: null,
  summary: '',
  total: 0,
  genres: []
})

async function games(fetchText: FetchText, cc: string): Promise<Omit<Cache, 'at' | 'cc'>> {
  const [steam, deals] = await Promise.all([
    settle(fetchText(`https://store.steampowered.com/api/featuredcategories?cc=${cc}&l=english`)),
    settle(fetchText('https://www.cheapshark.com/api/1.0/deals?onSale=1&sortBy=Metacritic&metacritic=80&pageSize=24'))
  ])
  if (steam === null && deals === null) throw new Error('Couldn’t reach Steam')
  const cats = (steam ? JSON.parse(steam) : {}) as Record<string, { items?: SteamItem[] }>
  const unique = (items: SteamItem[] = []): SteamItem[] => [...new Map(items.map((i) => [i.id, i])).values()]
  const rated = ((deals ? JSON.parse(deals) : []) as { title: string; steamAppID: string | null; salePrice: string; savings: string; metacriticScore: string; thumb: string; dealID: string }[])
    .filter((d) => d.steamAppID)
    .filter((d, i, all) => all.findIndex((x) => x.steamAppID === d.steamAppID) === i)
  const off = (pct: number | undefined): string => (pct ? `−${pct}%` : '')
  return {
    sections: [
      section(
        'top',
        'Top picks: loved and on sale',
        'Metacritic 80 or more, on sale now',
        rated.slice(0, 18).map((d) => mediaItem({ ...steamGame({ id: Number(d.steamAppID), name: d.title }), subtitle: `PC · $${d.salePrice}`, summary: `Metacritic ${d.metacriticScore}` }, `−${Math.round(Number(d.savings))}%`))
      ),
      section('sellers', 'Top sellers on Steam', '', unique(cats.top_sellers?.items).map((g) => mediaItem(steamGame(g), off(g.discount_percent)))),
      section('specials', 'Steam specials', 'On sale this week', unique(cats.specials?.items).map((g) => mediaItem(steamGame(g), off(g.discount_percent)))),
      section('new', 'New on Steam', '', unique(cats.new_releases?.items).map((g) => mediaItem(steamGame(g), off(g.discount_percent))))
    ],
    pool: []
  }
}

// ---------- Podcasts ----------

async function podcasts(fetchText: FetchText, cc: string): Promise<Omit<Cache, 'at' | 'cc'>> {
  const chart = appleChart(await fetchText(`https://rss.applemarketingtools.com/api/v2/${cc}/podcasts/top/30/podcasts.json`))
  // The chart doesn't say where each podcast's episodes are: one lookup for all of them
  const looked = chart.length ? ((JSON.parse(await fetchText(`https://itunes.apple.com/lookup?id=${chart.map((p) => p.id).join(',')}&entity=podcast`)) as { results?: { collectionId: number; feedUrl?: string }[] }).results ?? []) : []
  const feeds = new Map(looked.filter((r) => r.feedUrl).map((r) => [String(r.collectionId), r.feedUrl!]))
  const items = chart
    .filter((p) => feeds.has(p.id))
    .map((p, i) => ({
      genre: p.genres?.[0]?.name ?? '',
      item: { title: p.name, subtitle: p.artistName ?? '', image: p.artworkUrl100 ? appleArt(p.artworkUrl100, '300x300') : '', url: p.url ?? '', summary: p.genres?.[0]?.name ?? '', badge: `#${i + 1}`, feedUrl: feeds.get(p.id) } as DiscoverItem
    }))
  const genreCount = new Map<string, number>()
  for (const p of items) if (p.genre) genreCount.set(p.genre, (genreCount.get(p.genre) ?? 0) + 1)
  const genres = [...genreCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g)
  return {
    sections: [
      section('top', 'Top picks: top podcasts', 'The most popular podcasts right now', items.map((p) => p.item)),
      ...genres.map((g) => section(`genre:${g}`, `Top in ${g}`, '', items.filter((p) => p.genre === g).map((p) => ({ ...p.item, badge: '' }))))
    ],
    pool: []
  }
}

// ---------- Reddit ----------

/** Well-known communities by topic, to get started */
const SUBREDDITS: [string, string[]][] = [
  ['Tech', ['technology', 'pcmasterrace', 'buildapc', 'techsupport', 'hardware', 'gadgets']],
  ['Gaming', ['gaming', 'Games', 'pcgaming', 'patientgamers', 'NintendoSwitch']],
  ['Movies, TV and books', ['movies', 'television', 'MovieSuggestions', 'books', 'suggestmeabook']],
  ['Science and learning', ['science', 'space', 'todayilearned', 'explainlikeimfive', 'dataisbeautiful']],
  ['Fun', ['mildlyinteresting', 'interestingasfuck', 'oddlysatisfying', 'aww', 'funny']],
  ['Home, food and money', ['DIY', 'HomeImprovement', 'Cooking', 'personalfinance', 'Frugal', 'smallbusiness']]
]

async function reddit(fetchText: FetchText): Promise<Omit<Cache, 'at' | 'cc'>> {
  const xml = await settle(fetchText('https://www.reddit.com/r/popular/top/.rss?t=day'))
  const subs = new Map<string, { posts: number; title: string; image: string }>()
  for (const p of xml ? parseFeed(xml) : []) {
    const sub = p.category
    if (!sub) continue
    const s = subs.get(sub) ?? { posts: 0, title: p.title, image: p.image }
    s.posts++
    if (!s.image && p.image) s.image = p.image
    subs.set(sub, s)
  }
  const trending = [...subs].sort((a, b) => b[1].posts - a[1].posts)
  const sub = (name: string, extra: Partial<DiscoverItem> = {}): DiscoverItem => ({ title: `r/${name}`, subtitle: '', image: '', url: `https://www.reddit.com/r/${name}`, summary: '', badge: '', channel: { kind: 'reddit', input: name }, ...extra })
  return {
    sections: [
      ...(trending.length ? [section('top', 'Top picks: popular today', 'Communities with today’s most popular posts', trending.slice(0, 18).map(([name, s]) => sub(name, { subtitle: s.title, image: s.image })))] : []),
      ...SUBREDDITS.map(([topic, names]) => section(`topic:${topic}`, topic, '', names.map((n) => sub(n))))
    ],
    pool: []
  }
}

// ---------- YouTube ----------

/** Well-known channels by topic, to get started (handles checked October 2026) */
const CHANNELS: [string, [string, string][]][] = [
  ['Tech', [['@LinusTechTips', 'Linus Tech Tips'], ['@mkbhd', 'Marques Brownlee'], ['@GamersNexus', 'Gamers Nexus'], ['@JayzTwoCents', 'JayzTwoCents'], ['@iFixit', 'iFixit'], ['@rossmanngroup', 'Louis Rossmann']]],
  ['Science and learning', [['@veritasium', 'Veritasium'], ['@kurzgesagt', 'Kurzgesagt – In a Nutshell'], ['@MarkRober', 'Mark Rober'], ['@smartereveryday', 'SmarterEveryDay'], ['@TED', 'TED'], ['@NatGeo', 'National Geographic']]],
  ['Making and fixing', [['@StuffMadeHere', 'Stuff Made Here'], ['@DIYPerks', 'DIY Perks'], ['@tested', 'Adam Savage’s Tested'], ['@ThisOldHouse', 'This Old House']]],
  ['Food', [['@JoshuaWeissman', 'Joshua Weissman'], ['@BingingwithBabish', 'Babish Culinary Universe']]],
  ['Games, movies and laughs', [['@IGN', 'IGN'], ['@NoClipDocs', 'Noclip'], ['@CinemaWins', 'CinemaWins'], ['@DryBarComedy', 'Dry Bar Comedy']]]
]

const youtube = (): DiscoverSection[] =>
  CHANNELS.map(([topic, list], i) =>
    section(
      i === 0 ? 'top' : `topic:${topic}`,
      i === 0 ? `Top picks: ${topic.toLowerCase()}` : topic,
      i === 0 ? 'Popular channels to get you started' : '',
      list.map(([handle, name]) => ({ title: name, subtitle: handle, image: '', url: `https://www.youtube.com/${handle}`, summary: '', badge: '', channel: { kind: 'youtube', input: handle } }))
    )
  )

// ---------- Picks for you ----------

/** The genres you like most on a list: what you rated well and finished count more than what you want to get to */
export function favouriteGenres(items: MediaItem[]): string[] {
  const score = new Map<string, number>()
  for (const m of items) {
    if (m.status === 'dropped') continue
    const w = m.rating >= 4 ? 3 : m.status === 'done' || m.status === 'doing' ? 2 : 1
    for (const g of m.genres) if (!/^(fiction|books?|general)$/i.test(g)) score.set(g, (score.get(g) ?? 0) + w)
  }
  return [...score].sort((a, b) => b[1] - a[1]).map(([g]) => g)
}

async function forYou(db: Db, tab: DiscoverTab, cache: Cache, fetchText: FetchText, now: number): Promise<DiscoverSection[]> {
  if (tab !== 'show' && tab !== 'movie' && tab !== 'book') return []
  const mine = listMedia(db, now).filter((m) => m.kind === tab)
  const top = favouriteGenres(mine).slice(0, 3)
  if (!top.length) return []
  const out: DiscoverSection[] = []
  const because = mine.find((m) => m.genres.includes(top[0]) && m.rating >= 4) ?? mine.find((m) => m.genres.includes(top[0]))
  const picks = cache.pool
    .map((r) => ({ r, overlap: r.genres.filter((g) => top.includes(g)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || (b.r.score ?? 0) - (a.r.score ?? 0))
    .map((x) => mediaItem(x.r, x.r.score ? `★ ${x.r.score}` : ''))
  if (picks.length) out.push(section('foryou', `For you: more ${listText(top.slice(0, 2).map((g) => g.toLowerCase()))}`, because ? `Because you added ${because.title}` : '', picks.slice(0, 18)))
  if (tab === 'book') {
    const slug = subjectSlug(top[0])
    const subjects = (cache.subjects ??= {})
    if (!subjects[slug] || now - subjects[slug].at > FRESH_MS) {
      const json = await settle(fetchText(`https://openlibrary.org/subjects/${slug}.json?limit=18`))
      if (json) {
        subjects[slug] = { at: now, items: parseSubject(json) }
        setSetting(db, `discover.${tab}`, cache)
      }
    }
    const items = subjects[slug]?.items ?? []
    if (items.length) out.push(section('subject', `Because you like ${top[0].toLowerCase()}`, 'Well-loved books on the subject, from Open Library', items.map((b) => mediaItem(b))))
  }
  return out
}

// ---------- Putting it together ----------

const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function download(tab: Exclude<DiscoverTab, 'watch'>, fetchText: FetchText, cc: string, now: number): Promise<Omit<Cache, 'at' | 'cc'>> {
  if (tab === 'show') return shows(fetchText, cc, localDay(now))
  if (tab === 'movie') return movies(fetchText, cc, now)
  if (tab === 'book') return books(fetchText, cc)
  if (tab === 'game') return games(fetchText, cc)
  if (tab === 'podcast') return podcasts(fetchText, cc)
  return reddit(fetchText)
}

/** Leaves out what's already on your lists or followed */
function notMine(db: Db, tab: DiscoverTab, sections: DiscoverSection[]): DiscoverSection[] {
  const media = listMedia(db)
  const ids = new Set(media.map((m) => m.extId).filter(Boolean))
  const titles = new Set(media.filter((m) => m.kind === tab).map((m) => norm(m.title)))
  const channels = entChannels(db)
  const followed = new Set(channels.flatMap((c) => [c.handle.toLowerCase(), norm(c.name)]))
  const keep = (i: DiscoverItem): boolean => {
    if (i.media) return !ids.has(i.media.extId) && !titles.has(norm(i.media.title))
    if (i.feedUrl) return !followed.has(i.feedUrl.toLowerCase())
    if (i.channel) return !followed.has(i.channel.input.toLowerCase()) && !followed.has(norm(i.title))
    return true
  }
  return sections.map((s) => ({ ...s, items: s.items.filter(keep) })).filter((s) => s.items.length > 0)
}

export async function discover(db: Db, tab: DiscoverTab, fetchText: FetchText, refresh = false, now = Date.now()): Promise<DiscoverSection[]> {
  if (tab === 'watch') return notMine(db, tab, youtube())
  const key = `discover.${tab}`
  const cc = country(db)
  let cache = getSetting(db, key) as Cache | null
  if (refresh || !cache || cache.cc !== cc || now - cache.at > FRESH_MS) {
    try {
      cache = { at: now, cc, ...(await download(tab, fetchText, cc, now)), subjects: cache?.subjects }
      setSetting(db, key, cache)
    } catch (e) {
      if (!cache) throw e // keep showing the last lists when offline
    }
  }
  const personal = await forYou(db, tab, cache, fetchText, now)
  const [first, ...rest] = cache.sections
  return notMine(db, tab, [...(first ? [first] : []), ...personal, ...rest])
}
