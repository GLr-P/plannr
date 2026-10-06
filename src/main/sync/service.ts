import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Db } from '../db'
import { newId } from '../db'
import { getSetting, setSetting } from '../services/settings'
import { SyncEngine, type BlobKind, type BlobStore, type SyncTransport } from './engine'
import { joinLink, keyFingerprint, newSyncKey, parseJoinLink, validSyncKey, type LinkProfile } from '../../shared/sync-crypto'
import { afterPull } from './upkeep'
import type { SyncStatus } from '../../shared/api'

const REL_PATH = /^attachments[\\/][0-9a-f]{2}[\\/][0-9a-f-]{8,64}(\.[a-z0-9]{1,10})?$/
const VAULT_ID = /^[0-9a-f-]{8,64}$/

/** Attachments live at files.rel_path; vault files (already encrypted by the vault) at vault/<id>.bin. */
export function fileBlobs(dataDir: string): BlobStore {
  // Only paths of the shapes Plannr itself creates, so a row can never point outside the data folder.
  const pathOf = (kind: BlobKind, id: string, row: Record<string, unknown>): string | null => {
    if (kind === 'file') return typeof row.rel_path === 'string' && REL_PATH.test(row.rel_path) ? join(dataDir, row.rel_path) : null
    return VAULT_ID.test(id) ? join(dataDir, 'vault', `${id}.bin`) : null
  }
  return {
    read: async (kind, id, row) => {
      const p = pathOf(kind, id, row)
      return p && existsSync(p) ? new Uint8Array(readFileSync(p)) : null
    },
    write: async (kind, id, row, bytes) => {
      const p = pathOf(kind, id, row)
      if (!p) return
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(`${p}.part`, bytes) // never leave a half-written file under the real name
      renameSync(`${p}.part`, p)
    },
    has: async (kind, id, row) => {
      const p = pathOf(kind, id, row)
      return !p || existsSync(p) // a path we'd refuse counts as done, so it isn't retried forever
    }
  }
}

