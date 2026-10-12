import type { Db } from '../db'
import { newId, tx } from '../db'
import { LOCAL_NEWS_PAGE, type NewsFeed, type NewsItem, type NewsPage, type NewsPlace, type NewsPrefs, type NewsPreset, type NewsSource, type NewsSourceKind, type NewsTopic, type NewsWeather } from '../../shared/api'
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

const STORES: Record<string, string> = {
  '1': 'Steam',
  '2': 'GamersGate',
  '3': 'GreenManGaming',
  '7': 'GOG',
  '8': 'EA',
  '11': 'Humble Store',
  '13': 'Ubisoft',
  '15': 'Fanatical',
  '23': 'GameBillet',
  '25': 'Epic Games Store',
  '27': 'Gamesplanet',
  '29': '2Game',
  '30': 'IndieGala',
  '31': 'Blizzard'
}

/** The best-rated game deals from CheapShark (prices in US dollars) */
export function parseCheapShark(json: string, now = Date.now()): RawItem[] {
  const deals = JSON.parse(json) as {
    dealID: string
    title: string
    storeID: string
    salePrice: string
    normalPrice: string
    savings: string
    metacriticScore?: string
    steamRatingText?: string | null
    steamRatingPercent?: string
    lastChange?: number
    thumb?: string
  }[]
  if (!Array.isArray(deals)) return []
  return deals.map((d) => {
    const off = Math.round(Number(d.savings) || 0)
    const rating = d.steamRatingText && d.steamRatingText !== 'null' ? `Steam reviews: ${d.steamRatingText} (${d.steamRatingPercent}%)` : ''
    return {
      guid: d.dealID,
      title: `${d.title} – US$${d.salePrice} (${off}% off)`,
      summary: [`Was US$${d.normalPrice}`, `at ${STORES[d.storeID] ?? 'an online store'}`, Number(d.metacriticScore) ? `Metacritic ${d.metacriticScore}` : '', rating].filter(Boolean).join(' · '),
      url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeURIComponent(d.dealID))}`,
      image: /^https:\/\//.test(d.thumb ?? '') ? d.thumb! : '',
      publishedAt: d.lastChange ? d.lastChange * 1000 : now,
      category: 'deal'
    }
  })
}

const shortDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Games free to keep on the Epic Games Store: this week's, and next week's */
export function parseEpicFree(json: string, now = Date.now()): RawItem[] {
  type Offer = { startDate: string; endDate: string; discountSetting?: { discountPercentage?: number } }
  type Element = {
    id: string
    title: string
    description?: string
    productSlug?: string | null
    urlSlug?: string
    offerMappings?: { pageSlug?: string }[] | null
    catalogNs?: { mappings?: { pageSlug?: string }[] | null }
    keyImages?: { type: string; url: string }[]
    promotions?: { promotionalOffers?: { promotionalOffers?: Offer[] }[]; upcomingPromotionalOffers?: { promotionalOffers?: Offer[] }[] } | null
  }
  const data = JSON.parse(json) as { data?: { Catalog?: { searchStore?: { elements?: Element[] } } } }
  const out: RawItem[] = []
  for (const el of data.data?.Catalog?.searchStore?.elements ?? []) {
    const free = (groups: { promotionalOffers?: Offer[] }[] | undefined): Offer | undefined =>
      groups?.flatMap((g) => g.promotionalOffers ?? []).find((o) => o.discountSetting?.discountPercentage === 0)
    const slug = el.productSlug || el.offerMappings?.[0]?.pageSlug || el.catalogNs?.mappings?.[0]?.pageSlug || ''
    const url = slug ? `https://store.epicgames.com/en-US/p/${slug.replace(/\/home$/, '')}` : 'https://store.epicgames.com/en-US/free-games'
    const image = el.keyImages?.find((k) => /thumbnail|offerimagewide|dieselstorefrontwide/i.test(k.type))?.url ?? ''
    const nowOffer = free(el.promotions?.promotionalOffers)
    const next = free(el.promotions?.upcomingPromotionalOffers)
    if (nowOffer && Date.parse(nowOffer.endDate) > now)
      out.push({
        guid: `${el.id}:${nowOffer.startDate}`,
        title: `Free now: ${el.title}`,
        summary: `Free to keep on the Epic Games Store until ${shortDate(nowOffer.endDate)}. ${el.description ?? ''}`.trim(),
        url,
        image,
        publishedAt: Math.min(now, Date.parse(nowOffer.startDate) || now),
        category: 'free'
      })
    else if (next)
      out.push({
        guid: `${el.id}:${next.startDate}`,
        title: `Free soon: ${el.title}`,
        summary: `Free to keep on the Epic Games Store from ${shortDate(next.startDate)} to ${shortDate(next.endDate)}. ${el.description ?? ''}`.trim(),
        url,
        image,
        publishedAt: now,
        category: 'free'
      })
  }
  return out
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

/** Your other pages (games, deals, tech…) */
const INTEREST_RULES: [NewsTopic, RegExp][] = [
  // Stricter than local news: game names say "Fatal", "Death", "Dead", and deals say "in stock"
  ['sad', words('dies\\b|died\\b|passed away|obituar|murder|homicide|killed in|suicide|mourn|funeral|tragic death|r\\.i\\.p\\b')],
  ['markets', words('tsx|dow jones|nasdaq|s&p 500|share price|stock price|shares (?:fell|rose|drop|jump|plunge|soar)|investors?|earnings (?:call|report)|quarterly (?:earnings|results)|market cap|crypto|bitcoin')],
  ['free', words('free to keep|free games?\\b|free on (?:epic|steam|gog|prime)|giveaway|100% off|claim (?:it )?(?:for )?free|free weekend|free-to-play|for free\\b')],
  ['deals', /\b(?:deals?|sale|on sale|clearance|coupon|discount|bundle|price drop|lowest price|all[- ]time low|atl|historical low|price error|save up to|save \$|was \$)\b|\d\s?% off|\$\s?\d|^\[[^\]]+\]/i],
  ['rumors', words('rumou?r|leak|reportedly|allegedly|tipped|insider|could be|may be coming')],
  ['reviews', words('review|tested|benchmark|hands-on|impressions|comparison|vs\\.?\\s')],
  ['releases', words('release|launch|out now|available now|pre-?orders?|announc|reveal|trailer|coming to|coming (?:this|next|in)|early access|unveil|debut|dlc|expansion|season \\d|hits (?:pc|steam|ps5|xbox|switch)|specs?\\b')],
]

