/*
 * Plannr sync service (a Cloudflare Worker). It stores only encrypted changes: every row is sealed on the device
 * with a key the service never sees. Each "space" (one business's devices) has its own change log.
 *
 *   POST /api/spaces                     create a space (needs the owner secret set at deploy time)
 *   GET  /api/s/:space/hello             check the device's token; returns the latest change number
 *   POST /api/s/:space/push              { device, changes: [{ tbl, id, ts, data }] } → keeps the newest per row
 *   GET  /api/s/:space/pull?since=&limit= changes after a change number
 *   PUT/GET/HEAD /api/s/:space/blob/:id  encrypted file contents (R2 if bound, else in D1 in 1.5 MB parts)
 *   GET  /api/ics?u=                     a public holiday calendar from Google (the phone app can't fetch it itself)
 *   GET  /api/s/<space>/fetch?u=         a public web page or feed for a signed-in device (news on the phone)
 *   POST /api/s/<space>/fetch?u=         the same for an allow-listed API that only answers POST (where to watch)
 *   Troubleshootr inbox (shared/drop-crypto.ts): a second, write-only token per space for the diagnostic tool
 *   GET/PUT/DELETE /api/s/:space/drop    (space token) which PC holds the inbox; { tokenHash, device } turns it on (or off),
 *                                        dropping reports sealed to the previous key (nobody can open those any more)
 *   POST /api/s/:space/inbox             (inbox token) a sealed report, up to 20 MB
 *   GET  /api/s/:space/inbox[/:id]       (space token) list the waiting reports / download one; DELETE removes one
 *   PUT  /api/s/:space/dropinfo          (space token) the sealed open-tickets list; GET it with the inbox token
 *
 * Anything else is served from the static assets (the phone web app), when they're bound.
 */
import { SCHEMA } from './schema'

export interface D1Result<T> {
  results: T[]
}
export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}
export interface D1Database {
  prepare(sql: string): D1Prepared
  batch(statements: D1Prepared[]): Promise<unknown[]>
}
export interface R2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  head(key: string): Promise<unknown | null>
  delete(key: string): Promise<void>
}
export interface Env {
  DB: D1Database
  FILES?: R2Bucket
  ASSETS?: { fetch(request: Request): Promise<Response> }
  /** Required to create a space; set with `wrangler secret put OWNER_SECRET` */
  OWNER_SECRET?: string
}

// The tables live in schema.ts.

const MAX_PUSH = 40 // D1 allows 50 queries per request on the free plan
const PART = 1_500_000 // D1 rows are at most 2 MB
const MAX_REPORT = 20_000_000
const MAX_WAITING = 50 // reports waiting in one inbox, so a lost link can't fill the storage
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
/** Hosts the fetch helper may send a request body to */
const POST_HOSTS = ['apis.justwatch.com']

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, HEAD, OPTIONS' }

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Creates the tables on first use (once per worker instance; cheap when they exist), so deploying needs no extra step.
let schemaReady: Promise<unknown> | null = null
const ensureSchema = (db: D1Database): Promise<unknown> =>
  (schemaReady ??= db.batch(SCHEMA.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s))).catch((err) => {
    schemaReady = null
    throw err
  }))

