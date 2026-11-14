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

describe('beta channel', () => {
  it('orders betas before their release and after the previous stable', async () => {
    const { compareVersions, pickNewest } = await import('../../src/main/updater')
    const order = ['1.0.0', '1.1.0', '2.0.0-beta.1', '2.0.0-beta.2', '2.0.0-beta.10', '2.0.0', '2.1.0']
    for (let i = 1; i < order.length; i++) expect(compareVersions(order[i], order[i - 1]), `${order[i]} > ${order[i - 1]}`).toBeGreaterThan(0)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
    const asset = (v: string) => [{ name: `Plannr-Setup-${v}.exe`, browser_download_url: '', size: 1 }]
    type R = import('../../src/main/updater').Release
    const list = [
      { tag_name: 'v2.0.0-beta.2', prerelease: true, assets: asset('2.0.0-beta.2') },
      { tag_name: 'v2.0.0-beta.3', draft: true, assets: asset('2.0.0-beta.3') }, // drafts aren't published
      { tag_name: 'v1.1.0', assets: asset('1.1.0') },
      { tag_name: 'v2.0.0-beta.4', prerelease: true, assets: [] } // no installer yet
    ]
    expect(pickNewest(list as R[])!.tag_name).toBe('v2.0.0-beta.2')
  })
})
