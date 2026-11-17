/*
 * The Troubleshootr inbox ("drop"): a write-only way for Troubleshootr (a diagnostic tool on a USB stick) to send scan
 * reports into Plannr through the sync service, without holding the sync key. Web Crypto only (PC and phone).
 *
 * The link Plannr shows once, https://<server>/#troubleshootr=<space>.<secret>.<publicKey>, gives Troubleshootr:
 *   token  = hex(SHA-256("plannr-drop-token" ‖ secret))   lets it post to this space's inbox (the server keeps its hash)
 *   info   = keys from the secret                          opens the list of open tickets Plannr publishes for it
 *   public = P-256 key                                     reports are sealed to it; only Plannr holds the private key
 * So a lost stick can add reports to the inbox and see open ticket numbers, never read anything else.
 *
 * Formats (Troubleshootr's PlannrDrop.cs writes the same bytes; .NET Framework has no AES-GCM, hence CBC + HMAC):
 *   report: 0x01 | ephemeral public key (65, uncompressed) | IV (16) | AES-256-CBC ciphertext | HMAC-SHA256 (32)
 *           Z = ECDH x-coordinate; enc = SHA-256("plannr-drop-enc" ‖ Z); mac = SHA-256("plannr-drop-mac" ‖ Z)
 *   info:   0x02 | IV (16) | AES-256-CBC ciphertext | HMAC-SHA256 (32), keys SHA-256("plannr-drop-info-enc|mac" ‖ secret)
 *   The HMAC covers everything before it. Payloads are gzip-compressed JSON.
 */

type Bytes = Uint8Array<ArrayBuffer>
/** Works whether or not the browser (DOM) type library is loaded */
type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>
type Jwk = Extract<Parameters<typeof crypto.subtle.importKey>[1], { kty?: string }>

const te = new TextEncoder()

export const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const fromB64url = (s: string): Bytes => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const sha256 = async (...parts: Uint8Array[]): Promise<Bytes> => new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...parts)))

export interface DropKeys {
  /** 32 random bytes, base64url */
  secret: string
  /** P-256 private key as JWK JSON (kept only on this PC, Windows-encrypted) */
  privateJwk: string
  /** Uncompressed P-256 public key, base64url */
  publicKey: string
}

export async function newDropKeys(): Promise<DropKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as { publicKey: CryptoKey; privateKey: CryptoKey }
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    secret: b64url(crypto.getRandomValues(new Uint8Array(32))),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    publicKey: b64url(pub)
  }
}

/** What Troubleshootr authenticates with; the server stores SHA-256(token) */
export async function dropToken(secret: string): Promise<string> {
  return hex(await sha256(te.encode('plannr-drop-token'), fromB64url(secret)))
}

export const dropLink = (server: string, space: string, keys: DropKeys): string =>
  `${server.replace(/\/+$/, '')}/#troubleshootr=${space}.${keys.secret}.${keys.publicKey}`

async function cbcHmacSeal(prefix: Uint8Array, encKey: Bytes, macKey: Bytes, plain: Uint8Array): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const aes = await crypto.subtle.importKey('raw', encKey, 'AES-CBC', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aes, plain as Bytes))
  const body = concat(prefix, iv, ct)
  const hmac = await crypto.subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return concat(body, new Uint8Array(await crypto.subtle.sign('HMAC', hmac, body)))
}

async function cbcHmacOpen(sealed: Uint8Array, prefixLength: number, encKey: Bytes, macKey: Bytes): Promise<Bytes> {
  if (sealed.length < prefixLength + 16 + 16 + 32) throw new Error('The report is damaged (too short)')
  const body = sealed.slice(0, sealed.length - 32)
  const hmac = await crypto.subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  if (!(await crypto.subtle.verify('HMAC', hmac, sealed.slice(sealed.length - 32), body))) throw new Error('The report doesn’t belong to this Plannr or was changed')
  const iv = body.slice(prefixLength, prefixLength + 16)
  const aes = await crypto.subtle.importKey('raw', encKey, 'AES-CBC', false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aes, body.slice(prefixLength + 16)))
}

async function gzip(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await new Response(new Blob([data as Bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
async function gunzip(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await new Response(new Blob([data as Bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
}

/** Opens a report Troubleshootr sealed to this Plannr's public key. Throws a readable error if it isn't ours or is damaged. */
export async function openReport(keys: Pick<DropKeys, 'privateJwk'>, sealed: Uint8Array): Promise<unknown> {
  if (sealed[0] !== 1 || sealed.length < 1 + 65 + 64) throw new Error('Not a Troubleshootr report')
  const priv = await crypto.subtle.importKey('jwk', JSON.parse(keys.privateJwk) as Jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const eph = await crypto.subtle.importKey('raw', sealed.slice(1, 66), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const z = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: eph }, priv, 256))
  const plain = await cbcHmacOpen(sealed, 66, await sha256(te.encode('plannr-drop-enc'), z), await sha256(te.encode('plannr-drop-mac'), z))
  return JSON.parse(new TextDecoder().decode(await gunzip(plain)))
}

/** Seals a report to a public key, as Troubleshootr does (used by the tests). */
export async function sealReport(publicKey: string, payload: unknown): Promise<Bytes> {
  const pub = await crypto.subtle.importKey('raw', fromB64url(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as { publicKey: CryptoKey; privateKey: CryptoKey }
  const z = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256))
  const prefix = concat(new Uint8Array([1]), new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey)))
  return cbcHmacSeal(prefix, await sha256(te.encode('plannr-drop-enc'), z), await sha256(te.encode('plannr-drop-mac'), z), await gzip(te.encode(JSON.stringify(payload))))
}

/** Seals the open-tickets list so a holder of the link's secret can read it. */
export async function sealInfo(secret: string, payload: unknown): Promise<Bytes> {
  const s = fromB64url(secret)
  return cbcHmacSeal(new Uint8Array([2]), await sha256(te.encode('plannr-drop-info-enc'), s), await sha256(te.encode('plannr-drop-info-mac'), s), await gzip(te.encode(JSON.stringify(payload))))
}

export async function openInfo(secret: string, sealed: Uint8Array): Promise<unknown> {
  if (sealed[0] !== 2) throw new Error('Not a Plannr ticket list')
  const s = fromB64url(secret)
  return JSON.parse(new TextDecoder().decode(await gunzip(await cbcHmacOpen(sealed, 1, await sha256(te.encode('plannr-drop-info-enc'), s), await sha256(te.encode('plannr-drop-info-mac'), s)))))
}
