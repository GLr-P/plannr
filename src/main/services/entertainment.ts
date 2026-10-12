import type { Db } from '../db'
import { newId } from '../db'
import type { EntChannel, EntFeed, EntLive, EntVideo } from '../../shared/api'
import { decodeEntities, parseFeed, storeItems, type FetchText } from './news'
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

/** Live or not, from a Twitch channel page (its search-engine data says isLiveBroadcast when live) */
export function parseTwitchPage(html: string, channel: EntChannel, now = Date.now()): EntLive & { displayName: string } {
  const live = /"isLiveBroadcast"\s*:\s*true/.test(html)
  const ogTitle = metaContent(html, 'og:title')
  const displayName = ogTitle.replace(/\s+-\s+(?:Live on )?Twitch\s*$/i, '').trim() || channel.name
  return {
    channelId: channel.id,
    name: displayName,
    displayName,
    live,
    // While live, the page's search-engine data describes the stream with its title
    title: live ? decodeEntities(/"description":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1]?.replace(/\\(.)/g, '$1') ?? '') || metaContent(html, 'og:description') : '',
    url: channel.url,
    image: live ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel.handle}-440x248.jpg?t=${Math.floor(now / 300_000)}` : '',
    checkedAt: now
  }
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
  const yt = channels.filter((c) => c.kind === 'youtube')
  const byId = new Map(yt.map((c) => [c.id, c]))
  const ids = yt.map((c) => c.id)
  const rows = ids.length
    ? (db
        .prepare(`SELECT id, source_id, title, url, image, published_at, read_at FROM news_items WHERE hidden = 0 AND source_id IN (${ids.map(() => '?').join(',')}) ORDER BY published_at DESC LIMIT 200`)
        .all(...ids) as { id: string; source_id: string; title: string; url: string; image: string; published_at: number; read_at: number | null }[])
    : []
  const videos: EntVideo[] = rows.map((r) => ({
    id: r.id,
    channelId: r.source_id,
    channelName: byId.get(r.source_id)?.name ?? '',
    title: r.title,
    url: r.url,
    image: r.image,
    publishedAt: r.published_at,
    short: /\/shorts\//.test(r.url),
    watched: r.read_at !== null
  }))
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
  const errors: EntFeed['errors'] = []
  const before = (getSetting(db, 'ent.live') as Record<string, EntLive> | null) ?? {}
  const live: Record<string, EntLive> = {}
  await Promise.all(
    channels.map(async (c) => {
      try {
        if (c.kind === 'youtube') {
          storeItems(db, c.id, parseFeed(await youtubeFeed(c.handle, fetchText), now).slice(0, 15), now)
        } else {
          const { displayName, ...status } = parseTwitchPage(await fetchText(c.url), c, now)
          live[c.id] = { ...status, name: displayName }
        }
      } catch (e) {
        errors.push({ channelId: c.id, message: e instanceof Error ? e.message : String(e) })
        if (before[c.id]) live[c.id] = before[c.id]
      }
    })
  )
  setSetting(db, 'ent.live', live)
  setSetting(db, 'ent.errors', errors)
  setSetting(db, 'ent.refreshedAt', now)
  const wentLive = Object.values(live).filter((l) => l.live && !before[l.channelId]?.live)
  return { feed: entFeed(db), wentLive }
}

export async function addChannel(db: Db, input: string, kind: 'youtube' | 'twitch' | undefined, fetchText: FetchText): Promise<EntChannel> {
  const k = kind ?? (/twitch\.tv/i.test(input) ? 'twitch' : 'youtube')
  const channel = k === 'twitch' ? resolveTwitch(input) : await resolveYouTube(input, fetchText)
  const channels = entChannels(db)
  if (channels.some((c) => c.kind === channel.kind && c.handle === channel.handle)) throw new Error('Already added')
  setSetting(db, 'ent.channels', [...channels, channel])
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
