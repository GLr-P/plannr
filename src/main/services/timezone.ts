/**
 * Which time zone Plannr's clock uses (sports and e-sports times, the calendar, reminders, "today").
 *
 * Electron ships its own time zone data, which lags behind Windows. When a region changes its rules (BC kept
 * daylight time all year from November 2026 and Windows added "British Columbia Standard Time"), Chromium
 * doesn't recognise the new Windows zone and falls back to the zone's old base offset, so every time shows an
 * hour off. "Automatic" therefore checks the offset Windows really uses right now and, when ours differs, picks
 * a zone that matches it. Or the person picks a zone in Settings.
 */

/** New Windows zones that Electron's data may not know yet → an IANA zone with the same rules. */
const WINDOWS_ZONE_FIXES: Record<string, string> = {
  'British Columbia Standard Time': 'America/Whitehorse' // UTC-7 all year, like Yukon since 2020
}

export interface WindowsClock {
  /** Windows' zone id, e.g. "Pacific Standard Time" */
  key: string
  /** Minutes to add to local time to get UTC right now (Windows' ActiveTimeBias; 420 = UTC-7) */
  bias: number
}

export const isZone = (zone: string): boolean => {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The same sign as Date.getTimezoneOffset(): minutes behind UTC (420 = UTC-7) of a zone at a moment. */
export function zoneBias(zone: string, at = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at)
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((Math.floor(at / 1000) * 1000 - asUtc) / 60_000)
}

/**
 * The zone to use, or null to leave the system's own.
 * system: what JS sees without an override (its zone name may be undefined when it doesn't know Windows' zone).
 */
export function resolveZone(opts: { chosen: string; windows: WindowsClock | null; system: { zone: string | undefined; bias: number }; at?: number }): string | null {
  const { chosen, windows, system, at = Date.now() } = opts
  if (chosen && isZone(chosen)) return chosen
  if (!windows) return null
  const systemRight = system.bias === windows.bias && !!system.zone && system.zone !== 'Etc/Unknown'
  if (systemRight) return null
  const fix = WINDOWS_ZONE_FIXES[windows.key]
  if (fix && isZone(fix) && zoneBias(fix, at) === windows.bias) return fix
  // Unknown zone: a fixed offset that matches the clock now (Etc/GMT+7 is UTC-7). Re-checked hourly.
  if (windows.bias % 60 === 0 && Math.abs(windows.bias) <= 14 * 60) {
    const h = windows.bias / 60
    return h === 0 ? 'Etc/UTC' : `Etc/GMT${h > 0 ? '+' : '-'}${Math.abs(h)}`
  }
  return null
}

export function parseRegistry(out: string): WindowsClock | null {
  const key = /TimeZoneKeyName\s+REG_SZ\s+(.+)/.exec(out)?.[1]?.trim()
  const raw = /ActiveTimeBias\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out)?.[1]
  if (!key || raw === undefined) return null
  const n = parseInt(raw, 16)
  return { key, bias: n > 0x7fffffff ? n - 0x100000000 : n } // a DWORD holding a signed number (east of UTC is negative)
}