export function topicOf(text: string, kind: NewsSourceKind, local = true): NewsTopic {
  if (kind === 'roads' || kind === 'weather') return 'alerts'
  if (kind === 'freegames') return 'free'
  if (kind === 'gamedeals') return 'deals'
  for (const [topic, re] of local ? TOPIC_RULES : INTEREST_RULES) if (re.test(text)) return topic
  return local ? 'community' : 'general'
}

/** How much off a deal is, when it says: "40% off", "($1100-400=$700)", "was $999, now $699" */
export function discountOf(text: string): number | null {
  let best = 0
  for (const m of text.matchAll(/(\d{1,2}(?:\.\d+)?)\s?%\s?off|save (?:up to )?(\d{1,2})\s?%|\(-(\d{1,2})%\)/gi)) best = Math.max(best, Math.round(Number(m[1] ?? m[2] ?? m[3])))
  for (const m of text.matchAll(/\$?\s?(\d+(?:\.\d+)?)\s?-\s?\$?\s?(\d+(?:\.\d+)?)\s?=\s?\$?\s?\d/g)) {
    const price = Number(m[1])
    const off = Number(m[2])
    if (price > 0 && off < price) best = Math.max(best, Math.round((off / price) * 100))
  }
  const was = /\b(?:was|reg\.?|regularly|normally)\s*\$\s?(\d+(?:\.\d+)?)[^$]{0,24}\$\s?(\d+(?:\.\d+)?)/i.exec(text)
  if (was && Number(was[1]) > Number(was[2])) best = Math.max(best, Math.round((1 - Number(was[2]) / Number(was[1])) * 100))
  return best > 0 && best < 100 ? best : null
}

