import type { Db } from '../db'
import { newId } from '../db'
import type { MediaEpisode, MediaItem, MediaKind, MediaPatch, MediaResult, MediaStatus } from '../../shared/api'
import { htmlToText, type FetchText } from './news'

/**
 * Movies, shows, books and games you want to get to, are in the middle of, or finished: with ratings, notes and
 * progress (pages read, episodes watched). Looked up without accounts or keys: movies from IMDb's search
 * suggestions, shows from TVmaze (which also gives episode dates), books from Open Library, games from CheapShark.
 * Synced table `media`; a show's episodes are stored in `info` and checked at most once a day.
 */

interface Row {
  id: string
  kind: MediaKind
  title: string
  subtitle: string
  image: string
  url: string
  ext_id: string
  status: MediaStatus
  rating: number
  notes: string
  progress: number
  total: number
  info: string
  started_on: string | null
  finished_on: string | null
  created_at: number
  updated_at: number
}
interface Info {
  year?: number | null
  genres?: string[]
  summary?: string
  episodes?: MediaEpisode[]
  next?: MediaEpisode | null
  checkedAt?: number
}

const parseInfo = (s: string): Info => {
  try {
    return (JSON.parse(s) as Info) ?? {}
  } catch {
    return {}
  }
}

const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toItem(r: Row, today: string): MediaItem {
  const info = parseInfo(r.info)
  const episodes = info.episodes ?? []
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    subtitle: r.subtitle,
    image: r.image,
    url: r.url,
    extId: r.ext_id,
    status: r.status,
    rating: r.rating,
    notes: r.notes,
    progress: r.progress,
    // A show's total is the episodes out so far (it grows as new ones air)
    total: r.kind === 'show' && episodes.length ? episodes.filter((e) => e.date && e.date <= today).length : r.total,
    year: info.year ?? null,
    genres: info.genres ?? [],
    summary: info.summary ?? '',
    episodes,
    nextEpisode: episodes.find((e) => e.date > today) ?? (info.next && info.next.date > today ? info.next : null),
    startedOn: r.started_on,
    finishedOn: r.finished_on,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listMedia(db: Db, now = Date.now()): MediaItem[] {
  const today = localDay(now)
  return (db.prepare('SELECT * FROM media WHERE deleted_at IS NULL ORDER BY created_at DESC').all() as unknown as Row[]).map((r) => toItem(r, today))
}

export function getMedia(db: Db, id: string, now = Date.now()): MediaItem {
  const r = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as Row | undefined
  if (!r) throw new Error('Not found')
  return toItem(r, localDay(now))
}

// ---------- Looking things up ----------

const year = (v: unknown): number | null => {
  const n = Number(String(v ?? '').slice(0, 4))
  return n > 1800 && n < 2200 ? n : null
}
const join = (...parts: (string | number | null | undefined)[]): string => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ')

/** IMDb's poster links take a size: a small one loads much faster */
export const smallPoster = (url: string): string => url.replace(/\._V1_.*\.jpg$/, '._V1_QL75_UX300_.jpg')

export function parseImdb(json: string): MediaResult[] {
  const d = (JSON.parse(json) as { d?: { id: string; l: string; y?: number; s?: string; q?: string; qid?: string; i?: { imageUrl: string } }[] }).d ?? []
  return d
    .filter((x) => x.id?.startsWith('tt') && /movie|feature|short|video/i.test(`${x.qid ?? ''} ${x.q ?? ''}`) && !/series|episode|game/i.test(`${x.qid ?? ''} ${x.q ?? ''}`))
    .map((x) => ({
      kind: 'movie' as const,
      extId: x.id,
      title: x.l,
      subtitle: join(x.y, x.s),
      image: x.i?.imageUrl ? smallPoster(x.i.imageUrl) : '',
      url: `https://www.imdb.com/title/${x.id}/`,
      year: x.y ?? null,
      summary: x.s ? `Starring ${x.s}` : '',
      total: 0,
      genres: []
    }))
}

export interface TvShow {
  id: number
  type?: string
  language?: string | null
  weight?: number
  rating?: { average: number | null } | null
  name: string
  url: string
  premiered?: string | null
  genres?: string[]
  summary?: string | null
  image?: { medium?: string; original?: string } | null
  network?: { name: string } | null
  webChannel?: { name: string } | null
  _embedded?: { episodes?: TvEpisode[]; nextepisode?: TvEpisode }
}
interface TvEpisode {
  name: string
  season: number
  number: number | null
  airdate: string
}

export const showResult = (s: TvShow): MediaResult => ({
  kind: 'show',
  extId: String(s.id),
  title: s.name,
  subtitle: join(year(s.premiered), s.network?.name ?? s.webChannel?.name),
  image: s.image?.medium ?? '',
  url: s.url,
  year: year(s.premiered),
  summary: htmlToText(s.summary ?? ''),
  total: 0,
  genres: s.genres ?? [],
  score: s.rating?.average ?? undefined
})

export const parseTvSearch = (json: string): MediaResult[] => (JSON.parse(json) as { show: TvShow }[]).map((r) => showResult(r.show))

const episode = (e: TvEpisode): MediaEpisode => ({ s: e.season, e: e.number ?? 0, date: e.airdate ?? '', name: e.name ?? '' })

/** A show's episodes in order (specials left out) and the next one to air */
export function parseTvShow(json: string): { result: MediaResult; episodes: MediaEpisode[]; next: MediaEpisode | null } {
  const s = JSON.parse(json) as TvShow
  const episodes = (s._embedded?.episodes ?? []).filter((e) => e.number !== null).map(episode).sort((a, b) => a.s - b.s || a.e - b.e)
  return { result: showResult(s), episodes, next: s._embedded?.nextepisode ? episode(s._embedded.nextepisode) : null }
}

interface OlDoc {
  key: string
  title: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  number_of_pages_median?: number
  subject?: string[]
}

/** Open Library search results (docs) or a trending list (works) */
export function parseOpenLibrary(json: string): MediaResult[] {
  const parsed = JSON.parse(json) as { docs?: OlDoc[]; works?: OlDoc[] }
  const docs = parsed.docs ?? parsed.works ?? []
  return docs.map((b) => ({
    kind: 'book' as const,
    extId: b.key,
    title: b.title,
    subtitle: join((b.author_name ?? []).slice(0, 2).join(', '), b.first_publish_year),
    image: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : '',
    url: `https://openlibrary.org${b.key}`,
    year: b.first_publish_year ?? null,
    summary: '',
    total: b.number_of_pages_median ?? 0,
    genres: (b.subject ?? []).filter((x) => x.length < 24 && !/[:=]/.test(x)).slice(0, 3)
  }))
}

export function parseGames(json: string): MediaResult[] {
  return (JSON.parse(json) as { gameID: string; steamAppID: string | null; external: string; thumb: string; cheapest?: string }[]).map((g) => ({
    kind: 'game' as const,
    extId: g.steamAppID ? `steam:${g.steamAppID}` : `cheapshark:${g.gameID}`,
    title: g.external,
    subtitle: g.steamAppID ? 'PC (Steam)' : 'PC',
    image: g.steamAppID ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steamAppID}/header.jpg` : g.thumb,
    url: g.steamAppID ? `https://store.steampowered.com/app/${g.steamAppID}` : `https://www.cheapshark.com/search#q:${encodeURIComponent(g.external)}`,
    year: null,
    summary: g.cheapest ? `Cheapest right now: $${g.cheapest}` : '',
    total: 0,
    genres: []
  }))
}

