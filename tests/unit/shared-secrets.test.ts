import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// Windows encryption stand-in: reversible, enough to test the sharing rules
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))
const { migrate } = await import('../../src/main/db')
const { getSecret, putSecret } = await import('../../src/main/secrets')
const { syncSharedSecrets, openBundle } = await import('../../src/main/shared-secrets')
const { getSetting, setSetting } = await import('../../src/main/services/settings')
type Db = import('../../src/main/db').Db

const SYNC_KEY = 'k'.repeat(43)
function pc(): Db {
  const db = new DatabaseSync(':memory:') as unknown as Db
  migrate(db)
  putSecret(db, 'sync.key', SYNC_KEY)
  return db
}
/** What the sync service does for this one setting: copy the shared bundle from one PC to the other */
const carry = (from: Db, to: Db): void => setSetting(to, 'secrets.shared', getSetting(from, 'secrets.shared'))

describe('keys and sign-ins follow you', () => {
  it('a new PC gets the laptop’s keys, and never blanks them', () => {
    const laptop = pc()
    putSecret(laptop, 'assistant.key', 'sk-laptop')
    putSecret(laptop, 'zoho.tokens', { refresh: 'r1' })
    const desktop = pc()
    syncSharedSecrets(desktop) // nothing to share yet: must not write an empty bundle
    expect(getSetting(desktop, 'secrets.shared')).toBeNull()
    carry(laptop, desktop)
    expect(syncSharedSecrets(desktop)).toMatchObject({ took: ['assistant.key', 'zoho.tokens'] })
    expect(getSecret(desktop, 'assistant.key')).toBe('sk-laptop')
    expect(getSecret(desktop, 'zoho.tokens')).toEqual({ refresh: 'r1' })
  })

  it('keys set before sharing existed fill blanks without overriding real changes', () => {
    const laptop = pc()
    putSecret(laptop, 'assistant.key', 'sk-new')
    const desktop = pc()
    setSetting(desktop, 'assistant.key', null)
    // The desktop had a Google key from before (no change time): it fills the laptop's blank…
    setSetting(desktop, 'google.client', Buffer.from('enc:{"id":"g"}').toString('base64'))
    carry(laptop, desktop)
    syncSharedSecrets(desktop)
    carry(desktop, laptop)
    syncSharedSecrets(laptop)
    expect(getSecret(laptop, 'google.client')).toEqual({ id: 'g' })
    expect(getSecret(desktop, 'assistant.key')).toBe('sk-new')
  })

  it('the newest change wins per key, and disconnecting travels too', () => {
    const laptop = pc()
    const desktop = pc()
    putSecret(laptop, 'qbo.tokens', { refresh: 'old' })
    carry(laptop, desktop)
    syncSharedSecrets(desktop)
    putSecret(desktop, 'qbo.tokens', { refresh: 'rotated' }) // a refresh on the desktop
    carry(desktop, laptop)
    syncSharedSecrets(laptop)
    expect(getSecret(laptop, 'qbo.tokens')).toEqual({ refresh: 'rotated' })
    putSecret(laptop, 'qbo.tokens', null) // disconnected on the laptop
    carry(laptop, desktop)
    syncSharedSecrets(desktop)
    expect(getSecret(desktop, 'qbo.tokens')).toBeNull()
  })

  it('the bundle is sealed: no key in it can be read without the sync key', () => {
    const laptop = pc()
    putSecret(laptop, 'assistant.key', 'sk-secret-value')
    const sealed = String(getSetting(laptop, 'secrets.shared'))
    expect(sealed).not.toContain('sk-secret-value')
    expect(openBundle(sealed, 'x'.repeat(43))).toBeNull()
    expect(getSecret(laptop, 'sync.key')).toBe(SYNC_KEY)
    expect(openBundle(sealed, SYNC_KEY)!['assistant.key'].v).toBe('sk-secret-value')
    expect(openBundle(sealed, SYNC_KEY)!['sync.key']).toBeUndefined() // the sync key itself never travels this way
  })
})