/** Metacritic 80+ or Steam reviews 85%+ (as written by parseCheapShark) */
const WELL_REVIEWED = /Metacritic (?:8\d|9\d|100)\b|Steam reviews: [^(]*\((?:8[5-9]|9\d|100)%\)/

/** A deal that's as good as it gets */
const GREAT_DEAL = /all[- ]time low|\batl\b|lowest price (?:ever|yet)|historical(?:ly)? low|price error|free to keep|100% off/i

const URGENT = words('evacuat|boil water|water quality advisory|do not use|wildfire|warning|closed\\b|closure|outage|emergency|shelter in place|disruption')
const ELECTION = words('election|vote\\b|voting|ballot|advance voting|candidates')

const escapeRe = (w: string): string => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasWord = (text: string, list: string[]): boolean => list.some((w) => w.trim() && new RegExp(`\\b${escapeRe(w)}`, 'i').test(text))
/** Whole words (or their plural): "ram" matches "RAM" and "rams", not "ramp" */
const hasWholeWord = (text: string, list: string[]): boolean => list.some((w) => w.trim() && new RegExp(`(?:^|[^a-z0-9])${escapeRe(w)}s?(?![a-z0-9])`, 'i').test(text))

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

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [])

const normalizePage = (p: Partial<NewsPage>): NewsPage => ({
  id: typeof p.id === 'string' && p.id && p.id !== LOCAL_NEWS_PAGE ? p.id : newId(),
  name: (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'News').slice(0, 40),
  hideTopics: Array.isArray(p.hideTopics) ? (p.hideTopics as NewsTopic[]) : ['sad', 'markets'],
  muted: list(p.muted),
  boost: list(p.boost),
  only: list(p.only),
  minDiscount: Number.isFinite(Number(p.minDiscount)) && Number(p.minDiscount) > 0 ? Math.min(95, Number(p.minDiscount)) : 40,
  notify: p.notify === true
})

/** Your pages besides the local one */
export function newsPages(db: Db): NewsPage[] {
  const saved = getSetting(db, 'news.pages')
  return Array.isArray(saved) ? (saved as Partial<NewsPage>[]).map(normalizePage) : []
}

export const pageOf = (s: NewsSource): string => s.page || LOCAL_NEWS_PAGE

export function configureNews(db: Db, patch: { sources?: NewsSource[]; prefs?: Partial<NewsPrefs>; pages?: NewsPage[] }): void {
  if (patch.pages) {
    const pages = patch.pages.map(normalizePage)
    setSetting(db, 'news.pages', pages)
    // A page that's gone takes its sources with it
    const ids = new Set([LOCAL_NEWS_PAGE, ...pages.map((p) => p.id)])
    const sources = patch.sources ?? newsSources(db)
    if (sources.some((s) => !ids.has(pageOf(s)))) patch = { ...patch, sources: sources.filter((s) => ids.has(pageOf(s))) }
  }
  if (patch.sources) {
    const clean = patch.sources
      .filter((s) => s && typeof s.url === 'string' && s.url.trim())
      .map((s) => ({
        id: s.id || newId(),
        kind: s.kind,
        name: (s.name || s.url).trim().slice(0, 80),
        url: s.url.trim(),
        enabled: s.enabled !== false,
        ...(s.important ? { important: true } : {}),
        ...(s.page && s.page !== LOCAL_NEWS_PAGE ? { page: s.page } : {})
      }))
    setSetting(db, 'news.sources', clean)
    // Stories of removed sources go too
    const ids = clean.map((s) => s.id)
    db.prepare(`DELETE FROM news_items WHERE saved = 0 AND source_id NOT IN (${ids.map(() => '?').join(',') || "''"})`).run(...ids)
    if (!clean.some((s) => s.kind === 'weather' && s.enabled)) setSetting(db, 'news.weather', null)
  }
  if (patch.prefs) setSetting(db, 'news.prefs', { ...newsPrefs(db), ...patch.prefs })
}

