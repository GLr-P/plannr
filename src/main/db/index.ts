import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrations } from './migrations'

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
  `)
  migrate(db)
  return db
}

/** Applies pending migrations in order; PRAGMA user_version tracks how many have run. */
export function migrate(db: Db): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let i = user_version; i < migrations.length; i++) {
    tx(db, () => {
      db.exec(migrations[i])
      db.exec(`PRAGMA user_version = ${i + 1}`)
    })
  }
}

/** Runs fn inside a transaction (or the current one, if already inside). */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export const newId = (): string => randomUUID()
export const now = (): number => Date.now()