export async function searchMedia(kind: MediaKind, query: string, fetchText: FetchText): Promise<MediaResult[]> {
  const q = query.trim()
  if (!q) return []
  const e = encodeURIComponent(q)
  if (kind === 'movie') return parseImdb(await fetchText(`https://v2.sg.media-imdb.com/suggestion/${(q[0] ?? 'x').toLowerCase().replace(/[^a-z0-9]/, 'x')}/${e}.json`)).slice(0, 10)
  if (kind === 'show') return parseTvSearch(await fetchText(`https://api.tvmaze.com/search/shows?q=${e}`)).slice(0, 10)
  if (kind === 'book') return parseOpenLibrary(await fetchText(`https://openlibrary.org/search.json?q=${e}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject`))
  return parseGames(await fetchText(`https://www.cheapshark.com/api/1.0/games?title=${e}&limit=10`))
}

// ---------- Your list ----------

const today = (): string => localDay(Date.now())

export async function addMedia(db: Db, item: MediaResult | { kind: MediaKind; title: string }, status: MediaStatus = 'want', fetchText?: FetchText, now = Date.now()): Promise<MediaItem> {
  const r: MediaResult = 'extId' in item ? item : { kind: item.kind, title: item.title.trim(), extId: '', subtitle: '', image: '', url: '', year: null, summary: '', total: 0, genres: [] }
  if (!r.title) throw new Error('Type a name first')
  if (r.extId) {
    const dup = db.prepare('SELECT id FROM media WHERE kind = ? AND ext_id = ? AND deleted_at IS NULL').get(r.kind, r.extId) as { id: string } | undefined
    if (dup) throw new Error('Already on your list')
  }
  const id = newId()
  const info: Info = { year: r.year, genres: r.genres, summary: r.summary }
  db.prepare(
    `INSERT INTO media (id, kind, title, subtitle, image, url, ext_id, status, total, info, started_on, finished_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, r.kind, r.title, r.subtitle, r.image, r.url, r.extId, status, r.total, JSON.stringify(info), status === 'doing' ? localDay(now) : null, status === 'done' ? localDay(now) : null, now, now)
  if (r.kind === 'show' && r.extId && fetchText) await refreshShow(db, id, fetchText, now).catch(() => undefined)
  return getMedia(db, id, now)
}

export function updateMedia(db: Db, id: string, patch: MediaPatch, now = Date.now()): MediaItem {
  const before = getMedia(db, id, now)
  const day = localDay(now)
  const next: MediaPatch = { ...patch }
  if (patch.status && patch.status !== before.status) {
    if (patch.status === 'doing' && !before.startedOn && patch.startedOn === undefined) next.startedOn = day
    if (patch.status === 'done') {
      if (!before.finishedOn && patch.finishedOn === undefined) next.finishedOn = day
      // Finished: every page read, every episode so far watched
      if ((before.kind === 'book' || before.kind === 'show') && patch.progress === undefined && before.total) next.progress = before.total
    }
  }
  // Read to the last page or watched the last episode out: done (unless more episodes are coming)
  if (patch.progress !== undefined && before.total && patch.progress >= before.total && before.status === 'doing' && !(before.kind === 'show' && before.nextEpisode)) {
    next.status = 'done'
    if (!before.finishedOn) next.finishedOn = day
  }
  if (patch.progress !== undefined && patch.progress > 0 && before.status === 'want' && !patch.status) {
    next.status = 'doing'
    if (!before.startedOn) next.startedOn = day
  }
  const cols: Record<keyof MediaPatch, string> = { title: 'title', subtitle: 'subtitle', status: 'status', rating: 'rating', notes: 'notes', progress: 'progress', total: 'total', startedOn: 'started_on', finishedOn: 'finished_on' }
  const sets: string[] = []
  const vals: (string | number | null)[] = []
  for (const [k, v] of Object.entries(next) as [keyof MediaPatch, string | number | null | undefined][]) {
    if (v === undefined || !cols[k]) continue
    sets.push(`${cols[k]} = ?`)
    vals.push(k === 'rating' ? Math.max(0, Math.min(5, Math.round(Number(v)))) : k === 'progress' || k === 'total' ? Math.max(0, Math.round(Number(v))) : v)
  }
  if (sets.length) db.prepare(`UPDATE media SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now, id)
  return getMedia(db, id, now)
}

