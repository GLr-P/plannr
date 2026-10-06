/*
 * node:sqlite's DatabaseSync, on SQLite compiled to WebAssembly (the phone web app). Covers what Plannr uses:
 * prepare().all/get/run with positional parameters, exec, function, isTransaction, close.
 *
 * Call useSqlite() once with the initialised module before opening databases. Files open in the "opfs-sahpool"
 * storage (the browser's private file system), which works in Safari on iPhone without special server headers.
 */
import type { Database, PreparedStatement, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

type Pool = { OpfsSAHPoolDb: new (filename: string) => Database }
let sqlite3: Sqlite3Static | null = null
let pool: Pool | null = null

export function useSqlite(module: Sqlite3Static, sahPool: Pool | null = null): void {
  sqlite3 = module
  pool = sahPool
}

type Param = null | number | bigint | string | Uint8Array | boolean | undefined
type Row = Record<string, unknown>

const MAX_CACHED = 400

export class StatementSync {
  constructor(
    private owner: DatabaseSync,
    private sql: string
  ) {}

  private bound(params: Param[]): PreparedStatement {
    const stmt = this.owner.statement(this.sql)
    if (params.length) {
      for (const p of params) if (p === undefined) throw new TypeError('Provided value cannot be bound to SQLite parameter')
      stmt.bind(params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p)) as never)
    }
    return stmt
  }

  all(...params: Param[]): Row[] {
    const stmt = this.bound(params)
    try {
      const rows: Row[] = []
      while (stmt.step()) rows.push(stmt.get({}) as Row)
      return rows
    } finally {
      stmt.reset(true)
    }
  }

  get(...params: Param[]): Row | undefined {
    const stmt = this.bound(params)
    try {
      return stmt.step() ? (stmt.get({}) as Row) : undefined
    } finally {
      stmt.reset(true)
    }
  }

  run(...params: Param[]): { changes: number; lastInsertRowid: number } {
    const stmt = this.bound(params)
    try {
      stmt.step()
    } finally {
      stmt.reset(true)
    }
    return this.owner.lastChange()
  }
}

export class DatabaseSync {
  private db: Database
  // Prepared statements are reused by SQL text (WebAssembly memory isn't garbage-collected, so they're finalized here).
  private cache = new Map<string, PreparedStatement>()

  constructor(filename: string) {
    if (!sqlite3) throw new Error('SQLite isn’t loaded yet')
    this.db = filename === ':memory:' || !pool ? new sqlite3.oo1.DB(filename, 'c') : new pool.OpfsSAHPoolDb(filename)
  }

  /** @internal */
  statement(sql: string): PreparedStatement {
    let stmt = this.cache.get(sql)
    if (stmt) {
      this.cache.delete(sql) // most recently used goes last
    } else {
      stmt = this.db.prepare(sql)
      if (this.cache.size >= MAX_CACHED) {
        const [oldSql, old] = this.cache.entries().next().value as [string, PreparedStatement]
        this.cache.delete(oldSql)
        old.finalize()
      }
    }
    this.cache.set(sql, stmt)
    return stmt
  }

  /** @internal */
  lastChange(): { changes: number; lastInsertRowid: number } {
    return { changes: this.db.changes() as number, lastInsertRowid: Number(sqlite3!.capi.sqlite3_last_insert_rowid(this.db.pointer!)) }
  }

  prepare(sql: string): StatementSync {
    this.statement(sql) // compile now, so SQL errors surface here as with node:sqlite
    return new StatementSync(this, sql)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  function(name: string, options: { deterministic?: boolean } | ((...args: never[]) => unknown), fn?: (...args: never[]) => unknown): void {
    const impl = (typeof options === 'function' ? options : fn)!
    const deterministic = typeof options === 'object' && options.deterministic
    this.db.createFunction({
      name,
      arity: impl.length,
      deterministic: Boolean(deterministic),
      xFunc: (_ctx: number, ...args: unknown[]) => impl(...(args as never[])) as never
    })
  }

  get isTransaction(): boolean {
    return !sqlite3!.capi.sqlite3_get_autocommit(this.db.pointer!)
  }

  get isOpen(): boolean {
    return this.db.isOpen()
  }

  close(): void {
    for (const stmt of this.cache.values()) stmt.finalize()
    this.cache.clear()
    this.db.close()
  }
}
