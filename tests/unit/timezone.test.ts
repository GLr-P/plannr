import { describe, expect, it } from 'vitest'
import { isZone, parseRegistry, resolveZone, zoneBias } from '../../src/main/services/timezone'

// `reg query HKLM\SYSTEM\CurrentControlSet\Control\TimeZoneInformation` on a BC PC after BC kept daylight time (Nov 2026)
const BC_2026 = `HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation
    Bias    REG_DWORD    0x1e0
    DaylightBias    REG_DWORD    0xffffffc4
    DaylightName    REG_SZ    British Columbia Daylight Time
    StandardName    REG_SZ    British Columbia Standard Time
    TimeZoneKeyName    REG_SZ    British Columbia Standard Time
    DynamicDaylightTimeDisabled    REG_DWORD    0x0
    ActiveTimeBias    REG_DWORD    0x1a4
`
const NOV_13 = Date.UTC(2026, 10, 13, 22, 0)

describe('time zone', () => {
  it('reads the zone and the offset Windows uses now from the registry', () => {
    expect(parseRegistry(BC_2026)).toEqual({ key: 'British Columbia Standard Time', bias: 420 })
    // East of UTC the DWORD holds a negative number
    expect(parseRegistry(BC_2026.replace('0x1a4', '0xfffffe20'))?.bias).toBe(-480)
    expect(parseRegistry('nothing here')).toBeNull()
  })

  it('corrects the clock when Electron does not know Windows’ new BC zone (it fell back to UTC-8)', () => {
    // What Electron 44 reported on that PC: no zone name and the old winter offset
    const zone = resolveZone({ chosen: '', windows: parseRegistry(BC_2026), system: { zone: undefined, bias: 480 }, at: NOV_13 })
    expect(zone).not.toBeNull()
    expect(zoneBias(zone!, NOV_13)).toBe(420)
    expect(new Date(NOV_13).toLocaleTimeString('en-US', { timeZone: zone!, hour: 'numeric', minute: '2-digit' })).toBe('3:00 PM')
  })

  it('falls back to a fixed offset for any other zone it does not know', () => {
    expect(resolveZone({ chosen: '', windows: { key: 'Some New Zone', bias: 300 }, system: { zone: undefined, bias: 360 } })).toBe('Etc/GMT+5')
    expect(resolveZone({ chosen: '', windows: { key: 'Some New Zone', bias: -120 }, system: { zone: 'Etc/Unknown', bias: 0 } })).toBe('Etc/GMT-2')
  })

  it('leaves the system clock alone when it already matches Windows', () => {
    expect(resolveZone({ chosen: '', windows: { key: 'Pacific Standard Time', bias: 480 }, system: { zone: 'America/Los_Angeles', bias: 480 } })).toBeNull()
    expect(resolveZone({ chosen: '', windows: null, system: { zone: undefined, bias: 480 } })).toBeNull()
  })

  it('uses the zone picked in Settings, ignoring unknown ones', () => {
    expect(resolveZone({ chosen: 'Europe/Paris', windows: parseRegistry(BC_2026), system: { zone: undefined, bias: 480 } })).toBe('Europe/Paris')
    expect(isZone('Not/AZone')).toBe(false)
    expect(resolveZone({ chosen: 'Not/AZone', windows: { key: 'Pacific Standard Time', bias: 480 }, system: { zone: 'America/Los_Angeles', bias: 480 } })).toBeNull()
  })

  it('works out a zone’s offset at a moment', () => {
    expect(zoneBias('Asia/Kolkata', NOV_13)).toBe(-330)
    expect(zoneBias('America/New_York', Date.UTC(2026, 6, 1))).toBe(240)
    expect(zoneBias('America/New_York', Date.UTC(2026, 11, 1))).toBe(300)
  })
})
