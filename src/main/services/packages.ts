import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { PackageInfo, PackageStatus } from '../../shared/api'

/**
 * Packages: tracking numbers with the carrier worked out from the number, a link to its tracking page, an expected
 * day (on the calendar and Home), and live status from 17TRACK when a key is set (PC; free plan, the user's own key).
 */

const CARRIERS: { id: string; name: string; test: RegExp; url: (n: string) => string }[] = [
  { id: 'ups', name: 'UPS', test: /^1Z[0-9A-Z]{16}$/i, url: (n) => `https://www.ups.com/track?tracknum=${n}` },
  { id: 'amazon', name: 'Amazon', test: /^TBA\d{9,}$/i, url: () => 'https://www.amazon.ca/gp/your-account/order-history' },
  { id: 'canadapost', name: 'Canada Post', test: /^(\d{16}|[A-Z]{2}\d{9}CA)$/i, url: (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${n}` },
  { id: 'purolator', name: 'Purolator', test: /^\d{12}$|^[A-Z]{3}\d{9}$/i, url: (n) => `https://www.purolator.com/en/shipping/tracker?pin=${n}` },
  { id: 'usps', name: 'USPS', test: /^(94|93|92|95)\d{20}$|^[A-Z]{2}\d{9}US$/i, url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
  { id: 'fedex', name: 'FedEx', test: /^\d{15}$|^\d{20}$|^\d{22}$/, url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  { id: 'dhl', name: 'DHL', test: /^\d{10}$|^JJD\d+$/i, url: (n) => `https://www.dhl.com/ca-en/home/tracking.html?tracking-id=${n}` }
]

export function detectCarrier(number: string): { carrier: string; carrierName: string; trackUrl: string } {
  const n = number.replace(/\s+/g, '').toUpperCase()
  const c = CARRIERS.find((x) => x.test.test(n))
  return c
    ? { carrier: c.id, carrierName: c.name, trackUrl: c.url(n) }
    : { carrier: 'other', carrierName: 'Tracking', trackUrl: `https://parcelsapp.com/en/tracking/${encodeURIComponent(n)}` }
}

interface Row {
  id: string
  number: string
  carrier: string
  label: string
  status: PackageStatus
  status_text: string
  expected: string | null
  delivered_at: number | null
  events: string
  last_checked: number | null
  created_at: number
}

const toInfo = (r: Row): PackageInfo => {
  const c = detectCarrier(r.number)
  let events: PackageInfo['events'] = []
  try {
    events = JSON.parse(r.events) as PackageInfo['events']
  } catch {
    events = []
  }
  return {
    id: r.id,
    number: r.number,
    carrier: r.carrier,
    carrierName: c.carrierName,
    label: r.label,
    status: r.delivered_at ? 'delivered' : r.status,
    statusText: r.status_text,
    expected: r.expected,
    deliveredAt: r.delivered_at,
    trackUrl: c.trackUrl,
    events,
    lastChecked: r.last_checked,
    createdAt: r.created_at
  }
}

/** Not delivered first (soonest expected first), then delivered (newest first); delivered ones go after 14 days */
export function listPackages(db: Db, nowMs = Date.now()): PackageInfo[] {
  const rows = db.prepare('SELECT * FROM packages WHERE deleted_at IS NULL AND (delivered_at IS NULL OR delivered_at > ?)').all(nowMs - 14 * 86_400_000) as unknown as Row[]
  return rows
    .map(toInfo)
    .sort((a, b) =>
      (a.status === 'delivered') !== (b.status === 'delivered')
        ? a.status === 'delivered'
          ? 1
          : -1
        : a.status === 'delivered'
          ? (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)
          : (a.expected ?? '9999').localeCompare(b.expected ?? '9999') || b.createdAt - a.createdAt
    )
}

export function addPackage(db: Db, input: { number: string; label?: string; expected?: string | null }): PackageInfo {
  const number = input.number.replace(/\s+/g, '').toUpperCase().slice(0, 60)
  if (!number) throw new Error('Type a tracking number')
  const id = newId()
  const t = now()
  db.prepare('INSERT INTO packages (id, number, carrier, label, expected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    number,
    detectCarrier(number).carrier,
    (input.label ?? '').trim().slice(0, 120),
    input.expected && /^\d{4}-\d{2}-\d{2}$/.test(input.expected) ? input.expected : null,
    t,
    t
  )
  return toInfo(db.prepare('SELECT * FROM packages WHERE id = ?').get(id) as unknown as Row)
}

export function updatePackage(db: Db, id: string, patch: { label?: string; expected?: string | null; delivered?: boolean }): void {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (patch.label !== undefined) sets.push('label = ?') && params.push(patch.label.trim().slice(0, 120))
  if (patch.expected !== undefined) sets.push('expected = ?') && params.push(patch.expected && /^\d{4}-\d{2}-\d{2}$/.test(patch.expected) ? patch.expected : null)
  if (patch.delivered !== undefined) {
    sets.push('delivered_at = ?', 'status = ?')
    params.push(patch.delivered ? now() : null, patch.delivered ? 'delivered' : 'unknown')
  }
  sets.push('updated_at = ?')
  params.push(now(), id)
  db.prepare(`UPDATE packages SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function removePackage(db: Db, id: string): void {
  db.prepare('UPDATE packages SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

/** Expected deliveries in [from, to], for the calendar */
export function packagesExpected(db: Db, from: string, to: string): PackageInfo[] {
  return listPackages(db).filter((p) => p.status !== 'delivered' && p.expected && p.expected >= from && p.expected <= to)
}

// ---------- 17TRACK (live status) ----------

export type PostJson = (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>

const STATUS: Record<string, PackageStatus> = {
  NotFound: 'unknown',
  InfoReceived: 'pending',
  InTransit: 'transit',
  Expired: 'problem',
  AvailableForPickup: 'out',
  OutForDelivery: 'out',
  DeliveryFailure: 'problem',
  Delivered: 'delivered',
  Exception: 'problem'
}

interface TrackInfo {
  number: string
  track_info?: {
    latest_status?: { status?: string; sub_status?: string }
    latest_event?: { time_iso?: string; description?: string; location?: string }
    time_metrics?: { estimated_delivery_date?: { from?: string | null; to?: string | null } }
    tracking?: { providers?: { events?: { time_iso?: string; description?: string; location?: string }[] }[] }
  }
}

/** One package's state from a 17TRACK gettrackinfo answer */
export function readTrackInfo(t: TrackInfo): { status: PackageStatus; statusText: string; expected: string | null; deliveredAt: number | null; events: PackageInfo['events'] } {
  const info = t.track_info ?? {}
  const status = STATUS[info.latest_status?.status ?? ''] ?? 'unknown'
  const events = (info.tracking?.providers?.[0]?.events ?? [])
    .slice(0, 20)
    .map((e) => ({ time: Date.parse(e.time_iso ?? '') || 0, text: e.description ?? '', place: e.location ?? '' }))
  const latest = info.latest_event
  const eta = info.time_metrics?.estimated_delivery_date?.to ?? info.time_metrics?.estimated_delivery_date?.from ?? null
  return {
    status,
    statusText: latest?.description ? `${latest.description}${latest.location ? ` · ${latest.location}` : ''}` : status === 'unknown' ? 'No tracking information yet' : '',
    expected: eta ? eta.slice(0, 10) : null,
    deliveredAt: status === 'delivered' ? Date.parse(latest?.time_iso ?? '') || Date.now() : null,
    events
  }
}

/** Registers new numbers and reads the latest status of every package that isn't delivered */
export async function refreshTracking(db: Db, key: string, post: PostJson): Promise<void> {
  const open = listPackages(db).filter((p) => p.status !== 'delivered')
  if (!open.length) return
  const headers = { '17token': key, 'Content-Type': 'application/json' }
  const numbers = open.map((p) => ({ number: p.number }))
  for (let i = 0; i < numbers.length; i += 40) {
    const batch = numbers.slice(i, i + 40)
    await post('https://api.17track.net/track/v2.2/register', batch, headers).catch(() => undefined) // already registered is fine
    const res = (await post('https://api.17track.net/track/v2.2/gettrackinfo', batch, headers)) as { code?: number; data?: { accepted?: TrackInfo[]; errors?: unknown[] } }
    if (res.code !== undefined && res.code !== 0) throw new Error(`17TRACK answered ${res.code}`)
    tx(db, () => {
      for (const t of res.data?.accepted ?? []) {
        const p = open.find((x) => x.number === t.number)
        if (!p) continue
        const s = readTrackInfo(t)
        db.prepare('UPDATE packages SET status = ?, status_text = ?, expected = COALESCE(?, expected), delivered_at = COALESCE(delivered_at, ?), events = ?, last_checked = ?, updated_at = ? WHERE id = ?').run(
          s.status,
          s.statusText,
          s.expected,
          s.deliveredAt,
          JSON.stringify(s.events),
          now(),
          now(),
          p.id
        )
      }
    })
  }
}