/** Words for a PC parts page: a story has to mention one of them */
export const PC_PART_WORDS = [
  'gpu', 'graphics card', 'rtx', 'radeon', 'geforce', 'intel arc', 'cpu', 'processor', 'ryzen', 'core i5', 'core i7', 'core i9', 'core ultra', 'ssd', 'nvme', 'm.2',
  'ram', 'ddr4', 'ddr5', 'memory', 'motherboard', 'psu', 'power supply', 'monitor', 'oled', 'pc case', 'cooler', 'aio', 'hdd', 'hard drive', 'keyboard',
  'mouse', 'headset', 'laptop', 'mini pc', 'router', 'nas', 'wifi', 'prebuilt', 'gaming pc'
]

/** Starting points for a new page; deal sites follow where you live (Canada has its own) */
export function presetPage(preset: NewsPreset, countryCode: string, name?: string): { page: NewsPage; sources: NewsSource[] } {
  const cc = countryCode || 'US'
  const source = (kind: NewsSourceKind, sourceName: string, url: string): NewsSource => ({ id: newId(), kind, name: sourceName, url, enabled: true })
  const page = (p: Partial<NewsPage>): NewsPage => normalizePage({ ...p, name: name?.trim() || p.name })
  if (preset === 'games')
    return {
      page: page({ name: 'Games', minDiscount: 60 }),
      sources: [
        source('freegames', 'Free games (Epic Games Store)', `https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${cc}&allowCountries=${cc}`),
        source('gamedeals', 'Best game deals (CheapShark)', 'https://www.cheapshark.com/api/1.0/deals?storeID=1,7,11,25&onSale=1&sortBy=Deal%20Rating&pageSize=30'),
        source('rss', 'r/GameDeals (top today)', 'https://www.reddit.com/r/GameDeals/top/.rss?t=day'),
        source('rss', 'Gematsu (release dates)', 'https://www.gematsu.com/feed'),
        source('rss', 'GameSpot news', 'https://www.gamespot.com/feeds/game-news')
      ]
    }
  if (preset === 'pc')
    return {
      page: page({ name: 'PC parts', minDiscount: 30, only: PC_PART_WORDS, muted: ['daily thread', 'discussion thread'] }),
      sources: [
        ...(cc === 'CA'
          ? [
              source('rss', 'r/bapcsalescanada (top today)', 'https://www.reddit.com/r/bapcsalescanada/top/.rss?t=day'),
              source('rss', 'RedFlagDeals – Hot Deals', 'https://forums.redflagdeals.com/feed/forum/9')
            ]
          : [
              source('rss', 'r/buildapcsales (top today)', 'https://www.reddit.com/r/buildapcsales/top/.rss?t=day'),
              source('rss', 'Slickdeals – Frontpage', 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1')
            ]),
        source('rss', 'TechPowerUp (new hardware)', 'https://www.techpowerup.com/rss/news'),
        source('rss', 'Tom’s Hardware', 'https://www.tomshardware.com/feeds/all')
      ]
    }
  return { page: page({ name: 'New page' }), sources: [] }
}

export function addNewsPage(db: Db, preset: NewsPreset, name?: string): NewsPage {
  const { page, sources } = presetPage(preset, newsPrefs(db).place?.countryCode ?? '', name)
  configureNews(db, { pages: [...newsPages(db), page], sources: [...newsSources(db), ...sources.map((s) => ({ ...s, page: page.id }))] })
  return page
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
  const pages = newsPages(db)
  const pageById = new Map(pages.map((p) => [p.id, p]))
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
    const pageId = pageOf(source)
    const page = pageById.get(pageId)
    const local = pageId === LOCAL_NEWS_PAGE || !page
    const rules = local ? { hideTopics: prefs.hideTopics, muted: prefs.muted, boost: prefs.boost, only: [] as string[] } : page
    const key = `${pageId}|${normTitle(r.title)}`
    if (seen.has(key)) continue
    seen.add(key)
    const text = `${r.title}. ${r.summary}`
    const topic = topicOf(text, source.kind, local)
    const ageDays = (now - r.published_at) / 86_400_000
    const boosted = hasWord(text, rules.boost)
    const discount = local ? null : discountOf(text)
    // When it happens (not for road work or weather, whose dates are how long they last); past dates don't count
    // (On your other pages only release dates and free-game dates count: a deal posted 'today at 7 pm' isn't an event)
    const dated = (source.kind === 'rss' || source.kind === 'page' || source.kind === 'freegames') && (local || topic === 'releases' || topic === 'free')
    const found = dated ? findWhen(text, new Date(r.published_at)) : null
    const when = found && found.date >= today ? found : null
    const over = found !== null && when === null // about something that has already happened
    const important = local
      ? boosted ||
        r.severe === 1 ||
        (source.kind === 'weather' && ageDays < 3) ||
        (source.important === true && ageDays < 3 && !over) ||
        (topic === 'alerts' && source.kind !== 'roads' && !over && ageDays < 4 && URGENT.test(text)) ||
        (topic === 'civic' && !over && ELECTION.test(text) && (when !== null || ageDays < 2))
      : // Top picks: free to keep now, big discounts, all-time lows, your words, starred sources
        boosted ||
        (source.kind === 'freegames' // free now is a pick; free next week is Coming up
          ? /^free now/i.test(r.title)
          : source.kind === 'gamedeals' // a big discount on a well-reviewed game
            ? discount !== null && discount >= page.minDiscount && WELL_REVIEWED.test(r.summary)
            : ageDays < 4 && ((discount !== null && discount >= page.minDiscount) || GREAT_DEAL.test(text))) ||
        (source.important === true && ageDays < 3)
    items.push({
      id: r.id,
      page: local ? LOCAL_NEWS_PAGE : pageId,
      discount,
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
      filtered: !boosted && (rules.hideTopics.includes(topic) || hasWord(text, rules.muted) || (rules.only.length > 0 && !hasWholeWord(text, rules.only))),
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
    pages,
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
    case 'gamedeals':
      // Deals end: keep only the current list
      return storeItems(db, source.id, parseCheapShark(text, now), now, true)
    case 'freegames':
      return storeItems(db, source.id, parseEpicFree(text, now), now, true)
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
  // Local alerts (if you want them) and Top picks on pages that ask for a notification
  const notifyPages = new Set(feed.pages.filter((p) => p.notify).map((p) => p.id))
  const urgent = feed.items.filter(
    (i) => i.important && !i.filtered && !alerted.has(i.id) && now - i.publishedAt < 2 * 86_400_000 && (i.page === LOCAL_NEWS_PAGE ? feed.prefs.notifyUrgent : notifyPages.has(i.page))
  )
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
  if (/cheapshark\.com\/api\//i.test(u)) return { id: newId(), kind: 'gamedeals', name: 'Game deals (CheapShark)', url: u, enabled: true }
  if (/epicgames\.com\/.*freeGamesPromotions/i.test(u)) return { id: newId(), kind: 'freegames', name: 'Free games (Epic Games Store)', url: u, enabled: true }
  const text = await withTimeout(fetchText(u), 20_000)
  const head = text.slice(0, 2000)
  if (/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head)) return { id: newId(), kind: 'rss', name: feedTitle(text) || parsed.hostname, url: u, enabled: true }
  const alt = /<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(text)?.[0]
  const feedHref = alt ? /href=["']([^"']+)["']/i.exec(alt)?.[1] : undefined
  const pageTitle = sourceName(htmlToText(tagBody(text, 'title') ?? ''), parsed.hostname)
  if (feedHref) return { id: newId(), kind: 'rss', name: pageTitle, url: resolve(feedHref, u), enabled: true }
  return { id: newId(), kind: 'page', name: pageTitle, url: u, enabled: true }
}
