/*
 * The phone web app's "main process": a Web Worker that owns the database (SQLite in the browser's private storage)
 * and runs the same services as the PC app. The page talks to it with messages; see rpc.ts.
 */
import './buffer-global'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { DatabaseSync, useSqlite } from './shims/sqlite'
import { useFileStore, readFileSync } from './shims/fs'
import { migrate, type Db } from '../main/db'
import { createCoreApi } from '../main/api-core'
import { VaultCore } from '../main/vault-core'
import { SyncService } from '../main/sync/service'
import { loadDisplayPrefs } from '../main/display'
import { ensureSearchIndex } from '../main/services/reindex'
import { getSetting, setSetting } from '../main/services/settings'
import { resolveFilePath } from '../main/services/files'
import { ticketPrintHtml } from '../main/services/print'
import { transactionsCsv } from '../main/services/money'
import { holidaysStale, refreshHolidays } from '../main/services/holidays'
import type { PlannrApi, UpdateStatus } from '../shared/api'
import type { WorkerReply, WorkerRequest } from './rpc'

declare const __APP_VERSION__: string
const DATA = '/data'

const post = (msg: WorkerReply): void => (self as unknown as Worker).postMessage(msg)
const emit = (event: string): void => post({ event })

/** Holiday feeds come through the sync service (the browser can't read Google's calendar directly). */
const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(`/api/ics?u=${encodeURIComponent(url)}`)
  if (!res.ok) throw new Error(`Couldn’t download holidays (${res.status})`)
  return res.text()
}

async function openStorage(): Promise<{ db: Db; persistent: boolean }> {
  const sqlite3 = await sqlite3InitModule()
  let pool: Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>> | null = null
  const hasStorage = typeof navigator.storage?.getDirectory === 'function'
  // Just after a reload the previous page may still hold the storage for a moment: try again for a few seconds.
  for (let attempt = 0; hasStorage && !pool; attempt++) {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'plannr', initialCapacity: 12 })
    } catch (err) {
      if (attempt >= 25) throw new Error(`Plannr couldn’t open its storage. If it’s open in another tab, close that one and reload. (${String(err)})`)
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  useSqlite(sqlite3, pool)
  useFileStore(new DatabaseSync(pool ? '/files.db' : ':memory:'))
  const db = new DatabaseSync(pool ? '/plannr.db' : ':memory:') as unknown as Db
  db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  migrate(db)
  return { db, persistent: Boolean(pool) }
}