const validId = (s: string): boolean => /^[A-Za-z0-9_-]{8,128}$/.test(s)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Plannr sync service', { headers: CORS })
    }
    try {
      await ensureSchema(env.DB)
      return await api(request, env, url)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  }
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/api/ics') {
    // Only Google's public holiday calendars, so this can't be used to fetch anything else.
    const target = url.searchParams.get('u') ?? ''
    if (!/^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/?#]+%23holiday%40group\.v\.calendar\.google\.com\/public\/basic\.ics$/.test(target)) return json({ error: 'Not allowed' }, 400)
    const res = await fetch(target)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=86400', ...CORS } })
  }

  if (url.pathname === '/api/spaces' && request.method === 'POST') {
    const body = (await request.json()) as { space?: string; authHash?: string; ownerSecret?: string }
    if (!env.OWNER_SECRET || body.ownerSecret !== env.OWNER_SECRET) return json({ error: 'Wrong setup code' }, 403)
    if (!body.space || !validId(body.space) || !body.authHash || !/^[0-9a-f]{64}$/.test(body.authHash)) return json({ error: 'Bad request' }, 400)
    const existing = await env.DB.prepare('SELECT auth_hash FROM spaces WHERE id = ?').bind(body.space).first<{ auth_hash: string }>()
    if (existing && existing.auth_hash !== body.authHash) return json({ error: 'That space already exists' }, 409)
    if (!existing) await env.DB.prepare('INSERT INTO spaces (id, auth_hash, created_at) VALUES (?, ?, ?)').bind(body.space, body.authHash, Date.now()).run()
    return json({ ok: true })
  }

  const m = /^\/api\/s\/([A-Za-z0-9_-]+)\/(hello|push|pull|blob|fetch|drop|inbox|dropinfo)(?:\/([A-Za-z0-9_.-]+))?$/.exec(url.pathname)
  if (!m) return json({ error: 'Not found' }, 404)
  const [, space, action, blobId] = m
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')

  // Troubleshootr's side of the inbox: its own token, which can only add reports and read the open-tickets list.
  if ((action === 'inbox' && request.method === 'POST' && !blobId) || (action === 'dropinfo' && request.method === 'GET')) {
    const drop = await env.DB.prepare('SELECT token_hash, info FROM drops WHERE space = ?').bind(space).first<{ token_hash: string; info: string | null }>()
    if (!drop || !token || (await sha256Hex(token)) !== drop.token_hash) return json({ error: 'Not allowed' }, 401)
    if (action === 'dropinfo') return json({ info: drop.info })
    const waiting = await env.DB.prepare('SELECT COUNT(*) AS n FROM inbox WHERE space = ?').bind(space).first<{ n: number }>()
    if ((waiting?.n ?? 0) >= MAX_WAITING) return json({ error: 'The Plannr inbox is full; open Plannr so it can collect the reports' }, 429)
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (!bytes.length) return json({ error: 'Empty report' }, 400)
    if (bytes.length > MAX_REPORT) return json({ error: 'Too big' }, 413)
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')
    await putBytes(env, space, `inbox-${id}`, bytes)
    await env.DB.prepare('INSERT INTO inbox (space, id, size, created_at) VALUES (?, ?, ?, ?)').bind(space, id, bytes.length, Date.now()).run()
    return json({ ok: true, id })
  }

  // Every device proves it has the space's key: the token is derived from it, and only its hash is stored here.
  const row = await env.DB.prepare('SELECT auth_hash FROM spaces WHERE id = ?').bind(space).first<{ auth_hash: string }>()
  if (!row || !token || (await sha256Hex(token)) !== row.auth_hash) return json({ error: 'Not allowed' }, 401)

  if (action === 'fetch') {
    // Only public https pages, small, and only for devices that are signed in to a space
    const target = url.searchParams.get('u') ?? ''
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      return json({ error: 'Bad address' }, 400)
    }
    if (parsed.protocol !== 'https:' || /^(localhost|127.|10.|192.168.|169.254.)/.test(parsed.hostname)) return json({ error: 'Not allowed' }, 400)
    // Sending (POST) is only for public APIs that answer nothing else: where to watch (JustWatch)
    const post = request.method === 'POST'
    if (post && !POST_HOSTS.includes(parsed.hostname)) return json({ error: 'Not allowed' }, 400)
    const sent = post ? await request.text() : undefined
    if (sent && sent.length > 20_000) return json({ error: 'Too big' }, 413)
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 (compatible; Plannr news; +https://github.com/GLr-P/plannr)', Accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8' }
    const res = await fetch(parsed.toString(), post ? { method: 'POST', body: sent, headers: { ...headers, 'Content-Type': 'application/json' }, redirect: 'follow' } : { headers, redirect: 'follow' })
    const body = await res.arrayBuffer()
    if (body.byteLength > 3_000_000) return json({ error: 'Too big' }, 413)
    return new Response(body, { status: res.ok ? 200 : 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=300', ...CORS } })
  }

  if (action === 'drop') {
    if (request.method === 'GET') {
      const drop = await env.DB.prepare('SELECT token_hash AS tokenHash, device, updated_at AS updatedAt FROM drops WHERE space = ?').bind(space).first()
      return json(drop ?? { tokenHash: null })
    }
    if (request.method === 'DELETE') {
      await purgeInbox(env, space)
      await env.DB.prepare('DELETE FROM drops WHERE space = ?').bind(space).run()
      return json({ ok: true })
    }
    if (request.method !== 'PUT') return json({ error: 'Not found' }, 404)
    const body = (await request.json()) as { tokenHash?: string; device?: string }
    if (!body.tokenHash || !/^[0-9a-f]{64}$/.test(body.tokenHash)) return json({ error: 'Bad request' }, 400)
    await purgeInbox(env, space)
    await env.DB.prepare('INSERT INTO drops (space, token_hash, device, info, updated_at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT (space) DO UPDATE SET token_hash = excluded.token_hash, device = excluded.device, info = NULL, updated_at = excluded.updated_at')
      .bind(space, body.tokenHash, String(body.device ?? '').slice(0, 100), Date.now()).run()
    return json({ ok: true })
  }

  if (action === 'dropinfo' && request.method === 'PUT') {
    const info = await request.text()
    if (info.length > 500_000) return json({ error: 'Too big' }, 413)
    await env.DB.prepare('UPDATE drops SET info = ?, updated_at = ? WHERE space = ?').bind(info, Date.now(), space).run()
    return json({ ok: true })
  }

  if (action === 'inbox') {
    if (!blobId) {
      const { results } = await env.DB.prepare('SELECT id, size, created_at AS createdAt FROM inbox WHERE space = ? ORDER BY created_at').bind(space).all<{ id: string; size: number; createdAt: number }>()
      return json({ items: results })
    }
    if (request.method === 'DELETE') {
      await deleteReport(env, space, blobId)
      return json({ ok: true })
    }
    const bytes = await getBytes(env, space, `inbox-${blobId}`)
    return bytes ? new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream', ...CORS } }) : json({ error: 'Not found' }, 404)
  }

  if (action === 'hello') {
    const r = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE space = ?').bind(space).first<{ seq: number }>()
    return json({ ok: true, seq: r?.seq ?? 0, files: env.FILES ? 'r2' : 'd1' })
  }

  if (action === 'push' && request.method === 'POST') {
    const body = (await request.json()) as { device: string; changes: { tbl: string; id: string; ts: number; data: string }[] }
    const changes = (body.changes ?? []).slice(0, MAX_PUSH)
    if (!changes.length) return json({ accepted: 0 })
    // Keep the newest version of each row (by its own timestamp; ties go to the higher device id). Each accepted
    // change gets the next change number, so other devices pull it.
    const stmt = `INSERT INTO changes (space, tbl, rid, ts, device, seq, data)
      VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE space = ?1), ?6)
      ON CONFLICT (space, tbl, rid) DO UPDATE SET ts = excluded.ts, device = excluded.device, data = excluded.data,
        seq = (SELECT MAX(seq) + 1 FROM changes WHERE space = ?1)
      WHERE excluded.ts > changes.ts OR (excluded.ts = changes.ts AND excluded.device > changes.device)`
    await env.DB.batch(changes.map((c) => env.DB.prepare(stmt).bind(space, String(c.tbl), String(c.id), Number(c.ts) || 0, String(body.device ?? ''), String(c.data))))
    const r = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE space = ?').bind(space).first<{ seq: number }>()
    return json({ accepted: changes.length, seq: r?.seq ?? 0 })
  }

  if (action === 'pull') {
    const since = Number(url.searchParams.get('since')) || 0
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500))
    const { results } = await env.DB.prepare('SELECT seq, tbl, rid AS id, ts, data FROM changes WHERE space = ? AND seq > ? ORDER BY seq LIMIT ?')
      .bind(space, since, limit + 1)
      .all<{ seq: number; tbl: string; id: string; ts: number; data: string }>()
    return json({ changes: results.slice(0, limit), more: results.length > limit })
  }

  if (action === 'blob' && blobId) {
    const key = `${space}/${blobId}`
    if (request.method === 'PUT') {
      const bytes = new Uint8Array(await request.arrayBuffer())
      if (env.FILES) await env.FILES.put(key, bytes)
      else {
        const parts: D1Prepared[] = [env.DB.prepare('DELETE FROM blobs WHERE space = ? AND id = ?').bind(space, blobId)]
        for (let i = 0, n = 0; i < Math.max(1, bytes.length); i += PART, n++) parts.push(env.DB.prepare('INSERT INTO blobs (space, id, part, data) VALUES (?, ?, ?, ?)').bind(space, blobId, n, bytes.slice(i, i + PART)))
        if (parts.length > 45) return json({ error: 'File too big to sync without R2 storage' }, 413)
        await env.DB.batch(parts)
      }
      return json({ ok: true })
    }
    if (env.FILES) {
      if (request.method === 'HEAD') return new Response(null, { status: (await env.FILES.head(key)) ? 200 : 404, headers: CORS })
      const obj = await env.FILES.get(key)
      return obj ? new Response(await obj.arrayBuffer(), { headers: { 'Content-Type': 'application/octet-stream', ...CORS } }) : json({ error: 'Not found' }, 404)
    }
    const { results } = await env.DB.prepare('SELECT data FROM blobs WHERE space = ? AND id = ? ORDER BY part').bind(space, blobId).all<{ data: ArrayBuffer | Uint8Array | number[] }>()
    if (!results.length) return request.method === 'HEAD' ? new Response(null, { status: 404, headers: CORS }) : json({ error: 'Not found' }, 404)
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: CORS })
    const chunks = results.map((r) => (r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as ArrayBuffer)))
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return new Response(out, { headers: { 'Content-Type': 'application/octet-stream', ...CORS } })
  }
  return json({ error: 'Not found' }, 404)
}

