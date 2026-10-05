import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} })) // only the version comparison is tested here
const { newerThan } = await import('../../src/main/updater')

describe('update version check', () => {
  it('compares versions number by number', () => {
    expect(newerThan('0.9.1', '0.9.0')).toBe(true)
    expect(newerThan('v1.0.0', '0.9.9')).toBe(true)
    expect(newerThan('1.2.10', '1.2.9')).toBe(true)
    expect(newerThan('0.9.0', '0.9.0')).toBe(false)
    expect(newerThan('0.9.0', '0.10.0')).toBe(false)
    expect(newerThan('1.0.0-beta', '0.9.0')).toBe(true)
    expect(newerThan('1.0', '1.0.0')).toBe(false)
  })
})