function createWebApi(db: Db): { api: PlannrApi; web: WebExtras; sync: SyncService } {
  const core = createCoreApi(db, DATA, { moneyChanged: () => undefined, calendarChanged: () => undefined, fetchText })
  const vault = new VaultCore(db, DATA, () => emit('vault-locked'))
  const sync = new SyncService(
    db,
    DATA,
    (touched) => {
      emit('data-changed')
      if (touched.has('events')) emit('calendar-changed')
    },
    {
      fetch: (url, init) => fetch(url, init),
      // Kept in this device's private storage (the phone's own encryption protects it at rest).
      getKey: () => (getSetting(db, 'sync.key') as string | null) ?? null,
      putKey: (key) => setSetting(db, 'sync.key', key)
    }
  )
  const offline = (): never => {
    throw new Error('That works in Plannr on your PC.')
  }
  const updates: UpdateStatus = {
    state: 'idle',
    current: __APP_VERSION__,
    latest: null,
    notesUrl: null,
    progress: 0,
    error: null,
    canInstall: false,
    checkedAt: null
  }
  const api: PlannrApi = {
    ...core,
    files: { ...core.files, open: async () => undefined /* the page opens it */ },
    money: { ...core.money, exportCsv: async () => false /* the page downloads it */ },
    vault: {
      status: async () => vault.status(),
      setup: async (passcode) => vault.setup(passcode),
      unlock: async (passcode) => vault.unlock(passcode),
      recover: async (key, passcode) => vault.recover(key, passcode),
      changePasscode: async (current, next) => vault.changePasscode(current, next),
      lock: async () => vault.lock(),
      touch: async () => vault.touch(),
      setAutoLock: async (minutes) => vault.setAutoLock(minutes),
      list: async () => vault.list(),
      get: async (id) => vault.get(id),
      create: async (kind) => vault.create(kind),
      update: async (id, patch) => vault.update(id, patch),
      remove: async (id) => vault.remove(id),
      copy: async () => undefined, // the page copies (fieldValue)
      addFile: async (itemId, file) => vault.addFile(itemId, file),
      files: async (itemId) => vault.files(itemId),
      removeFile: async (fileId) => vault.removeFile(fileId),
      openFile: async () => undefined,
      exportFile: async () => false,
      saveRecoveryKey: async () => false
    },
    google: {
      status: async () => ({ configured: false, connected: false, email: null, lastSyncAt: null, error: null, calendars: [], selected: [] }),
      importClient: offline,
      connect: offline,
      disconnect: offline,
      syncNow: offline,
      setCalendars: offline,
      events: async () => []
    },
    zoho: {
      status: async () => ({ configured: false, connected: false, email: null, region: null, error: null }),
      configure: offline,
      connect: offline,
      disconnect: offline,
      search: async () => [],
      message: offline
    },
    quickbooks: {
      status: async () => ({ configured: false, connected: false, companyName: null, config: null, lastSyncAt: null, error: null, problems: [] }),
      configureKey: offline,
      connect: offline,
      disconnect: offline,
      options: offline,
      createItem: offline,
      setConfig: offline,
      syncNow: offline
    },
    backup: {
      status: async () => ({ dir: '', lastAt: null, error: null, backups: [] }),
      runNow: offline,
      chooseFolder: offline,
      openFolder: offline,
      restore: offline
    },
    print: { ticket: async () => undefined /* the page prints (printHtml) */ },
    data: { exportAll: async () => null, importContacts: async () => null, openFolder: async () => undefined },
    sync: {
      status: async () => sync.status(),
      setup: async (server, code) => sync.setup(server, code),
      join: async (link) => {
        const status = await sync.join(link)
        emit('data-changed')
        return status
      },
      link: async () => sync.link(),
      syncNow: async () => sync.syncNow(),
      disconnect: async () => sync.disconnect()
    },
    updates: { status: async () => updates, check: async () => updates, install: async () => updates },
    profiles: {
      list: async () => ({ active: 'main', profiles: [{ id: 'main', name: 'Main', color: '#3b82f6' }] }),
      add: offline,
      update: offline,
      remove: offline,
      switch: async () => undefined,
      copyNote: offline
    },
    app: {
      info: async () => ({ version: __APP_VERSION__, dataDir: DATA, tests: false, web: true }),
      openDataFolder: async () => undefined,
      setTheme: async () => undefined,
      openCapture: async () => undefined,
      closeCapture: async () => undefined,
      captureSaved: async () => emit('data-changed'),
      setCaptureShortcut: async () => false,
      getCaptureShortcut: async () => 'off',
      setZoom: async (factor) => setSetting(db, 'zoom', Math.max(0.8, Math.min(1.4, Number(factor) || 1))),
      getZoom: async () => Number(getSetting(db, 'zoom')) || 1,
      getOpenAtLogin: async () => false,
      setOpenAtLogin: async () => undefined
    }
  }
  const web: WebExtras = {
    /** Bytes for /plannr-file/<id> and /plannr-vault/<id>/<name> (shown in <img>, opened in a new tab…) */
    readFile: async (path: string) => {
      const m = /^\/plannr-(file|vault)\/([0-9a-f-]{36})/.exec(path)
      if (!m) return null
      if (m[1] === 'vault') {
        const file = vault.readFile(m[2])
        return file ? { data: new Uint8Array(file.data), mime: file.mime, name: file.name } : null
      }
      const file = resolveFilePath(db, DATA, m[2])
      if (!file) return null
      try {
        const row = db.prepare('SELECT name FROM files WHERE id = ?').get(m[2]) as { name: string }
        return { data: new Uint8Array(readFileSync(file.path) as Uint8Array), mime: file.mime, name: row.name }
      } catch {
        return null // not downloaded yet
      }
    },
    printHtml: async (id: string, kind: Parameters<PlannrApi['print']['ticket']>[1]) => ticketPrintHtml(db, DATA, id, kind),
    csv: async (from: string, to: string) => transactionsCsv(db, from, to),
    fieldValue: async (id: string, field: string) => vault.fieldValue(id, field),
    /** The page became visible again: catch up */
    poke: async () => sync.poke()
  }
  return { api, web, sync }
}

export interface WebExtras {
  readFile(path: string): Promise<{ data: Uint8Array; mime: string; name: string } | null>
  printHtml(id: string, kind: Parameters<PlannrApi['print']['ticket']>[1]): Promise<string>
  csv(from: string, to: string): Promise<string>
  fieldValue(id: string, field: string): Promise<string>
  poke(): Promise<void>
}

// ---------- start-up and the message loop ----------

const ready = (async () => {
  const { db, persistent } = await openStorage()
  if (getSetting(db, 'onboarded') === null) setSetting(db, 'onboarded', true) // the tour is for the PC
  loadDisplayPrefs(db)
  ensureSearchIndex(db)
  const built = createWebApi(db)
  await built.sync.start() // loads the saved sync key, so boot knows whether this phone is connected
  if (holidaysStale(db)) void refreshHolidays(db, fetchText).catch(() => undefined)
  return { ...built, persistent }
})()

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, ns, method, args } = e.data
  try {
    const { api, web, persistent } = await ready
    let value: unknown
    if (ns === '_web' && method === 'boot') value = { persistent, joined: (await api.sync.status()).enabled }
    else if (ns === '_web') value = await (web as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](...args)
    else value = await (api as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[ns][method](...args)
    const transfer =
      value && typeof value === 'object' && 'data' in value && (value as { data: unknown }).data instanceof Uint8Array
        ? [(value as { data: Uint8Array }).data.buffer]
        : []
    ;(self as unknown as Worker).postMessage({ id, ok: true, value } satisfies WorkerReply, transfer as Transferable[])
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
