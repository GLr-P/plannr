import { DEFAULT_DISPLAY, displayPrefs, setDisplayPrefs, TICKET_STATUSES, type DisplayPrefs } from '../shared/api'
import type { Db } from './db'
import { rebuildSearchIndex } from './services/reindex'
import { getSetting, setSetting } from './services/settings'

/** Installs from before ticket prefixes were a setting used "NT-": keep it, so existing ticket numbers don't change. */
export function pinLegacyPrefix(db: Db): void {
  if (getSetting(db, 'display') !== null) return
  if (db.prepare('SELECT 1 FROM tickets LIMIT 1').get()) setSetting(db, 'display', { ...DEFAULT_DISPLAY, ticketPrefix: 'NT-' })
}

/** Loads the saved display preferences (ticket prefix, currency…) into the shared formatters. */
export function loadDisplayPrefs(db: Db): DisplayPrefs {
  setDisplayPrefs({ ...DEFAULT_DISPLAY, ...((getSetting(db, 'display') as Partial<DisplayPrefs> | null) ?? {}) })
  return displayPrefs()
}

export function saveDisplayPrefs(db: Db, patch: Partial<DisplayPrefs>): DisplayPrefs {
  const before = displayPrefs().ticketPrefix
  const next: DisplayPrefs = { ...displayPrefs(), ...patch }
  next.ticketPrefix = next.ticketPrefix.replace(/\s+/g, '').slice(0, 8)
  next.currency = /^[A-Z]{3}$/.test(next.currency) ? next.currency : DEFAULT_DISPLAY.currency
  next.paymentMethods = [...new Set(next.paymentMethods.map((m) => m.trim().slice(0, 40)).filter(Boolean))]
  if (!next.paymentMethods.length) next.paymentMethods = DEFAULT_DISPLAY.paymentMethods
  next.statusLabels = Object.fromEntries(
    TICKET_STATUSES.map((s) => [s.id, (next.statusLabels[s.id] ?? '').trim().slice(0, 30)]).filter(([, v]) => v)
  )
  next.weekStart = next.weekStart === 1 ? 1 : 0
  setSetting(db, 'display', next)
  setDisplayPrefs(next)
  if (next.ticketPrefix !== before) rebuildSearchIndex(db) // ticket titles in search include the number
  return next
}