/** The sync server's address as typed or pasted: https only (plain http just for this computer, in tests). */
export function normalizeServer(input: string): string {
  let s = input.trim().replace(/#.*$/, '')
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  let url: URL
  try {
    url = new URL(s)
  } catch {
    throw new Error('That doesn’t look like a web address')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('The sync server address must start with https://')
  return url.origin
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** What a device provides: web requests, and somewhere safe to keep the sync key. */
export interface SyncPlatform {
  fetch: Fetcher
  getKey(): string | null
  putKey(key: string | null): void
}

export function httpTransport(server: string, token: () => string, fetcher: Fetcher): SyncTransport {
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    let res: Response
    try {
      res = await fetcher(server + path, { ...init, headers: { Authorization: `Bearer ${token()}`, ...(init.headers as Record<string, string>) } })
    } catch {
      throw new Error('Can’t reach the sync server. Check the internet connection.')
    }
    if (res.status === 401) throw new Error('This device isn’t allowed to sync with that space (wrong or old link). Join again with a link from another device.')
    return res
  }
  return {
    json: async (method, path, body) => {
      const res = await call(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const out = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(out.error ?? `The sync server answered ${res.status}`)
      return out as never
    },
    putBytes: async (path, bytes) => {
      const res = await call(path, { method: 'PUT', body: bytes as Uint8Array<ArrayBuffer> })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Upload failed (${res.status})`)
    },
    getBytes: async (path) => {
      const res = await call(path)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      return new Uint8Array(await res.arrayBuffer())
    }
  }
}

/**
 * Keeps this device in sync: a quick check every few seconds sends local changes, other devices' changes come in every
 * minute (and when the window gets focus). One run at a time; problems show in Settings and are retried.
 */
export class SyncService {
  private engine: SyncEngine | null = null
  private running: Promise<void> | null = null
  private again = false
  private error: string | null = null
  private lastPullAt = 0
  private retryAt = 0
  private fileStore: 'r2' | 'd1' | null = null
  private filesWaiting = 0
  private downloading = false

  constructor(
    private db: Db,
    private dataDir: string,
    /** Rows arrived from another device (after search/links are updated) */
    private onPulled: (touched: Map<string, Set<string>>) => void,
    private platform: SyncPlatform
  ) {}

  private stateGet(key: string): string | null {
    return (this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string | null } | undefined)?.value ?? null
  }
  private stateSet(key: string, value: string | null): void {
    this.db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  private deviceId(): string {
    let id = this.stateGet('device')
    if (!id) this.stateSet('device', (id = newId()))
    return id
  }

  private config(): { server: string; key: string } | null {
    const server = getSetting(this.db, 'sync.server')
    const key = this.platform.getKey()
    return typeof server === 'string' && key && validSyncKey(key) ? { server, key } : null
  }

  private async open(server: string, key: string): Promise<SyncEngine> {
    let token = ''
    const engine = new SyncEngine(this.db, httpTransport(server, () => token, this.platform.fetch), fileBlobs(this.dataDir), this.deviceId())
    token = (await engine.init(key)).token
    return engine
  }

  async start(): Promise<void> {
    const c = this.config()
    if (c) this.engine = await this.open(c.server, c.key)
    setInterval(() => this.tick(), 5_000)
    void this.run()
  }

  private tick(): void {
    if (!this.engine || this.running || Date.now() < this.retryAt) return
    if (this.engine.pendingCount() > 0 || Date.now() - this.lastPullAt > 60_000) void this.run()
  }

  /** The window got focus: catch up with the other devices. */
  poke(): void {
    if (this.engine && Date.now() - this.lastPullAt > 10_000 && Date.now() >= this.retryAt) void this.run()
  }

  /** Sync now; if one is running, queue exactly one more. Errors are kept for Settings, not thrown. */
  async run(): Promise<void> {
    const engine = this.engine
    if (!engine) return
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        if (!this.fileStore) this.fileStore = (await engine.hello()).files === 'r2' ? 'r2' : 'd1'
        do {
          this.again = false
          const result = await engine.sync()
          this.lastPullAt = Date.now()
          if (result.touched.size) {
            afterPull(this.db, result.touched)
            this.onPulled(result.touched)
          }
        } while (this.again)
        this.error = null
        this.stateSet('lastSyncAt', String(Date.now()))
        void this.downloadFiles(engine)
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        this.retryAt = Date.now() + 60_000
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  /** Fetches attachments and vault files other devices added, in the background. */
  private async downloadFiles(engine: SyncEngine): Promise<void> {
    if (this.downloading) return
    this.downloading = true
    try {
      const missing = await engine.missingBlobs()
      this.filesWaiting = missing.length
      for (const m of missing) {
        if (this.engine !== engine) return // turned off meanwhile
        await engine.downloadBlob(m.kind, m.id, m.row).catch(() => false) // tried again after the next sync
        this.filesWaiting--
      }
    } finally {
      this.downloading = false
    }
  }

  private save(server: string, key: string): void {
    this.platform.putKey(key)
    setSetting(this.db, 'sync.server', server)
  }

  private forgetProgress(): void {
    this.db.exec("DELETE FROM sync_state WHERE key IN ('lastSeq', 'lastSyncAt'); DELETE FROM sync_uploaded")
    this.fileStore = null
    this.error = null
    this.retryAt = 0
  }

  /** First device: creates a sync space on your server (needs its setup code) and sends everything up. */
  async setup(serverInput: string, setupCode: string): Promise<SyncStatus> {
    if (this.engine) throw new Error('Sync is already on')
    const server = normalizeServer(serverInput)
    const key = newSyncKey()
    const engine = await this.open(server, key)
    await engine.createSpace(setupCode.trim())
    this.forgetProgress()
    this.save(server, key)
    engine.markAllDirty()
    this.engine = engine
    await this.run()
    return this.status()
  }

  /** Another device: joins with the link (or QR) from a device that already syncs. */
  async join(link: string): Promise<SyncStatus> {
    if (this.engine) throw new Error('Sync is already on. Turn it off first to join a different space.')
    const parsed = parseJoinLink(link)
    if (!parsed) throw new Error('That isn’t a Plannr join link. Copy it from Settings → Sync & devices on a device that already syncs.')
    const server = normalizeServer(parsed.serverUrl)
    const engine = await this.open(server, parsed.key)
    await engine.hello() // the link works
    this.forgetProgress()
    if (engine.isFresh()) {
      engine.wipeLocal() // just Plannr's starter templates: take the space's instead of adding a second set
    } else {
      const hasVault = Boolean(this.db.prepare("SELECT 1 FROM vault_keys WHERE id = 'passcode'").get())
      if (hasVault && (await engine.remoteHas('vault_keys', 'passcode')))
        throw new Error(
          'This PC and the other device each have their own vault, and two vaults can’t be combined. Move what’s in this PC’s vault to the other device first, then delete this vault (Vault → Reset) and join again.'
        )
      engine.markAllDirty(1) // combine: this PC's things go up too
    }
    this.save(server, parsed.key)
    this.engine = engine
    await this.run()
    return this.status()
  }

  /** The link that adds another device (shown as a QR code for the phone); it names the profile it belongs to. */
  link(profile?: LinkProfile | null): string | null {
    const c = this.config()
    return c ? joinLink(c.server, c.key, profile) : null
  }

  /** A short fingerprint of this space's key, so a phone can tell which of its profiles a join link is for. */
  async keyId(): Promise<string | null> {
    const c = this.config()
    return c ? keyFingerprint(c.key) : null
  }

  /** Stops syncing on this device. Everything stays here, and on the other devices. */
  disconnect(): SyncStatus {
    this.engine = null
    this.platform.putKey(null)
    setSetting(this.db, 'sync.server', null)
    this.forgetProgress()
    return this.status()
  }

  async syncNow(): Promise<SyncStatus> {
    this.retryAt = 0
    await this.run()
    return this.status()
  }

  status(): SyncStatus {
    const last = this.stateGet('lastSyncAt')
    return {
      enabled: Boolean(this.engine),
      server: this.engine ? ((getSetting(this.db, 'sync.server') as string | null) ?? null) : null,
      syncing: Boolean(this.running),
      lastSyncAt: last ? Number(last) : null,
      error: this.engine ? this.error : null,
      pending: this.engine ? this.engine.pendingCount() : 0,
      filesWaiting: this.engine ? this.filesWaiting : 0,
      fileStore: this.engine ? this.fileStore : null
    }
  }
}
