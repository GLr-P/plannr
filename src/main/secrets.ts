import { safeStorage } from 'electron'
import type { Db } from './db'
import { getSetting, setSetting } from './services/settings'

/**
 * Settings encrypted with Windows (safeStorage / DPAPI): only this Windows account on this PC can read them.
 * Used for integration keys and sign-in tokens.
 */
export function putSecret(db: Db, key: string, value: unknown): void {
  if (value === null) return setSetting(db, key, null)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available on this account')
  setSetting(db, key, safeStorage.encryptString(JSON.stringify(value)).toString('base64'))
}

export function getSecret<T>(db: Db, key: string): T | null {
  const v = getSetting(db, key)
  if (typeof v !== 'string') return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(v, 'base64'))) as T
  } catch {
    return null // e.g. data copied from another Windows account
  }
}
