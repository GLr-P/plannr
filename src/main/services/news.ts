import type { Db } from '../db'
import { newId, tx } from '../db'
import type { NewsFeed, NewsItem, NewsPlace, NewsPrefs, NewsSource, NewsSourceKind, NewsTopic, NewsWeather } from '../../shared/api'
import { findWhen, ymd } from '../../shared/news-dates'
import { getSetting, setSetting } from './settings'

/**
 * Local news: RSS/Atom feeds, news web pages without a feed, road events and the weather, stored in
 * `news_items` (this device only) and sorted into topics when read, so changing your topics or muted words
 * applies right away. Sources and preferences are settings that sync between devices.
 * Downloading goes through `fetchText` (the PC fetches directly; the phone through the sync service).
 */

export type FetchText = (url: string) => Promise<string>

export const DEFAULT_NEWS_PREFS: NewsPrefs = {
  place: null,
  hideTopics: ['sad', 'markets'],
  muted: [],
  boost: [],
  keepDays: 21,
  notifyUrgent: true
}

// ---------- Reading feeds and pages ----------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  eacute: 'é',
  deg: '°'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Plain text from a bit of HTML */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/<\/?[a-z][^>]*>/gi, ' ') // markup that was written escaped (&lt;img …&gt;)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim()
}

const cdata = (s: string): string => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

function tagBody(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? m[1] : undefined
}

function tagAttr(block: string, name: string, attr: string, where?: RegExp): string | undefined {
  for (const m of block.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))) {
    if (where && !where.test(m[0])) continue
    const a = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i').exec(m[0])
    if (a) return decodeEntities(a[1])
  }
  return undefined
}

/** A tag's text, whether it's escaped XML or CDATA holding HTML */
function tagText(block: string, name: string): string {
  const raw = tagBody(block, name)
  if (raw === undefined) return ''
  return htmlToText(raw.includes('<![CDATA[') ? cdata(raw) : decodeEntities(raw))
}

export interface RawItem {
  guid: string
  title: string
  summary: string
  url: string
  image: string
  publishedAt: number
  category: string
}

const cleanSummary = (summary: string, title: string): string => {
  const s = summary.replace(/\s+/g, ' ').trim()
  // Google News repeats the headline (and its source) as the description
  return s && !s.toLowerCase().startsWith(title.toLowerCase().slice(0, 40)) ? s.slice(0, 600) : ''
}

