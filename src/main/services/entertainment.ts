import type { Db } from '../db'
import { newId } from '../db'
import type { EntChannel, EntFeed, EntLive, EntVideo, PodcastResult } from '../../shared/api'
import { decodeEntities, feedTitle, parseFeed, storeItems, type FetchText, type RawItem } from './news'
import { getSetting, setSetting } from './settings'

/**
 * Entertainment: new uploads from YouTube channels (each channel's public video feed) and which Twitch streamers
 * are live (read from their public channel page). No accounts or keys. Channels are a synced setting; videos are
 * stored per device in `news_items` (source = the channel), live status in the local setting `ent.live`.
 */

export function entChannels(db: Db): EntChannel[] {
  const saved = getSetting(db, 'ent.channels')
  return Array.isArray(saved) ? (saved as EntChannel[]) : []
}

const metaContent = (html: string, prop: string): string => {
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html)
  return m ? decodeEntities(m[1]) : ''
}

/** A YouTube channel from a link, @handle or channel id */
export async function resolveYouTube(input: string, fetchText: FetchText): Promise<EntChannel> {
  const s = input.trim()
  const direct = /(UC[\w-]{22})/.exec(s)?.[1]
  let url = s
  if (!direct) {
    if (/^@?[\w.-]+$/.test(s)) url = `https://www.youtube.com/@${s.replace(/^@/, '')}`
    else if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  }
  if (direct) {
    const xml = await youtubeFeed(direct, fetchText)
    const name = decodeEntities(/<title>([^<]*)<\/title>/.exec(xml)?.[1] ?? 'YouTube channel')
    return { id: newId(), kind: 'youtube', name, handle: direct, url: `https://www.youtube.com/channel/${direct}` }
  }
  const html = await fetchText(url)
  const channelId = /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ?? /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html)?.[1] ?? /channel_id=(UC[\w-]{22})/.exec(html)?.[1]
  if (!channelId) throw new Error('Couldn’t find that YouTube channel')
  const name = metaContent(html, 'og:title') || 'YouTube channel'
  return { id: newId(), kind: 'youtube', name, handle: channelId, url: `https://www.youtube.com/channel/${channelId}` }
}

/** A Twitch streamer from a link or name */
export function resolveTwitch(input: string): EntChannel {
  const login = /twitch\.tv\/([\w]+)/i.exec(input)?.[1] ?? input.trim().replace(/^@/, '')
  if (!/^\w{2,25}$/.test(login)) throw new Error('That doesn’t look like a Twitch name')
  return { id: newId(), kind: 'twitch', name: login, handle: login.toLowerCase(), url: `https://www.twitch.tv/${login.toLowerCase()}` }
}

/** A subreddit's top posts of the day */
export const redditFeedUrl = (sub: string): string => `https://www.reddit.com/r/${sub}/top/.rss?t=day`

/** Posts from a subreddit's feed, without Reddit's "submitted by … [link] [comments]" line */
export function redditPosts(xml: string, now = Date.now()): RawItem[] {
  return parseFeed(xml, now)
    .slice(0, 25)
    .map((p) => ({ ...p, summary: p.summary.replace(/\s*submitted by[\s\S]*$/i, '').trim() }))
}

/** A subreddit from a link, r/name or name (checked by reading its feed) */
export async function resolveReddit(input: string, fetchText: FetchText): Promise<{ channel: EntChannel; items: RawItem[] }> {
  const sub = /reddit\.com\/r\/(\w+)/i.exec(input)?.[1] ?? /^\/?r\/(\w+)/i.exec(input.trim())?.[1] ?? input.trim()
  if (!/^\w{2,21}$/.test(sub)) throw new Error('That doesn’t look like a subreddit name')
  let xml: string
  try {
    xml = await fetchText(redditFeedUrl(sub))
  } catch {
    throw new Error('Couldn’t find that subreddit (or Reddit is busy; try again in a minute)')
  }
  if (!/<feed/i.test(xml)) throw new Error('Couldn’t find that subreddit')
  return { channel: { id: newId(), kind: 'reddit', name: `r/${sub}`, handle: sub.toLowerCase(), url: `https://www.reddit.com/r/${sub}` }, items: redditPosts(xml) }
}

