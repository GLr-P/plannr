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