async function deleteReport(env: Env, space: string, id: string): Promise<void> {
  if (env.FILES) await env.FILES.delete(`${space}/inbox-${id}`)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM inbox WHERE space = ? AND id = ?').bind(space, id),
    env.DB.prepare('DELETE FROM blobs WHERE space = ? AND id = ?').bind(space, `inbox-${id}`)
  ])
}

/** Reports waiting for the old key: after a reconnect or disconnect, nobody can open them. */
async function purgeInbox(env: Env, space: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT id FROM inbox WHERE space = ?').bind(space).all<{ id: string }>()
  for (const r of results) await deleteReport(env, space, r.id)
}

/** Stores bytes in R2 when bound, else in D1 in 1.5 MB parts. */
async function putBytes(env: Env, space: string, id: string, bytes: Uint8Array): Promise<void> {
  if (env.FILES) {
    await env.FILES.put(`${space}/${id}`, bytes)
    return
  }
  const parts: D1Prepared[] = [env.DB.prepare('DELETE FROM blobs WHERE space = ? AND id = ?').bind(space, id)]
  for (let i = 0, n = 0; i < Math.max(1, bytes.length); i += PART, n++) parts.push(env.DB.prepare('INSERT INTO blobs (space, id, part, data) VALUES (?, ?, ?, ?)').bind(space, id, n, bytes.slice(i, i + PART)))
  await env.DB.batch(parts)
}

async function getBytes(env: Env, space: string, id: string): Promise<Uint8Array | null> {
  if (env.FILES) {
    const obj = await env.FILES.get(`${space}/${id}`)
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null
  }
  const { results } = await env.DB.prepare('SELECT data FROM blobs WHERE space = ? AND id = ? ORDER BY part').bind(space, id).all<{ data: ArrayBuffer | Uint8Array | number[] }>()
  if (!results.length) return null
  const chunks = results.map((r) => (r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as ArrayBuffer)))
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