/** Podcasts by name, from Apple's podcast directory (no account needed) */
export function parsePodcastSearch(json: string): PodcastResult[] {
  const r = (JSON.parse(json) as { results?: { collectionName?: string; artistName?: string; artworkUrl600?: string; artworkUrl100?: string; feedUrl?: string }[] }).results ?? []
  return r.filter((p) => p.feedUrl).map((p) => ({ name: p.collectionName ?? 'Podcast', author: p.artistName ?? '', image: p.artworkUrl600 ?? p.artworkUrl100 ?? '', feedUrl: p.feedUrl! }))
}

export async function findPodcasts(query: string, fetchText: FetchText): Promise<PodcastResult[]> {
  if (!query.trim()) return []
  return parsePodcastSearch(await fetchText(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10&term=${encodeURIComponent(query.trim())}`))
}

/** A podcast from its feed address */
export async function resolvePodcast(feedUrl: string, fetchText: FetchText): Promise<{ channel: EntChannel; items: RawItem[] }> {
  const url = /^https?:\/\//i.test(feedUrl.trim()) ? feedUrl.trim() : `https://${feedUrl.trim()}`
  const xml = await fetchText(url)
  if (!/<rss|<feed/i.test(xml)) throw new Error('That isn’t a podcast feed')
  const head = xml.split(/<item[\s>]/i)[0]
  const image = decodeEntities(/<itunes:image[^>]+href=["']([^"']+)["']/i.exec(head)?.[1] ?? /<image>[\s\S]*?<url>([^<]+)<\/url>/i.exec(head)?.[1] ?? '')
  const link = /<link>([^<]+)<\/link>/i.exec(head)?.[1]?.trim()
  return { channel: { id: newId(), kind: 'podcast', name: feedTitle(xml) || 'Podcast', handle: url, url: link || url, image }, items: parseFeed(xml).slice(0, 20) }
}

/** Live or not, from a Twitch channel page (its search-engine data says isLiveBroadcast when live) */
/** Streams that are replays, not live: left out of Live now (and no notification) */
export const RERUN = /\b(?:re-?runs?|re-?broadcasts?|re-?streams?|replay|vod|reupload)\b/i

export function parseTwitchPage(html: string, channel: EntChannel, now = Date.now()): EntLive & { displayName: string } {
  const broadcasting = /"isLiveBroadcast"\s*:\s*true/.test(html)
  const streamTitle = broadcasting ? decodeEntities(/"description":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1]?.replace(/\\(.)/g, '$1') ?? '') || metaContent(html, 'og:description') : ''
  const live = broadcasting && !RERUN.test(streamTitle)
  const ogTitle = metaContent(html, 'og:title')
  const displayName = ogTitle.replace(/\s+-\s+(?:Live on )?Twitch\s*$/i, '').trim() || channel.name
  return {
    channelId: channel.id,
    name: displayName,
    displayName,
    live,
    // While live, the page’s search-engine data describes the stream with its title
    title: live ? streamTitle : '',
    url: channel.url,
    image: live ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel.handle}-440x248.jpg?t=${Math.floor(now / 300_000)}` : '',
    checkedAt: now
  }
}

const AGO: Record<string, number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 }

/**
 * The newest videos from a channel's Videos page (used when its feed is broken, which YouTube does for some channels):
 * id, title and "3 days ago" from each entry of the page's data.
 */
export function parseChannelVideos(html: string, now = Date.now()): RawItem[] {
  const mark = '"richItemRenderer":{"content":{"lockupViewModel"'
  const out: RawItem[] = []
  let at = html.indexOf(mark)
  while (at >= 0 && out.length < 15) {
    const next = html.indexOf(mark, at + mark.length)
    const part = html.slice(at, next < 0 ? at + 12000 : next)
    at = next
    const id = /\/vi\/([\w-]{11})\//.exec(part)?.[1]
    const rawTitle = /"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(part)?.[1]
    if (!id || !rawTitle) continue
    let title = rawTitle
    try {
      title = JSON.parse(`"${rawTitle}"`) as string
    } catch {
      /* keep it as written */
    }
    const ago = /(\d+) (second|minute|hour|day|week|month|year)s? ago/.exec(part)
    out.push({
      guid: `yt:video:${id}`, // the same id the feed uses, so a video is never listed twice
      title,
      summary: '',
      url: `https://www.youtube.com/watch?v=${id}`,
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      publishedAt: ago ? now - Number(ago[1]) * AGO[ago[2]] : now,
      category: ''
    })
  }
  return out
}