/** Stories in an RSS or Atom feed */
export function parseFeed(xml: string, now = Date.now()): RawItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  const out: RawItem[] = []
  for (const b of blocks) {
    const title = tagText(b, 'title')
    if (!title) continue
    const link = (tagBody(b, 'link') ?? '').trim()
    const url = (link && !link.startsWith('<') ? decodeEntities(cdata(link)) : '') || tagAttr(b, 'link', 'href', /rel=["']alternate["']/) || tagAttr(b, 'link', 'href') || ''
    const rawSummary = tagBody(b, 'description') ?? tagBody(b, 'summary') ?? tagBody(b, 'content') ?? ''
    const summaryHtml = rawSummary.includes('<![CDATA[') ? cdata(rawSummary) : decodeEntities(rawSummary)
    const image =
      tagAttr(b, 'enclosure', 'url', /type=["']image/) ||
      tagAttr(b, 'media:content', 'url', /medium=["']image|type=["']image/) ||
      tagAttr(b, 'media:thumbnail', 'url') ||
      tagAttr(summaryHtml, 'img', 'src') ||
      ''
    const date = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date')
    const parsed = Date.parse(date)
    out.push({
      guid: tagText(b, 'guid') || tagText(b, 'id') || url || title,
      title,
      summary: cleanSummary(htmlToText(summaryHtml), title),
      url,
      image: /^https?:\/\//.test(image) ? image : '',
      publishedAt: Number.isFinite(parsed) ? parsed : now,
      category: tagAttr(b, 'category', 'term') || tagText(b, 'category')
    })
  }
  return out
}

/** The feed's own name */
export function feedTitle(xml: string): string {
  const head = xml.split(/<item[\s>]|<entry[\s>]/i)[0]
  return tagText(head, 'title')
}

const resolve = (href: string, base: string): string => {
  try {
    return new URL(decodeEntities(href), base).toString()
  } catch {
    return ''
  }
}

/**
 * Stories on a news web page that has no feed: links to pages under the page's own address (a listing at
 * /community/news-alerts links to /community/news-alerts/<story>), with the date and text that follow each.
 */
export function parsePage(html: string, pageUrl: string, now = Date.now()): RawItem[] {
  const base = new URL(pageUrl)
  const prefix = base.pathname.replace(/\/+$/, '') + '/'
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, '')
  const anchors = [...body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ url: resolve(m[1], pageUrl), text: htmlToText(m[2]), at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
    .filter((a) => {
      if (!a.url || a.text.length < 8) return false
      const u = new URL(a.url)
      return u.host === base.host && u.pathname.startsWith(prefix) && u.pathname.length > prefix.length && !u.search
    })
  // A story can be linked several times ("More details", the headline, a photo): use its headline link
  const GENERIC = /^(more( details| info(rmation)?)?|read more|learn more|continue reading|details|view|see more|full story|click here|list view|next|previous|older|newer)\W*$/i
  const best = new Map<string, (typeof anchors)[number]>()
  for (const a of anchors) {
    const had = best.get(a.url)
    if (!had || (GENERIC.test(had.text) && !GENERIC.test(a.text))) best.set(a.url, a)
  }
  const seen = new Set<string>()
  const out: RawItem[] = []
  anchors.forEach((a, i) => {
    if (seen.has(a.url) || best.get(a.url) !== a || GENERIC.test(a.text)) return
    seen.add(a.url)
    // What follows the link until the next story: its date and the first lines of text
    const next = anchors.slice(i + 1).find((b) => b.url !== a.url)
    const after = body.slice(a.end, Math.min(next ? next.at : a.end + 1500, a.end + 1500)).replace(/<[^>]*$/, '') // not half a tag
    const datetime = /datetime=["']([^"']+)["']/i.exec(after)?.[1]
    const text = htmlToText(after)
    const textDate = Date.parse(/([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})/.exec(text)?.[1] ?? '')
    const parsed = datetime ? Date.parse(datetime) : textDate
    const summary = text
      .replace(/^[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}(\s*-\s*[\d:apm ]+)?/, '')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({
      guid: a.url,
      title: a.text.replace(/\s+/g, ' '),
      summary: summary.slice(0, 400),
      url: a.url,
      image: '',
      publishedAt: Number.isFinite(parsed) ? parsed : now,
      category: ''
    })
  })
  return out.slice(0, 40)
}

/** Road events (DriveBC's Open511 feed) */
export function parseRoads(json: string): (RawItem & { severe: boolean })[] {
  const data = JSON.parse(json) as {
    events?: { id: string; headline?: string; event_type?: string; severity?: string; description?: string; updated?: string; created?: string; roads?: { name?: string }[] }[]
  }
  return (data.events ?? []).map((e) => {
    const road = e.roads?.[0]?.name ?? ''
    const kind = (e.event_type ?? e.headline ?? 'Road event').toLowerCase().replace(/_/g, ' ')
    const description = e.description ?? ''
    const what = /^([^.]+)\./.exec(description)?.[1] ?? ''
    const title = `${road ? `${road}: ` : ''}${kind.charAt(0).toUpperCase()}${kind.slice(1)}${what ? ` – ${what}` : ''}`
    return {
      guid: e.id,
      title: title.slice(0, 160),
      summary: description.replace(/Last update:[^.]*\.\s*/i, '').slice(0, 500),
      url: 'https://www.drivebc.ca/',
      image: '',
      publishedAt: Date.parse(e.updated ?? e.created ?? '') || Date.now(),
      category: 'roads',
      severe: e.severity === 'MAJOR' || /\bclosed\b|closure/i.test(description)
    }
  })
}

/** Environment Canada's weather feed for a place: conditions, forecast and any warnings */
export function parseEcWeather(xml: string, now = Date.now()): NewsWeather {
  const entries = parseFeed(xml, now)
  const of = (cat: string): RawItem[] => entries.filter((e) => e.category.toLowerCase().startsWith(cat))
  const current = of('current')[0]
  const temp = current ? /(-?\d+(?:\.\d+)?)\s*°C/.exec(current.title)?.[1] : undefined
  const condition = current ? /Condition:\s*([^\n]+?)(?:\s+Temperature|\n|$)/i.exec(current.summary)?.[1] : undefined
  const warnings = of('warnings').filter((w) => !/^no watches or warnings/i.test(w.title))
  const title = feedTitle(xml)
  const forecast = of('weather forecasts')
    .slice(0, 5)
    .map((f) => {
      const [label, ...rest] = f.title.split(':')
      return { label: label.trim(), text: rest.join(':').trim() }
    })
  // Some stations don't report the sky: then say what the forecast says for now
  const sky = forecast[0] ? `${forecast[0].label}: ${forecast[0].text.split('.')[0]}` : ''
  return {
    place: title.split(' - ')[0] ?? '',
    now: condition?.trim() || sky,
    temp: temp !== undefined ? Math.round(Number(temp)) : null,
    forecast,
    warnings: warnings.map((w) => ({ title: w.title, url: w.url })),
    url: tagAttr(xml.split(/<entry[\s>]/i)[0], 'link', 'href', /rel=["']alternate["']/) || 'https://weather.gc.ca/',
    updatedAt: now
  }
}

const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms',
  99: 'Thunderstorms'
}

/** Open-Meteo's forecast (places outside Canada) */
export function parseOpenMeteo(json: string, place: string, now = Date.now()): NewsWeather {
  const d = JSON.parse(json) as {
    current?: { temperature_2m?: number; weather_code?: number }
    daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] }
  }
  const days = d.daily?.time ?? []
  return {
    place,
    now: WMO[d.current?.weather_code ?? -1] ?? '',
    temp: d.current?.temperature_2m !== undefined ? Math.round(d.current.temperature_2m) : null,
    forecast: days.slice(0, 4).map((day, i) => ({
      label: i === 0 ? 'Today' : new Date(`${day}T12:00`).toLocaleDateString('en-CA', { weekday: 'long' }),
      text: `${WMO[d.daily?.weather_code?.[i] ?? -1] ?? ''}. High ${Math.round(d.daily?.temperature_2m_max?.[i] ?? 0)}, low ${Math.round(d.daily?.temperature_2m_min?.[i] ?? 0)}.`
    })),
    warnings: [],
    url: 'https://open-meteo.com/',
    updatedAt: now
  }
}

// ---------- Topics ----------

const words = (list: string): RegExp => new RegExp(`\\b(?:${list})`, 'i')
/** Checked in this order: the first match wins */
const TOPIC_RULES: [NewsTopic, RegExp][] = [
  ['sad', words('dies\\b|died\\b|dead\\b|death|killed|fatal|obituar|murder|homicide|tragic|tragedy|mourn|funeral|suicide|drown|overdose|body found|remains found|passed away|vigil')],
  ['markets', words('stocks?\\b|tsx|dow jones|nasdaq|s&p|shares\\b|investors?|earnings|markets? (?:close|open|fall|rise|rall)|loonie|oil price|crypto|bitcoin')],
  ['alerts', words('advisor(?:y|ies)|warning|closure|closed\\b|closes\\b|evacuat|boil water|water quality|outage|disruption|shutdown|wildfire|fire ban|burn ban|campfire ban|detour|construction|paving|flood|smoke|air quality|snowfall|storm|emergency|alert\\b|notice\\b|road work|lane closure|highway \\d|hwy|recall|scam')],
  ['civic', words('election|elector|vote\\b|voting|voters?|ballot|candidate|council|mayor|bylaw|budget|property tax|public hearing|referendum|school board|trustee|mla\\b|mp\\b|town hall|regional district|rdos|municipal|grant')],
  ['events', words('festival|concert|market\\b|farmers.? market|fair\\b|parade|open house|event|celebrat|workshop|fundraiser|gala|exhibit|craft|light.?up|halloween|christmas|santa|theatre|theater|movie night|show\\b|performance|tickets|registration|tour\\b|class(?:es)?\\b|run\\b|walk\\b|ceremony')],
  ['crime', words('police|rcmp|arrest|charged|charges|sentenc|court\\b|trial|theft|stolen|assault|robbery|impaired|crash|collision|fraud|suspect|investigat')],
  ['sports', words('hockey|coyotes|vees|canucks|playoff|tournament|league|soccer|baseball|football|golf|curling|athlete|championship|game\\b|vs\\.?\\s|replay:|flohockey|elite prospects|pickleball')],
  ['business', words('business|opens|opening|restaurant|store|winery|wineries|jobs\\b|hiring|economy|tourism|real estate|housing|development')]
]

export function topicOf(text: string, kind: NewsSourceKind): NewsTopic {
  if (kind === 'roads' || kind === 'weather') return 'alerts'
  for (const [topic, re] of TOPIC_RULES) if (re.test(text)) return topic
  return 'community'
}

const URGENT = words('evacuat|boil water|water quality advisory|do not use|wildfire|warning|closed\\b|closure|outage|emergency|shelter in place|disruption')
const ELECTION = words('election|vote\\b|voting|ballot|advance voting|candidates')

const hasWord = (text: string, list: string[]): boolean => list.some((w) => w.trim() && new RegExp(`\\b${w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text))

// ---------- Storing ----------

interface Row {
  id: string
  source_id: string
  title: string
  summary: string
  url: string
  image: string
  published_at: number
  read_at: number | null
  saved: number
  event_id: string | null
  severe: number
  alerted: number
}

export function newsSources(db: Db): NewsSource[] {
  const saved = getSetting(db, 'news.sources')
  return Array.isArray(saved) ? (saved as NewsSource[]) : []
}

export function newsPrefs(db: Db): NewsPrefs {
  const saved = getSetting(db, 'news.prefs') as Partial<NewsPrefs> | null
  return { ...DEFAULT_NEWS_PREFS, ...(saved ?? {}) }
}

export function configureNews(db: Db, patch: { sources?: NewsSource[]; prefs?: Partial<NewsPrefs> }): void {
  if (patch.sources) {
    const clean = patch.sources
      .filter((s) => s && typeof s.url === 'string' && s.url.trim())
      .map((s) => ({ id: s.id || newId(), kind: s.kind, name: (s.name || s.url).trim().slice(0, 80), url: s.url.trim(), enabled: s.enabled !== false, ...(s.important ? { important: true } : {}) }))
    setSetting(db, 'news.sources', clean)
    // Stories of removed sources go too
    const ids = clean.map((s) => s.id)
    db.prepare(`DELETE FROM news_items WHERE saved = 0 AND source_id NOT IN (${ids.map(() => '?').join(',') || "''"})`).run(...ids)
    if (!clean.some((s) => s.kind === 'weather' && s.enabled)) setSetting(db, 'news.weather', null)
  }
  if (patch.prefs) setSetting(db, 'news.prefs', { ...newsPrefs(db), ...patch.prefs })
}

/** A stable id for a story: the same story from the same source keeps its read/saved marks */
export function storyId(sourceId: string, guid: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const s = `${sourceId}|${guid}`
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return `n${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function storeItems(db: Db, sourceId: string, items: (RawItem & { severe?: boolean })[], now = Date.now(), replace = false): void {
  tx(db, () => {
    if (replace) db.prepare('DELETE FROM news_items WHERE source_id = ? AND saved = 0 AND event_id IS NULL').run(sourceId)
    const upsert = db.prepare(`INSERT INTO news_items (id, source_id, title, summary, url, image, published_at, fetched_at, severe)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, url = excluded.url, image = excluded.image,
        published_at = excluded.published_at, fetched_at = excluded.fetched_at, severe = excluded.severe, hidden = news_items.hidden`)
    for (const it of items) upsert.run(storyId(sourceId, it.guid), sourceId, it.title, it.summary, it.url, it.image, it.publishedAt, now, it.severe ? 1 : 0)
  })
}

export function markNews(db: Db, id: string, patch: { read?: boolean; saved?: boolean; hidden?: boolean; eventId?: string | null }): void {
  if (patch.read !== undefined) db.prepare('UPDATE news_items SET read_at = ? WHERE id = ?').run(patch.read ? Date.now() : null, id)
  if (patch.saved !== undefined) db.prepare('UPDATE news_items SET saved = ? WHERE id = ?').run(patch.saved ? 1 : 0, id)
  if (patch.hidden !== undefined) db.prepare('UPDATE news_items SET hidden = ? WHERE id = ?').run(patch.hidden ? 1 : 0, id)
  if (patch.eventId !== undefined) db.prepare('UPDATE news_items SET event_id = ? WHERE id = ?').run(patch.eventId, id)
}

const normTitle = (t: string): string =>
  t
    .replace(/\s+[-–|]\s+[^-–|]{2,40}$/, '') // "Headline - Castanet" (Google News)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Everything stored, sorted into topics with your preferences applied, newest first */
export function newsFeed(db: Db, now = Date.now()): NewsFeed {
  const sources = newsSources(db)
  const prefs = newsPrefs(db)
  const byId = new Map(sources.map((s) => [s.id, s]))
  const rows = db.prepare('SELECT * FROM news_items WHERE hidden = 0 ORDER BY published_at DESC').all() as unknown as Row[]
  const seen = new Set<string>()
  const items: NewsItem[] = []
  const today = ymd(new Date(now))
  // Stories from the sources you chose first, so a Google News copy of the same headline is the one dropped
  const ordered = [...rows].sort((a, b) => Number(byId.get(a.source_id)?.url.includes('news.google.') ?? 0) - Number(byId.get(b.source_id)?.url.includes('news.google.') ?? 0))
  for (const r of ordered) {
    const source = byId.get(r.source_id)
    if (!source || (!source.enabled && !r.saved)) continue
    const key = normTitle(r.title)
    if (seen.has(key)) continue
    seen.add(key)
    const text = `${r.title}. ${r.summary}`
    const topic = topicOf(text, source.kind)
    const ageDays = (now - r.published_at) / 86_400_000
    const boosted = hasWord(text, prefs.boost)
    // When it happens (not for road work or weather, whose dates are how long they last); past dates don't count
    const found = source.kind === 'rss' || source.kind === 'page' ? findWhen(text, new Date(r.published_at)) : null
    const when = found && found.date >= today ? found : null
    const over = found !== null && when === null // about something that has already happened
    const important =
      boosted ||
      r.severe === 1 ||
      (source.kind === 'weather' && ageDays < 3) ||
      (source.important === true && ageDays < 3 && !over) ||
      (topic === 'alerts' && source.kind !== 'roads' && !over && ageDays < 4 && URGENT.test(text)) ||
      (topic === 'civic' && !over && ELECTION.test(text) && (when !== null || ageDays < 2))
    items.push({
      id: r.id,
      sourceId: r.source_id,
      sourceName: source.name,
      sourceKind: source.kind,
      title: r.title,
      summary: r.summary,
      url: r.url,
      image: r.image,
      publishedAt: r.published_at,
      topic,
      important,
      filtered: !boosted && (prefs.hideTopics.includes(topic) || hasWord(text, prefs.muted)),
      when,
      read: r.read_at !== null,
      saved: r.saved === 1,
      eventId: r.event_id
    })
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt)
  const errors = getSetting(db, 'news.errors')
  return {
    items,
    weather: (getSetting(db, 'news.weather') as NewsWeather | null) ?? null,
    sources,
    prefs,
    refreshedAt: (getSetting(db, 'news.refreshedAt') as number | null) ?? null,
    errors: Array.isArray(errors) ? (errors as NewsFeed['errors']) : []
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_r, reject) => setTimeout(() => reject(new Error('Took too long')), ms))])

/** Downloads one source and stores what it has */
async function refreshSource(db: Db, source: NewsSource, fetchText: FetchText, now: number): Promise<void> {
  const text = await withTimeout(fetchText(source.url), 25_000)
  switch (source.kind) {
    case 'rss':
      return storeItems(db, source.id, parseFeed(text, now), now)
    case 'page':
      return storeItems(db, source.id, parsePage(text, source.url, now), now)
    case 'roads':
      // Road events come and go: keep only the current ones
      return storeItems(db, source.id, parseRoads(text), now, true)
    case 'weather': {
      const place = newsPrefs(db).place?.name ?? ''
      const weather = source.url.includes('open-meteo') ? parseOpenMeteo(text, place, now) : parseEcWeather(text, now)
      setSetting(db, 'news.weather', weather)
      // Warnings are stories too, so they show under Need to know (and only while they're in effect)
      return storeItems(
        db,
        source.id,
        weather.warnings.map((w) => ({ guid: `${w.title}`, title: w.title, summary: '', url: w.url || weather.url, image: '', publishedAt: now, category: 'warning', severe: true })),
        now,
        true
      )
    }
    case 'facebook':
      return
  }
}

/**
 * Downloads every enabled source, clears out old stories, and returns the feed plus the urgent stories not
 * announced before (for a notification).
 */
export async function refreshNews(db: Db, fetchText: FetchText, now = Date.now()): Promise<{ feed: NewsFeed; urgent: NewsItem[] }> {
  const sources = newsSources(db).filter((s) => s.enabled && s.kind !== 'facebook')
  const errors: NewsFeed['errors'] = []
  await Promise.all(
    sources.map((s) =>
      refreshSource(db, s, fetchText, now).catch((e: unknown) => {
        errors.push({ sourceId: s.id, message: e instanceof Error ? e.message : String(e) })
      })
    )
  )
  const keep = Math.max(2, newsPrefs(db).keepDays)
  db.prepare('DELETE FROM news_items WHERE saved = 0 AND event_id IS NULL AND published_at < ? AND fetched_at < ?').run(now - keep * 86_400_000, now - 86_400_000)
  setSetting(db, 'news.errors', errors)
  setSetting(db, 'news.refreshedAt', now)
  const feed = newsFeed(db, now)
  const alerted = new Set((db.prepare('SELECT id FROM news_items WHERE alerted = 1').all() as { id: string }[]).map((r) => r.id))
  const urgent = feed.items.filter((i) => i.important && !i.filtered && !alerted.has(i.id) && now - i.publishedAt < 2 * 86_400_000)
  const mark = db.prepare('UPDATE news_items SET alerted = 1 WHERE id = ?')
  for (const i of feed.items.filter((x) => x.important)) mark.run(i.id)
  return { feed, urgent }
}

export function newsStale(db: Db, now = Date.now(), minutes = 30): boolean {
  if (!newsSources(db).some((s) => s.enabled && s.kind !== 'facebook')) return false
  const at = getSetting(db, 'news.refreshedAt') as number | null
  return !at || now - at > minutes * 60_000
}

// ---------- Finding a place and suggesting sources ----------

export async function findPlace(query: string, fetchText: FetchText): Promise<NewsPlace[]> {
  if (!query.trim()) return []
  const json = await fetchText(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=8&language=en&format=json`)
  const data = JSON.parse(json) as { results?: { name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number }[] }
  return (data.results ?? []).map((r) => ({ name: r.name, region: r.admin1 ?? '', country: r.country ?? '', countryCode: (r.country_code ?? '').toUpperCase(), lat: r.latitude, lon: r.longitude }))
}

/** Regional news sites with feeds per town (more can be added here) */
const REGIONAL: { name: string; lat: number; lon: number; url: string }[] = [
  { name: 'Castanet – Kelowna', lat: 49.888, lon: -119.496, url: 'https://www.castanet.net/rss/page-1.xml' },
  { name: 'Castanet – West Kelowna', lat: 49.863, lon: -119.583, url: 'https://www.castanet.net/rss/page-101.xml' },
  { name: 'Castanet – Peachland', lat: 49.774, lon: -119.737, url: 'https://www.castanet.net/rss/page-86.xml' },
  { name: 'Castanet – Vernon', lat: 50.267, lon: -119.272, url: 'https://www.castanet.net/rss/page-2.xml' },
  { name: 'Castanet – Salmon Arm', lat: 50.702, lon: -119.272, url: 'https://www.castanet.net/rss/page-61.xml' },
  { name: 'Castanet – Penticton', lat: 49.491, lon: -119.589, url: 'https://www.castanet.net/rss/page-21.xml' },
  { name: 'Castanet – Oliver / Osoyoos', lat: 49.12, lon: -119.52, url: 'https://www.castanet.net/rss/page-87.xml' },
  { name: 'Castanet – Kamloops', lat: 50.674, lon: -120.327, url: 'https://www.castanet.net/rss/page-48.xml' },
  { name: 'Castanet – Nelson', lat: 49.49, lon: -117.29, url: 'https://www.castanet.net/rss/page-91.xml' }
]

const km = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const r = Math.PI / 180
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r)
  const y = (bLat - aLat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

export function suggestSources(place: NewsPlace): NewsSource[] {
  const cc = place.countryCode || 'US'
  const lang = `en-${cc}`
  const out: NewsSource[] = [
    {
      id: newId(),
      kind: 'rss',
      name: `${place.name} news (Google News)`,
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(`"${place.name}"`)}&hl=${lang}&gl=${cc}&ceid=${cc}:en`,
      enabled: true
    },
    {
      id: newId(),
      kind: 'weather',
      name: `Weather – ${place.name}`,
      url:
        cc === 'CA'
          ? `https://weather.gc.ca/rss/weather/${place.lat.toFixed(2)}_${place.lon.toFixed(2)}_e.xml`
          : `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lon.toFixed(3)}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`,
      enabled: true
    }
  ]
  if (cc === 'CA' && /british columbia/i.test(place.region)) {
    const d = 0.18
    out.push({
      id: newId(),
      kind: 'roads',
      name: `Roads near ${place.name} (DriveBC)`,
      url: `https://api.open511.gov.bc.ca/events?status=ACTIVE&format=json&bbox=${(place.lon - d).toFixed(3)},${(place.lat - d).toFixed(3)},${(place.lon + d).toFixed(3)},${(place.lat + d).toFixed(3)}`,
      enabled: true
    })
  }
  const near = REGIONAL.map((r) => ({ ...r, d: km(place.lat, place.lon, r.lat, r.lon) }))
    .filter((r) => r.d < 70)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
  for (const r of near) out.push({ id: newId(), kind: 'rss', name: r.name, url: r.url, enabled: true })
  return out
}

/** A name for a web page source: "News | Osoyoos | Canada's warmest welcome" → "Osoyoos – News" */
export function sourceName(title: string, host: string): string {
  const parts = title
    .split(/\s[|–—-]\s/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return host.replace(/^www\./, '')
  if (parts.length === 1 || parts[0].length > 24) return parts[0]
  return `${parts[1]} – ${parts[0]}`
}

/** What a pasted link is: a Facebook page, a feed, a page that names its feed, or a page to read stories from */
export async function detectSource(url: string, fetchText: FetchText): Promise<NewsSource> {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const parsed = new URL(u)
  if (/(^|\.)facebook\.com$/i.test(parsed.hostname) || /(^|\.)fb\.com$/i.test(parsed.hostname)) {
    const name = parsed.pathname.replace(/\//g, ' ').trim() || 'Facebook page'
    return { id: newId(), kind: 'facebook', name: name === 'profile.php' ? 'Facebook page' : name, url: u, enabled: true }
  }
  const text = await withTimeout(fetchText(u), 20_000)
  const head = text.slice(0, 2000)
  if (/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head)) return { id: newId(), kind: 'rss', name: feedTitle(text) || parsed.hostname, url: u, enabled: true }
  const alt = /<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(text)?.[0]
  const feedHref = alt ? /href=["']([^"']+)["']/i.exec(alt)?.[1] : undefined
  const pageTitle = sourceName(htmlToText(tagBody(text, 'title') ?? ''), parsed.hostname)
  if (feedHref) return { id: newId(), kind: 'rss', name: pageTitle, url: resolve(feedHref, u), enabled: true }
  return { id: newId(), kind: 'page', name: pageTitle, url: u, enabled: true }
}
