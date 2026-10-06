/*
 * The few node:crypto functions Plannr's services use, for the phone web app. AES-GCM and scrypt come from the
 * audited @noble libraries and produce exactly what Node does, so a vault made on the PC opens on the phone.
 */
import { gcm } from '@noble/ciphers/aes.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'

type Bytes = Uint8Array
const utf8 = new TextEncoder()
const asBytes = (d: Bytes | string): Bytes => (typeof d === 'string' ? utf8.encode(d) : d)
const concat = (parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export const randomBytes = (n: number): Buffer => Buffer.from(crypto.getRandomValues(new Uint8Array(n)))
export const randomUUID = (): string => crypto.randomUUID()

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash: ${algorithm}`)
  const parts: Bytes[] = []
  const hash = {
    update(data: Bytes | string) {
      parts.push(asBytes(data))
      return hash
    },
    digest(encoding?: 'hex' | 'base64') {
      const out = Buffer.from(sha256(concat(parts)))
      return encoding ? out.toString(encoding) : out
    }
  }
  return hash
}

function checkGcm(algorithm: string, key: Bytes): void {
  if (algorithm !== 'aes-256-gcm' || key.length !== 32) throw new Error(`Unsupported cipher: ${algorithm}`)
}

export function createCipheriv(algorithm: string, key: Bytes, iv: Bytes) {
  checkGcm(algorithm, key)
  let aad: Bytes | undefined
  let tag: Bytes | null = null
  const parts: Bytes[] = []
  const cipher = {
    setAAD(data: Bytes) {
      aad = data
      return cipher
    },
    update(data: Bytes) {
      parts.push(data)
      return Buffer.alloc(0) // everything comes out of final()
    },
    final() {
      const sealed = gcm(key, iv, aad).encrypt(concat(parts))
      tag = sealed.subarray(sealed.length - 16)
      return Buffer.from(sealed.subarray(0, sealed.length - 16))
    },
    getAuthTag() {
      if (!tag) throw new Error('getAuthTag before final')
      return Buffer.from(tag)
    }
  }
  return cipher
}

export function createDecipheriv(algorithm: string, key: Bytes, iv: Bytes) {
  checkGcm(algorithm, key)
  let aad: Bytes | undefined
  let tag: Bytes | null = null
  const parts: Bytes[] = []
  const decipher = {
    setAAD(data: Bytes) {
      aad = data
      return decipher
    },
    setAuthTag(data: Bytes) {
      tag = data
      return decipher
    },
    update(data: Bytes) {
      parts.push(data)
      return Buffer.alloc(0)
    },
    final() {
      if (!tag) throw new Error('Missing auth tag')
      return Buffer.from(gcm(key, iv, aad).decrypt(concat([...parts, tag]))) // throws if the key is wrong or data changed
    }
  }
  return decipher
}

export interface ScryptOptions {
  N?: number
  r?: number
  p?: number
  maxmem?: number
}

export function scrypt(secret: string | Bytes, salt: Bytes, keylen: number, options: ScryptOptions, callback: (err: Error | null, key: Buffer) => void): void {
  scryptAsync(asBytes(secret), salt, {
    N: options.N ?? 16384,
    r: options.r ?? 8,
    p: options.p ?? 1,
    dkLen: keylen,
    ...(options.maxmem ? { maxmem: options.maxmem } : {})
  })
    .then((key) => callback(null, Buffer.from(key)))
    .catch((err: Error) => callback(err, Buffer.alloc(0)))
}