export function removeMedia(db: Db, id: string, now = Date.now()): void {
  db.prepare('UPDATE media SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

/** A show's episodes and next air date from TVmaze */
export async function refreshShow(db: Db, id: string, fetchText: FetchText, now = Date.now()): Promise<void> {
  const row = db.prepare('SELECT ext_id, info FROM media WHERE id = ?').get(id) as { ext_id: string; info: string } | undefined
  if (!row?.ext_id) return
  const { result, episodes, next } = parseTvShow(await fetchText(`https://api.tvmaze.com/shows/${row.ext_id}?embed[]=episodes&embed[]=nextepisode`))
  const info: Info = { ...parseInfo(row.info), year: result.year, genres: result.genres, summary: result.summary, episodes, next, checkedAt: now }
  db.prepare('UPDATE media SET info = ?, image = CASE WHEN image = \'\' THEN ? ELSE image END, updated_at = ? WHERE id = ?').run(JSON.stringify(info), result.image, now, id)
}

/** Checks your shows for new episodes (each at most once a day); returns your list */
export async function refreshMedia(db: Db, fetchText: FetchText, now = Date.now()): Promise<MediaItem[]> {
  const shows = db.prepare("SELECT id, info FROM media WHERE kind = 'show' AND ext_id != '' AND status != 'dropped' AND deleted_at IS NULL").all() as { id: string; info: string }[]
  for (const s of shows) {
    if (now - (parseInfo(s.info).checkedAt ?? 0) < 20 * 3_600_000) continue
    await refreshShow(db, s.id, fetchText, now).catch(() => undefined)
  }
  return listMedia(db, now)
}

/** Episodes of your shows that come out on a day (for the notification) */
export function episodesOn(items: MediaItem[], day: string = today()): { item: MediaItem; episode: MediaEpisode }[] {
  return items.filter((m) => m.kind === 'show' && m.status !== 'dropped').flatMap((item) => item.episodes.filter((e) => e.date === day).map((episode) => ({ item, episode })))
}
