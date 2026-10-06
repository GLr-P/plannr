import { DatabaseSync } from 'node:sqlite'
import type { D1Database, D1Prepared, Env } from '../../server/src/worker'
import worker, { SCHEMA } from '../../server/src/worker'

/** Cloudflare D1, imitated with node:sqlite, so the real sync service code runs in tests. */
export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  const prepared = (sql: string, params: unknown[] = []): D1Prepared => ({
    bind: (...values: unknown[]) => prepared(sql, values),
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
    run: async () => db.prepare(sql).run(...(params as never[]))
  })
  return {
    prepare: (sql) => prepared(sql),
    batch: async (stmts) => {
      db.exec('BEGIN')
      try {
        const out = []
        for (const s of stmts) out.push(await s.run())
        db.exec('COMMIT')
        return out
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  }
}

/** The sync service running in-process: fetch(path, init) → Response. */
export function fakeServer(ownerSecret = 'owner-secret'): { env: Env; fetch: (path: string, init?: RequestInit) => Promise<Response> } {
  const env: Env = { DB: fakeD1(), OWNER_SECRET: ownerSecret }
  return { env, fetch: (path, init) => worker.fetch(new Request(`https://sync.test${path}`, init), env) }
}

/** The sync service on a local port (for end-to-end tests with real app windows). */
export async function serveHttp(srv: ReturnType<typeof fakeServer>): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = await import('node:http')
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
    const out = await srv.fetch(req.url ?? '/', { method: req.method, headers, body })
    res.writeHead(out.status, Object.fromEntries(out.headers.entries()))
    res.end(Buffer.from(await out.arrayBuffer()))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) }
}
