import { deriveSyncKeys, openBytes, openText, sealBytes, sealText, sha256Hex, type SyncKeys } from '../../shared/sync-crypto'

/*
 * The sync engine, shared by the desktop app and the phone web app (no Node or Electron imports).
 *
 * Every synced table has triggers that note changed rows in sync_dirty (with the time of the change). Push sends
 * those rows, sealed, to the server, which keeps the newest version of each row. Pull fetches what other devices
 * sent since last time and writes it in, unless this device changed the same row later (then ours goes up and wins).
 * Files (attachments, photos, vault files) travel as sealed blobs next to their rows.
 */

/** The bits of SQLite the engine needs (node:sqlite's DatabaseSync, or the phone's SQLite adapter). */
export interface SyncDb {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }
  exec(sql: string): void
}

/** Talking to the sync server: JSON in/out, and raw bytes for files. */
export interface SyncTransport {
  json<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>
  putBytes(path: string, bytes: Uint8Array): Promise<void>
  getBytes(path: string): Promise<Uint8Array | null>
}

/** Where file contents live on this device. */
export interface BlobStore {
  read(kind: BlobKind, id: string, row: Record<string, unknown>): Promise<Uint8Array | null>
  write(kind: BlobKind, id: string, row: Record<string, unknown>, bytes: Uint8Array): Promise<void>
  has(kind: BlobKind, id: string, row: Record<string, unknown>): Promise<boolean>
}
export type BlobKind = 'file' | 'vault'

/** Tables that sync, parents first (so a new device mostly receives folders before notes, tickets before lines…). */
export const SYNCED_TABLES = [
  'folders',
  'sidebar_sections',
  'files',
  'notes',
  'templates',
  'customers',
  'tickets',
  'ticket_photos',
  'ticket_items',
  'parts',
  'events',
  'recurring',
  'transactions',
  'tasks',
  'vault_keys',
  'vault_items',
  'vault_files'
] as const

/** Settings shared by every device (the rest — window size, theme, integrations, backups — stay per device). */
export const SYNCED_SETTINGS = [
  'business',
  'display',
  'messageTemplates',
  'defaultTemplateId',
  'holidayRegion',
  'holidayObservances',
  'starterTemplateCreated',
  'starterNoteTemplatesCreated',
  'vaultAutoLockMinutes',
  'eventReminders'
]

