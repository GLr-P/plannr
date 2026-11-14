import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Db } from './db'
import { getSetting, setSetting } from './services/settings'
import { getSecret, putSecret } from './secrets'

/**
 * Keys and sign-ins follow you to your other PCs (requested 2026-11-14: "my laptop has all my settings, my PC
 * doesn't"). Locally each secret stays encrypted with Windows (secrets.ts). For sharing, they're bundled into the
 * synced setting 'secrets.shared', sealed with AES-256-GCM under a key made from your sync key, so only your
 * devices can open it (and the sync server only ever sees it sealed a second time).
 *
 * Each key carries when it was last changed; per key, the newest change wins. A PC that never set a key can't
 * blank it on the others: only a real change (connecting, a new key, disconnecting) travels.
 * Not shared: the sync key itself (it opens everything) and anything tied to one PC.
 */
export const SHARED_SECRETS = [
  'assistant.key',
  'assistant.openaiKey',
  'assistant.geminiKey',
  'assistant.groqKey',
  'assistant.ollamaKey',
  'track17.key',
  'pandascore.token',
  'google.client',
  'google.tokens',
  'qbo.client',
  'qbo.tokens',
  'zoho.client',
  'zoho.tokens'
] as const

const BUNDLE = 'secrets.shared'
/** When this PC last changed each shared secret (or took it from another PC) */
const STAMPS = 'secrets.stamps'

/** key → { v: the value (null = disconnected), at: when it changed } */
type Bundle = Record<string, { v: unknown; at: number }>

const keyFrom = (syncKey: string): Buffer => createHash('sha256').update(`plannr-shared-secrets:${syncKey}`).digest()

export function sealBundle(bundle: Bundle, syncKey: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(syncKey), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()])
  return JSON.stringify({ v: 2, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') })
}

export function openBundle(sealed: unknown, syncKey: string): Bundle | null {
  try {
    const s = JSON.parse(String(sealed)) as { v: number; iv: string; data: string; tag: string }
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(syncKey), Buffer.from(s.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(s.tag, 'base64'))
    const b = JSON.parse(Buffer.concat([decipher.update(Buffer.from(s.data, 'base64')), decipher.final()]).toString('utf8')) as Bundle
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null
  } catch {
    return null // another space's bundle, or damaged: ignored
  }
}

const stamps = (db: Db): Record<string, number> => {
  const s = getSetting(db, STAMPS)
  return s && typeof s === 'object' ? (s as Record<string, number>) : {}
}

/** Notes that a shared secret changed here (called by putSecret), then shares it */
export function sharedSecretChanged(db: Db, key: string, now = Date.now()): void {
  if (!(SHARED_SECRETS as readonly string[]).includes(key)) return
  setSetting(db, STAMPS, { ...stamps(db), [key]: now })
  syncSharedSecrets(db)
}

/**
 * Per key, takes the other PCs' newer changes and shares this PC's newer ones. A key this PC has but never stamped
 * (set before sharing existed) counts as very old, so it fills in blanks elsewhere without overriding real changes.
 * Cheap when nothing changed; run at start, every minute (pulls arrive in the background) and on every change.
 */
export function syncSharedSecrets(db: Db): { took: string[]; shared: boolean } | 'off' {
  const syncKey = getSecret<string>(db, 'sync.key')
  if (!syncKey) return 'off'
  const raw = getSetting(db, BUNDLE)
  const theirs: Bundle = (raw ? openBundle(raw, syncKey) : null) ?? {}
  const local = stamps(db)
  const nextStamps = { ...local }
  const next: Bundle = {}
  const took: string[] = []
  for (const key of SHARED_SECRETS) {
    const value = getSecret(db, key)
    const mineAt = local[key] ?? (value !== null ? 1 : 0)
    const remote = theirs[key]
    if (remote && remote.at > mineAt) {
      if (JSON.stringify(value) !== JSON.stringify(remote.v ?? null)) {
        putSecret(db, key, remote.v ?? null, { share: false })
        took.push(key)
      }
      nextStamps[key] = remote.at
      next[key] = remote
    } else if (mineAt > 0) next[key] = { v: value, at: mineAt }
    else if (remote) next[key] = remote
  }
  if (took.length) setSetting(db, STAMPS, nextStamps)
  const changed = JSON.stringify(next) !== JSON.stringify(theirs)
  if (changed) setSetting(db, BUNDLE, sealBundle(next, syncKey))
  return { took, shared: changed }
}

/** Keeps them level: at start, then every minute */
export function startSharedSecrets(db: Db): () => void {
  const run = (): void => {
    try {
      syncSharedSecrets(db)
    } catch {
      // Windows encryption unavailable: secrets simply stay on this PC
    }
  }
  run()
  const timer = setInterval(run, 60_000)
  return () => clearInterval(timer)
}