/** A channel's newest videos: its feed, or its Videos page when YouTube's feed for it is broken */
export async function youtubeVideos(channelId: string, fetchText: FetchText, now = Date.now(), wait?: (ms: number) => Promise<unknown>): Promise<RawItem[]> {
  try {
    return parseFeed(await youtubeFeed(channelId, fetchText, 2, wait), now)
  } catch {
    const items = parseChannelVideos(await fetchText(`https://www.youtube.com/channel/${channelId}/videos`), now)
    if (!items.length) throw new Error('YouTube didn’t list any videos')
    return items
  }
}

/** Runs jobs a few at a time (so 60 channels don't hit YouTube and Twitch all at once) */
async function inBatches<T>(items: T[], size: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await job(items[next++])
    })
  )
}

/** YouTube's feed answers 404 now and then for no reason: try a few times */
export async function youtubeFeed(channelId: string, fetchText: FetchText, tries = 4, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
      if (xml.includes('<feed')) return xml
    } catch (e) {
      last = e
    }
    if (i < tries - 1) await wait(700 * (i + 1))
  }
  throw last instanceof Error ? last : new Error('YouTube didn’t answer')
}

export function entFeed(db: Db): EntFeed {
  const channels = entChannels(db)
  const withItems = channels.filter((c) => c.kind !== 'twitch')
  const byId = new Map(withItems.map((c) => [c.id, c]))
  const ids = withItems.map((c) => c.id)
  const rows = ids.length
    ? (db
        .prepare(`SELECT id, source_id, title, summary, url, image, audio, published_at, read_at, saved FROM news_items WHERE hidden = 0 AND source_id IN (${ids.map(() => '?').join(',')}) ORDER BY published_at DESC LIMIT 600`)
        .all(...ids) as { id: string; source_id: string; title: string; summary: string; url: string; image: string; audio: string; published_at: number; read_at: number | null; saved: number }[])
    : []
  const videos: EntVideo[] = rows.map((r) => {
    const c = byId.get(r.source_id)
    return {
      id: r.id,
      channelId: r.source_id,
      channelName: c?.name ?? '',
      title: r.title,
      url: r.url,
      image: r.image || c?.image || '',
      publishedAt: r.published_at,
      short: /\/shorts\//.test(r.url),
      watched: r.read_at !== null,
      kind: c?.kind === 'reddit' || c?.kind === 'podcast' ? c.kind : 'youtube',
      summary: c?.kind === 'youtube' ? '' : r.summary,
      audio: r.audio,
      saved: r.saved === 1
    }
  })
  const liveMap = (getSetting(db, 'ent.live') as Record<string, EntLive> | null) ?? {}
  const live = channels
    .filter((c) => c.kind === 'twitch')
    .map((c) => liveMap[c.id] ?? { channelId: c.id, name: c.name, live: false, title: '', url: c.url, image: '', checkedAt: 0 })
    .sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name))
  const errors = getSetting(db, 'ent.errors')
  return { channels, videos, live, refreshedAt: (getSetting(db, 'ent.refreshedAt') as number | null) ?? null, errors: Array.isArray(errors) ? (errors as EntFeed['errors']) : [] }
}