const nowMs = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`
const notApplying = `(SELECT value FROM sync_state WHERE key = 'applying') IS NOT '1'`

/** SQL for the sync tables and change-tracking triggers (run once by the database migration). */
export function syncSchemaSql(): string {
  const triggers = SYNCED_TABLES.flatMap((t) => [
    `CREATE TRIGGER sync_${t}_ins AFTER INSERT ON ${t} WHEN ${notApplying} BEGIN
       INSERT INTO sync_dirty (tbl, id, changed_at, n) VALUES ('${t}', NEW.id, ${nowMs}, 1)
       ON CONFLICT (tbl, id) DO UPDATE SET changed_at = excluded.changed_at, n = n + 1; END;`,
    `CREATE TRIGGER sync_${t}_upd AFTER UPDATE ON ${t} WHEN ${notApplying} BEGIN
       INSERT INTO sync_dirty (tbl, id, changed_at, n) VALUES ('${t}', NEW.id, ${nowMs}, 1)
       ON CONFLICT (tbl, id) DO UPDATE SET changed_at = excluded.changed_at, n = n + 1; END;`,
    `CREATE TRIGGER sync_${t}_del AFTER DELETE ON ${t} WHEN ${notApplying} BEGIN
       INSERT INTO sync_dirty (tbl, id, changed_at, n) VALUES ('${t}', OLD.id, ${nowMs}, 1)
       ON CONFLICT (tbl, id) DO UPDATE SET changed_at = excluded.changed_at, n = n + 1; END;`
  ])
  return `
    CREATE TABLE sync_dirty (tbl TEXT NOT NULL, id TEXT NOT NULL, changed_at INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (tbl, id));
    CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sync_uploaded (kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (kind, id));
    ${triggers.join('\n')}
    ${settingsTriggersSql()}
  `
}

/** Triggers noting changes to the synced settings (re-created by a migration whenever SYNCED_SETTINGS grows). */
export function settingsTriggersSql(): string {
  const keys = SYNCED_SETTINGS.map((k) => `'${k}'`).join(', ')
  const settingTrigger = (when: string) => `
    CREATE TRIGGER sync_settings_${when} AFTER ${when === 'ins' ? 'INSERT' : 'UPDATE'} ON settings WHEN NEW.key IN (${keys}) AND ${notApplying} BEGIN
      INSERT INTO sync_dirty (tbl, id, changed_at, n) VALUES ('settings', NEW.key, ${nowMs}, 1)
      ON CONFLICT (tbl, id) DO UPDATE SET changed_at = excluded.changed_at, n = n + 1; END;`
  return `${settingTrigger('ins')}\n${settingTrigger('upd')}`
}

const BLOB_KIND: Partial<Record<string, BlobKind>> = { files: 'file', vault_files: 'vault' }
const PUSH_BATCH = 40

export interface SyncResult {
  pushed: number
  pulled: number
  /** Rows written by pull, per table (for search/links upkeep and refreshing the screen) */
  touched: Map<string, Set<string>>
}

export class SyncEngine {
  private keys: SyncKeys | null = null
  private columns = new Map<string, Set<string>>()

  constructor(
    private db: SyncDb,
    private transport: SyncTransport,
    private blobs: BlobStore,
    private device: string
  ) {}

  private state(key: string): string | null {
    return ((this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null) as string | null
  }
  private setState(key: string, value: string | null): void {
    this.db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  async init(syncKey: string): Promise<SyncKeys> {
    this.keys = await deriveSyncKeys(syncKey)
    return this.keys
  }

  private get k(): SyncKeys {
    if (!this.keys) throw new Error('Sync isn’t set up')
    return this.keys
  }

  private base(): string {
    return `/api/s/${this.k.space}`
  }

  /** First device: creates the space on the server (needs the owner secret from setup). */
  async createSpace(ownerSecret: string): Promise<void> {
    await this.transport.json('POST', '/api/spaces', { space: this.k.space, authHash: await sha256Hex(this.k.token), ownerSecret })
  }

  async hello(): Promise<{ seq: number; files: string }> {
    return this.transport.json('GET', `${this.base()}/hello`)
  }

  /**
   * Marks everything on this device as changed, so it all goes up. The first device uses now; a device joining with
   * data of its own uses 1, so where both have the same row (fixed ids like the Pinned section) the space's copy wins.
   */
  markAllDirty(t = Date.now()): void {
    for (const tbl of SYNCED_TABLES) this.db.prepare(`INSERT OR IGNORE INTO sync_dirty (tbl, id, changed_at) SELECT ?, id, ? FROM ${tbl}`).run(tbl, t)
    const keys = SYNCED_SETTINGS.map(() => '?').join(', ')
    this.db.prepare(`INSERT OR IGNORE INTO sync_dirty (tbl, id, changed_at) SELECT 'settings', key, ? FROM settings WHERE key IN (${keys})`).run(t, ...SYNCED_SETTINGS)
  }

  /** True when this device has nothing of its own yet (only what Plannr creates by itself on first start). */
  isFresh(): boolean {
    const own = ['notes', 'customers', 'tickets', 'transactions', 'recurring', 'events', 'tasks', 'parts', 'files', 'vault_keys']
    return own.every((t) => !this.db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get())
  }

  /** Removes this device's rows (starter templates, sections…) without telling the server, before joining a space. */
  wipeLocal(): void {
    this.db.exec('PRAGMA foreign_keys = OFF')
    this.db.exec('BEGIN')
    try {
      this.setState('applying', '1')
      for (const t of [...SYNCED_TABLES].reverse()) this.db.prepare(`DELETE FROM ${t}`).run()
      this.db.exec('DELETE FROM sync_dirty; DELETE FROM sync_uploaded')
      this.setState('applying', null)
      this.setState('lastSeq', '0')
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON')
    }
  }

  /** Whether the space holds a live row (reads the server's log without writing anything here). */
  async remoteHas(tbl: string, id: string): Promise<boolean> {
    let since = 0
    for (;;) {
      const page = await this.transport.json<{ changes: { seq: number; tbl: string; id: string; data: string }[]; more: boolean }>(
        'GET',
        `${this.base()}/pull?since=${since}&limit=1000`
      )
      for (const c of page.changes) {
        if (c.tbl === tbl && c.id === id) return JSON.parse(await openText(this.k.enc, c.data, `${c.tbl}:${c.id}`)) !== null
      }
      if (!page.more || !page.changes.length) return false
      since = page.changes[page.changes.length - 1].seq
    }
  }

  pendingCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sync_dirty').get() as { n: number }).n
  }

  private cols(tbl: string): Set<string> {
    if (!this.columns.has(tbl)) this.columns.set(tbl, new Set((this.db.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[]).map((c) => c.name)))
    return this.columns.get(tbl)!
  }

  private rowOf(tbl: string, id: string): Record<string, unknown> | null {
    if (tbl === 'settings') return (this.db.prepare('SELECT key, value FROM settings WHERE key = ?').get(id) as Record<string, unknown> | undefined) ?? null
    return (this.db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(id) as Record<string, unknown> | undefined) ?? null
  }

  /** Sends local changes (and the files they need) to the server. */
  async push(): Promise<number> {
    const order = ['settings', ...SYNCED_TABLES]
    let pushed = 0
    for (;;) {
      const dirty = this.db
        .prepare(`SELECT tbl, id, changed_at, n FROM sync_dirty ORDER BY ${order.map((t, i) => `WHEN '${t}' THEN ${i}`).reduce((s, w) => s + ' ' + w, 'CASE tbl')} END, changed_at LIMIT ${PUSH_BATCH}`)
        .all() as { tbl: string; id: string; changed_at: number; n: number }[]
      if (!dirty.length) return pushed
      const changes: { tbl: string; id: string; ts: number; data: string }[] = []
      for (const d of dirty) {
        const row = this.rowOf(d.tbl, d.id)
        // Upload the file before the row that points to it, so other devices can always fetch it.
        const kind = BLOB_KIND[d.tbl]
        if (row && kind && !row.deleted_at) await this.uploadBlob(kind, d.id, row)
        changes.push({ tbl: d.tbl, id: d.id, ts: d.changed_at, data: await sealText(this.k.enc, JSON.stringify(row), `${d.tbl}:${d.id}`) })
      }
      await this.transport.json('POST', `${this.base()}/push`, { device: this.device, changes })
      const done = this.db.prepare('DELETE FROM sync_dirty WHERE tbl = ? AND id = ? AND n = ?')
      for (const d of dirty) done.run(d.tbl, d.id, d.n) // unless it changed again meanwhile
      pushed += dirty.length
    }
  }

  private async uploadBlob(kind: BlobKind, id: string, row: Record<string, unknown>): Promise<void> {
    if (this.db.prepare('SELECT 1 FROM sync_uploaded WHERE kind = ? AND id = ?').get(kind, id)) return
    const bytes = await this.blobs.read(kind, id, row)
    if (!bytes) return // not on this device (yet)
    await this.transport.putBytes(`${this.base()}/blob/${kind}-${id}`, await sealBytes(this.k.enc, bytes, `blob:${kind}:${id}`))
    this.db.prepare('INSERT OR IGNORE INTO sync_uploaded (kind, id) VALUES (?, ?)').run(kind, id)
  }

  /** Fetches and stores a file this device doesn't have yet. */
  async downloadBlob(kind: BlobKind, id: string, row: Record<string, unknown>): Promise<boolean> {
    const sealed = await this.transport.getBytes(`${this.base()}/blob/${kind}-${id}`)
    if (!sealed) return false
    await this.blobs.write(kind, id, row, await openBytes(this.k.enc, sealed, `blob:${kind}:${id}`))
    this.db.prepare('INSERT OR IGNORE INTO sync_uploaded (kind, id) VALUES (?, ?)').run(kind, id) // the server has it
    return true
  }

  /** Fetches other devices' changes and writes them in. */
  async pull(): Promise<{ pulled: number; touched: Map<string, Set<string>> }> {
    const touched = new Map<string, Set<string>>()
    let pulled = 0
    for (;;) {
      const since = Number(this.state('lastSeq') ?? 0)
      const page = await this.transport.json<{ changes: { seq: number; tbl: string; id: string; ts: number; data: string }[]; more: boolean }>(
        'GET',
        `${this.base()}/pull?since=${since}&limit=500`
      )
      if (!page.changes.length) return { pulled, touched }
      const opened: { tbl: string; id: string; ts: number; row: Record<string, unknown> | null }[] = []
      for (const c of page.changes) {
        if (c.tbl !== 'settings' && !(SYNCED_TABLES as readonly string[]).includes(c.tbl)) continue // from a newer version
        opened.push({ tbl: c.tbl, id: c.id, ts: c.ts, row: JSON.parse(await openText(this.k.enc, c.data, `${c.tbl}:${c.id}`)) as Record<string, unknown> | null })
      }
      this.apply(opened, touched)
      this.setState('lastSeq', String(page.changes[page.changes.length - 1].seq))
      pulled += opened.length
      if (!page.more) return { pulled, touched }
    }
  }

  /** Writes pulled rows in one transaction, without marking them as local changes. */
  private apply(changes: { tbl: string; id: string; ts: number; row: Record<string, unknown> | null }[], touched: Map<string, Set<string>>): void {
    // Rows can arrive before the row they belong to (a ticket line before its ticket); checks would refuse that.
    this.db.exec('PRAGMA foreign_keys = OFF')
    this.db.exec('BEGIN')
    try {
      this.setState('applying', '1')
      const pending = this.db.prepare('SELECT changed_at FROM sync_dirty WHERE tbl = ? AND id = ?')
      const clear = this.db.prepare('DELETE FROM sync_dirty WHERE tbl = ? AND id = ?')
      for (const c of changes) {
        const mine = pending.get(c.tbl, c.id) as { changed_at: number } | undefined
        if (mine && mine.changed_at > c.ts) continue // changed here more recently: ours goes up and wins
        if (mine) clear.run(c.tbl, c.id)
        if (c.tbl === 'settings') {
          if (c.row && SYNCED_SETTINGS.includes(c.id))
            this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(c.id, c.row.value as string)
        } else if (!c.row) {
          this.db.prepare(`DELETE FROM ${c.tbl} WHERE id = ?`).run(c.id)
        } else {
          const cols = Object.keys(c.row).filter((k) => this.cols(c.tbl).has(k)) // ignore columns this version doesn't have
          const updates = cols.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`)
          this.db
            .prepare(`INSERT INTO ${c.tbl} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`)
            .run(...cols.map((k) => c.row![k]))
        }
        if (!touched.has(c.tbl)) touched.set(c.tbl, new Set())
        touched.get(c.tbl)!.add(c.id)
      }
      this.setState('applying', null)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON')
    }
  }

  /** Files whose rows are here but whose contents aren't yet (to download in the background). */
  async missingBlobs(): Promise<{ kind: BlobKind; id: string; row: Record<string, unknown> }[]> {
    const out: { kind: BlobKind; id: string; row: Record<string, unknown> }[] = []
    for (const [tbl, kind] of Object.entries(BLOB_KIND) as [string, BlobKind][]) {
      for (const row of this.db.prepare(`SELECT * FROM ${tbl} WHERE deleted_at IS NULL`).all() as Record<string, unknown>[]) {
        if (!(await this.blobs.has(kind, row.id as string, row))) out.push({ kind, id: row.id as string, row })
      }
    }
    return out
  }

  async sync(): Promise<SyncResult> {
    // Pull first: if both sides changed a row, the newer change still wins (see apply), and we push less.
    const { pulled, touched } = await this.pull()
    const pushed = await this.push()
    return { pushed, pulled, touched }
  }
}
