/*
 * Plannr sync service (a Cloudflare Worker). It stores only encrypted changes: every row is sealed on the device
 * with a key the service never sees. Each "space" (one business's devices) has its own change log.
 *
 *   POST /api/spaces                     create a space (needs the owner secret set at deploy time)
 *   GET  /api/s/:space/hello             check the device's token; returns the latest change number
 *   POST /api/s/:space/push              { device, changes: [{ tbl, id, ts, data }] } → keeps the newest per row
 *   GET  /api/s/:space/pull?since=&limit= changes after a change number
 *   PUT/GET/HEAD /api/s/:space/blob/:id  encrypted file contents (R2 if bound, else in D1 in 1.5 MB parts)
 *
 * Anything else is served from the static assets (the phone web app), when they're bound.
 */

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
}
export interface Env {
  DB: D1Database
  FILES?: R2Bucket
  ASSETS?: { fetch(request: Request): Promise<Response> }
  /** Required to create a space; set with `wrangler secret put OWNER_SECRET` */
  OWNER_SECRET?: string
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, auth_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS changes (
  space TEXT NOT NULL, tbl TEXT NOT NULL, rid TEXT NOT NULL,
  ts INTEGER NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (space, tbl, rid)
);
CREATE INDEX IF NOT EXISTS changes_seq ON changes (space, seq);
CREATE TABLE IF NOT EXISTS blobs (space TEXT NOT NULL, id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (space, id, part));
`

const MAX_PUSH = 40 // D1 allows 50 queries per request on the free plan
const PART = 1_500_000 // D1 rows are at most 2 MB
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, HEAD, OPTIONS' }

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const validId = (s: string): boolean => /^[A-Za-z0-9_-]{8,128}$/.test(s)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Plannr sync service', { headers: CORS })
    }
    try {
      return await api(request, env, url)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  }
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/api/spaces' && request.method === 'POST') {
    const body = (await request.json()) as { space?: string; authHash?: string; ownerSecret?: string }
    if (!env.OWNER_SECRET || body.ownerSecret !== env.OWNER_SECRET) return json({ error: 'Wrong setup code' }, 403)
    if (!body.space || !validId(body.space) || !body.authHash || !/^[0-9a-f]{64}$/.test(body.authHash)) return json({ error: 'Bad request' }, 400)
    const existing = await env.DB.prepare('SELECT auth_hash FROM spaces WHERE id = ?').bind(body.space).first<{ auth_hash: string }>()
    if (existing && existing.auth_hash !== body.authHash) return json({ error: 'That space already exists' }, 409)
    if (!existing) await env.DB.prepare('INSERT INTO spaces (id, auth_hash, created_at) VALUES (?, ?, ?)').bind(body.space, body.authHash, Date.now()).run()
    return json({ ok: true })
  }

  const m = /^\/api\/s\/([A-Za-z0-9_-]+)\/(hello|push|pull|blob)(?:\/([A-Za-z0-9_.-]+))?$/.exec(url.pathname)
  if (!m) return json({ error: 'Not found' }, 404)
  const [, space, action, blobId] = m
  // Every device proves it has the space's key: the token is derived from it, and only its hash is stored here.
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const row = await env.DB.prepare('SELECT auth_hash FROM spaces WHERE id = ?').bind(space).first<{ auth_hash: string }>()
  if (!row || !token || (await sha256Hex(token)) !== row.auth_hash) return json({ error: 'Not allowed' }, 401)

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