/** New uploads and who's live, for every channel */
export async function refreshEntertainment(db: Db, fetchText: FetchText, now = Date.now()): Promise<{ feed: EntFeed; wentLive: EntLive[] }> {
  const channels = entChannels(db)
  const before = (getSetting(db, 'ent.live') as Record<string, EntLive> | null) ?? {}
  const live: Record<string, EntLive> = {}
  // Reddit and podcasts change slowly (and Reddit turns away readers who ask too often): every 30 minutes
  const slowDue = now - ((getSetting(db, 'ent.slowAt') as number | null) ?? 0) > 30 * 60_000
  const checked = channels.filter((c) => slowDue || c.kind === 'youtube' || c.kind === 'twitch')
  const earlier = getSetting(db, 'ent.errors')
  const errors: EntFeed['errors'] = (Array.isArray(earlier) ? (earlier as EntFeed['errors']) : []).filter((e) => channels.some((c) => c.id === e.channelId) && !checked.some((c) => c.id === e.channelId))
  await inBatches(checked, 6, async (c) => {
      try {
        if (c.kind === 'youtube') {
          storeItems(db, c.id, (await youtubeVideos(c.handle, fetchText, now)).slice(0, 15), now)
        } else if (c.kind === 'reddit') {
          storeItems(db, c.id, redditPosts(await fetchText(redditFeedUrl(c.handle)), now), now)
        } else if (c.kind === 'podcast') {
          storeItems(db, c.id, parseFeed(await fetchText(c.handle), now).slice(0, 20), now)
        } else {
          const { displayName, ...status } = parseTwitchPage(await fetchText(c.url), c, now)
          live[c.id] = { ...status, name: displayName }
        }
      } catch (e) {
        errors.push({ channelId: c.id, message: e instanceof Error ? e.message : String(e) })
        if (before[c.id]) live[c.id] = before[c.id]
      }
  })
  if (slowDue) setSetting(db, 'ent.slowAt', now)
  setSetting(db, 'ent.live', live)
  setSetting(db, 'ent.errors', errors)
  setSetting(db, 'ent.refreshedAt', now)
  const wentLive = Object.values(live).filter((l) => l.live && !before[l.channelId]?.live)
  return { feed: entFeed(db), wentLive }
}

export async function addChannel(db: Db, input: string, kind: EntChannel['kind'] | undefined, fetchText: FetchText): Promise<EntChannel> {
  const k = kind ?? (/twitch\.tv/i.test(input) ? 'twitch' : /reddit\.com|^\/?r\//i.test(input.trim()) ? 'reddit' : 'youtube')
  let items: RawItem[] = []
  let channel: EntChannel
  if (k === 'reddit' || k === 'podcast') ({ channel, items } = await (k === 'reddit' ? resolveReddit(input, fetchText) : resolvePodcast(input, fetchText)))
  else channel = k === 'twitch' ? resolveTwitch(input) : await resolveYouTube(input, fetchText)
  const channels = entChannels(db)
  if (channels.some((c) => c.kind === channel.kind && c.handle === channel.handle)) throw new Error('Already added')
  setSetting(db, 'ent.channels', [...channels, channel])
  if (items.length) storeItems(db, channel.id, items)
  return channel
}

export function removeChannel(db: Db, id: string): void {
  setSetting(db, 'ent.channels', entChannels(db).filter((c) => c.id !== id))
  db.prepare('DELETE FROM news_items WHERE source_id = ? AND saved = 0').run(id)
}

export function entStale(db: Db, now = Date.now(), minutes = 10): boolean {
  if (!entChannels(db).length) return false
  const at = getSetting(db, 'ent.refreshedAt') as number | null
  return !at || now - at > minutes * 60_000
}
