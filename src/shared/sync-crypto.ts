/*
 * Encryption for sync, shared by the desktop app and the phone web app (Web Crypto only, available in both).
 * One random 32-byte sync key (shown as a link/QR to add devices) gives:
 *   space  — which change log on the server (derived, so the key itself never leaves the device)
 *   token  — proves to the server that a device belongs (the server stores only its SHA-256)
 *   enc    — AES-256-GCM key that seals every row and file before upload
 */

/** Works whether or not the browser (DOM) type library is loaded */
export type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>
type Bytes = Uint8Array<ArrayBuffer>

const enc = new TextEncoder()
const dec = new TextDecoder()

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export function newSyncKey(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

export const validSyncKey = (key: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(key)

export interface SyncKeys {
  space: string
  token: string
  enc: CryptoKey
}

async function hkdf(base: CryptoKey, info: string, bytes: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('plannr-sync-v1'), info: enc.encode(info) }, base, bytes * 8)
  return new Uint8Array(bits)
}

export async function deriveSyncKeys(key: string): Promise<SyncKeys> {
  if (!validSyncKey(key)) throw new Error('That isn’t a valid sync code')
  const base = await crypto.subtle.importKey('raw', fromB64url(key) as Bytes, 'HKDF', false, ['deriveBits'])
  const [space, token, encBytes] = await Promise.all([hkdf(base, 'space', 16), hkdf(base, 'auth', 32), hkdf(base, 'enc', 32)])
  return {
    space: b64url(space),
    token: hex(token),
    enc: await crypto.subtle.importKey('raw', encBytes as Bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))))
}

/** Seals bytes: 12-byte IV | ciphertext+tag. `aad` binds it to its row/file, so pieces can't be swapped. */
export async function sealBytes(key: CryptoKey, data: Uint8Array, aad: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, data as Bytes))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

export async function openBytes(key: CryptoKey, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: enc.encode(aad) }, key, sealed.slice(12) as Bytes)
  return new Uint8Array(pt)
}

export async function sealText(key: CryptoKey, text: string, aad: string): Promise<string> {
  return b64url(await sealBytes(key, enc.encode(text), aad))
}

export async function openText(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  return dec.decode(await openBytes(key, fromB64url(sealed), aad))
}

/** Which profile a join link belongs to (shown on the phone, which can hold several) */
export interface LinkProfile {
  name: string
  color: string
}

/**
 * The link that adds a device: the web app's address with the key after # (never sent to the server),
 * plus the profile's name and colour so a phone can tell its profiles apart.
 */
export function joinLink(serverUrl: string, key: string, profile?: LinkProfile | null): string {
  const base = `${serverUrl.replace(/\/+$/, '')}/#join=${key}`
  if (!profile?.name) return base
  return `${base}&name=${encodeURIComponent(profile.name)}${/^#[0-9a-f]{6}$/i.test(profile.color) ? `&color=${profile.color.slice(1)}` : ''}`
}

export function parseJoinLink(text: string): { serverUrl: string; key: string; profile: LinkProfile | null } | null {
  const m = /^(https?:\/\/[^#\s]+?)\/?#join=([A-Za-z0-9_-]{43})((?:&[a-z]+=[^&\s]*)*)\s*$/.exec(text.trim())
  if (!m) return null
  const params = new URLSearchParams(m[3].slice(1))
  const name = (params.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const color = /^[0-9a-f]{6}$/i.test(params.get('color') ?? '') ? `#${params.get('color')}` : '#3b82f6'
  return { serverUrl: m[1], key: m[2], profile: name ? { name, color } : null }
}

/** A short, one-way fingerprint of a sync key (tells spaces apart without storing the key itself). */
export async function keyFingerprint(key: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`plannr-space:${key}`)))
  return Array.from(hash.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')
}
