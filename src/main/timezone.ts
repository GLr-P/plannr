import { execFileSync } from 'node:child_process'
import { webContents } from 'electron'
import type { Db } from './db'
import type { TimeZoneInfo } from '../shared/api'
import { getSetting, setSetting } from './services/settings'
import { isZone, parseRegistry, resolveZone, type WindowsClock } from './services/timezone'

/** Applies the zone services/timezone.ts picks: to this process, new windows (they inherit TZ) and open ones (DevTools override). */

/** Setting key: '' (or unset) = automatic, otherwise an IANA zone like "America/Vancouver". Per PC, not synced. */
export const TIME_ZONE_SETTING = 'timeZone'

/** Reads Windows' current zone and offset from the registry (null off Windows or on any error). */
export function readWindowsClock(): WindowsClock | null {
  if (process.platform !== 'win32') return null
  try {
    // ~30 ms; runs once before the window opens, then hourly and after sleep
    return parseRegistry(execFileSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation'], { timeout: 5000, windowsHide: true, encoding: 'utf8' }))
  } catch {
    return null
  }
}


const systemNow = (): { zone: string | undefined; bias: number } => {
  const saved = process.env.TZ
  delete process.env.TZ
  const sys = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, bias: new Date().getTimezoneOffset() }
  if (saved !== undefined) process.env.TZ = saved
  return sys
}

let detected: string | null = null
let windowsKey = ''

/** Applies the zone to this process (and so to windows opened afterwards) and to any open window. */
function apply(zone: string | null): void {
  if ((process.env.TZ || null) === zone) return
  if (zone) process.env.TZ = zone
  else delete process.env.TZ
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      void wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: zone ?? '' }).catch(() => undefined)
    } catch {
      // DevTools may hold the debugger; the next start picks the zone up
    }
  }
}

/** Works the zone out and applies it. Call before the first window opens, then whenever it may have changed. */
export function refreshTimeZone(db: Db): void {
  const chosen = (getSetting(db, TIME_ZONE_SETTING) as string | null) ?? ''
  const windows = chosen && isZone(chosen) ? null : readWindowsClock()
  windowsKey = windows?.key ?? windowsKey
  if (!chosen) {
    // Still right? (Cheap check, so the hourly refresh doesn't swap zones for nothing.)
    if (windows && process.env.TZ && new Date().getTimezoneOffset() === windows.bias && detected === process.env.TZ) return
    detected = resolveZone({ chosen: '', windows, system: systemNow() })
  }
  apply(resolveZone({ chosen, windows, system: systemNow() }))
}

export function timeZoneInfo(db: Db): TimeZoneInfo {
  const chosen = (getSetting(db, TIME_ZONE_SETTING) as string | null) ?? ''
  return {
    chosen: isZone(chosen) ? chosen : '',
    effective: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    bias: new Date().getTimezoneOffset(),
    windows: windowsKey,
    fixed: !chosen && !!detected
  }
}

export function setTimeZone(db: Db, zone: string): TimeZoneInfo {
  setSetting(db, TIME_ZONE_SETTING, zone && isZone(zone) ? zone : '')
  refreshTimeZone(db)
  return timeZoneInfo(db)
}
