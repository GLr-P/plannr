import type { Db } from '../db'
import type { MediaResult, WatchOffer, WhereToWatch } from '../../shared/api'
import { newsPrefs, type FetchText } from './news'

/**
 * Where to watch, buy or read something, for your country (from the News place):
 * movies and shows from JustWatch's public API (subscriptions, free, free with ads, rent, buy, with prices and
 * links), games from CheapShark (store prices), books as links to libraries and shops. Kept 12 hours in memory.
 */

type Want = Pick<MediaResult, 'kind' | 'title' | 'year' | 'extId'>

const KEEP_MS = 12 * 3_600_000
const kept = new WeakMap<Db, Map<string, { at: number; value: WhereToWatch }>>()
const storesKept = new WeakMap<Db, Record<string, { name: string; icon: string }>>()

const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '')
const ORDER: WatchOffer['kind'][] = ['stream', 'free', 'ads', 'library', 'rent', 'buy']

const JW_QUERY = `query WhereToWatch($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) { edges { node {
    objectType
    content(country: $country, language: $language) { title fullPath originalReleaseYear externalIds { imdbId } }
    offers(country: $country, platform: WEB) { monetizationType presentationType standardWebURL retailPrice(language: $language) package { clearName technicalName icon(profile: S100) } }
  } } }
}`

interface JwNode {
  objectType: string
  content: { title: string; fullPath?: string; originalReleaseYear?: number; externalIds?: { imdbId?: string | null } }
  offers?: { monetizationType: string; presentationType?: string; standardWebURL?: string; retailPrice?: string | null; package?: { clearName: string; technicalName: string; icon?: string } }[]
}

const JW_KIND: Record<string, WatchOffer['kind']> = { FLATRATE: 'stream', FREE: 'free', ADS: 'ads', RENT: 'rent', BUY: 'buy' }
const QUALITY: Record<string, number> = { SD: 1, HD: 2, _4K: 3 }

/** The matching title in JustWatch's answer (by IMDb id, else by name and year) and where it's offered */
export function parseJustWatch(json: string, want: Want, country: string): WhereToWatch {
  const edges = (JSON.parse(json) as { data?: { popularTitles?: { edges?: { node: JwNode }[] } } }).data?.popularTitles?.edges ?? []
  const nodes = edges.map((e) => e.node)
  const imdb = /^tt\d+$/.test(want.extId) ? want.extId : ''
  const same = (n: JwNode): boolean => norm(n.content.title) === norm(want.title)
  const node =
    (imdb && nodes.find((n) => n.content.externalIds?.imdbId === imdb)) ||
    nodes.find((n) => same(n) && want.year !== null && Math.abs((n.content.originalReleaseYear ?? 0) - want.year) <= 1) ||
    nodes.find((n) => same(n) && want.year === null) ||
    null
  const search = `https://www.justwatch.com/${country}/search?q=${encodeURIComponent(want.title)}`
  if (!node) return { found: false, offers: [], link: search, source: 'JustWatch', country }
  const best = new Map<string, { offer: WatchOffer; q: number }>()
  for (const o of node.offers ?? []) {
    const kind = JW_KIND[o.monetizationType]
    if (!kind || !o.package || !o.standardWebURL) continue
    const key = `${o.package.technicalName}:${kind}`
    const q = QUALITY[o.presentationType ?? ''] ?? 0
    const have = best.get(key)
    if (have && have.q >= q) continue
    best.set(key, {
      q,
      offer: {
        service: o.package.clearName,
        serviceId: o.package.technicalName,
        icon: o.package.icon ? `https://images.justwatch.com${o.package.icon.replace('{format}', 'png')}` : '',
        kind,
        url: o.standardWebURL,
        price: o.retailPrice ?? '',
        note: q === 3 ? '4K' : q === 2 ? 'HD' : ''
      }
    })
  }
  const offers = [...best.values()].map((b) => b.offer).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.service.localeCompare(b.service))
  return { found: true, offers, link: node.content.fullPath ? `https://www.justwatch.com${node.content.fullPath}` : search, source: 'JustWatch', country }
}

async function stores(db: Db, fetchText: FetchText): Promise<Record<string, { name: string; icon: string }>> {
  const have = storesKept.get(db)
  if (have) return have
  const list = JSON.parse(await fetchText('https://www.cheapshark.com/api/1.0/stores')) as { storeID: string; storeName: string; isActive: number; images?: { icon?: string } }[]
  const out = Object.fromEntries(list.map((s) => [s.storeID, { name: s.storeName, icon: s.images?.icon ? `https://www.cheapshark.com${s.images.icon}` : '' }]))
  storesKept.set(db, out)
  return out
}

/** A game's prices at each store CheapShark knows (US dollars), cheapest first */
export function parseGameDeals(json: string, storeList: Record<string, { name: string; icon: string }>): WatchOffer[] {
  const deals = JSON.parse(json) as { storeID: string; dealID: string; salePrice: string; normalPrice: string; isOnSale: string }[]
  return deals
    .filter((d) => storeList[d.storeID])
    .sort((a, b) => Number(a.salePrice) - Number(b.salePrice))
    .map((d) => ({
      service: storeList[d.storeID].name,
      serviceId: `store:${d.storeID}`,
      icon: storeList[d.storeID].icon,
      kind: Number(d.salePrice) === 0 ? 'free' : 'buy',
      url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeURIComponent(d.dealID))}`,
      price: Number(d.salePrice) === 0 ? 'Free' : `US$${d.salePrice}`,
      note: d.isOnSale === '1' ? `was US$${d.normalPrice}` : ''
    }))
}

function bookLinks(want: Want, country: string): WhereToWatch {
  const q = encodeURIComponent(want.title)
  const amazon = country === 'ca' ? 'amazon.ca' : country === 'gb' ? 'amazon.co.uk' : country === 'au' ? 'amazon.com.au' : 'amazon.com'
  const offers: WatchOffer[] = [
    ...(want.extId.startsWith('/works/') ? [{ service: 'Open Library', serviceId: 'openlibrary', icon: '', kind: 'library' as const, url: `https://openlibrary.org${want.extId}`, price: '', note: 'Borrow or read free when available' }] : []),
    { service: 'A library near you', serviceId: 'worldcat', icon: '', kind: 'library', url: `https://search.worldcat.org/search?q=${q}`, price: '', note: 'WorldCat' },
    { service: 'Libby', serviceId: 'libby', icon: '', kind: 'library', url: `https://libbyapp.com/search/query-${q}/page-1`, price: '', note: 'E-books and audiobooks with a library card' },
    ...(want.extId.startsWith('apple:') ? [{ service: 'Apple Books', serviceId: 'applebooks', icon: '', kind: 'buy' as const, url: `https://books.apple.com/book/id${want.extId.slice(6)}`, price: '', note: '' }] : []),
    { service: 'Amazon', serviceId: 'amazon', icon: '', kind: 'buy', url: `https://www.${amazon}/s?k=${q}&i=stripbooks`, price: '', note: '' },
    { service: 'Google Books', serviceId: 'googlebooks', icon: '', kind: 'buy', url: `https://www.google.com/search?tbm=bks&q=${q}`, price: '', note: '' }
  ]
  return { found: true, offers, link: '', source: '', country }
}

export async function whereToWatch(db: Db, want: Want, fetchText: FetchText, now = Date.now()): Promise<WhereToWatch> {
  const country = (newsPrefs(db).place?.countryCode || 'us').toLowerCase()
  if (want.kind === 'book') return bookLinks(want, country)
  const key = `${country}:${want.kind}:${want.extId || norm(want.title)}`
  const cache = kept.get(db) ?? new Map<string, { at: number; value: WhereToWatch }>()
  kept.set(db, cache)
  const hit = cache.get(key)
  if (hit && now - hit.at < KEEP_MS) return hit.value
  let value: WhereToWatch
  if (want.kind === 'game') {
    const steam = /^steam:(\d+)$/.exec(want.extId)?.[1]
    const json = await fetchText(steam ? `https://www.cheapshark.com/api/1.0/deals?steamAppID=${steam}` : `https://www.cheapshark.com/api/1.0/deals?title=${encodeURIComponent(want.title)}&exact=1`)
    const offers = parseGameDeals(json, await stores(db, fetchText))
    value = { found: offers.length > 0, offers, link: steam ? `https://www.cheapshark.com/` : '', source: 'CheapShark', country }
  } else {
    const body = JSON.stringify({ query: JW_QUERY, variables: { country: country.toUpperCase(), language: 'en', first: 6, filter: { searchQuery: want.title, objectTypes: [want.kind === 'show' ? 'SHOW' : 'MOVIE'] } } })
    value = parseJustWatch(await fetchText('https://apis.justwatch.com/graphql', body), want, country)
  }
  cache.set(key, { at: now, value })
  return value
}
