import type { TroubleshootrStatus } from '../shared/api'
import type { DropKeys } from '../shared/drop-crypto'
import type { Db } from './db'
import { getSecret, putSecret } from './secrets'
import type { SyncService } from './sync/service'
import {
  collectReports,
  connectTroubleshootr,
  disconnectTroubleshootr,
  lastCheckAt,
  publishOpenTickets,
  troubleshootrStatus,
  type DropDeps
} from './services/troubleshootr'

/** How often to look for reports: every 20 s while Plannr's window is open (a technician often sends a scan and switches
 * straight to Plannr; owner, 2026-11-17: "nope" after looking 30 s later), every 5 min while it's in the tray. */
export function checkDue(now: number, lastRunAt: number, windowOpen: boolean): boolean {
  return now - lastRunAt >= (windowOpen ? 20_000 : 5 * 60_000)
}

/**
 * Collects Troubleshootr reports (see checkDue, and when the window gets focus), and keeps the open-tickets list
 * that Troubleshootr shows up to date. Only once connected (Settings → Sync & devices → Troubleshootr).
 */
export class TroubleshootrSync {
  private deps: DropDeps
  private running: Promise<TroubleshootrStatus> | null = null
  private error: string | null = null
  private recent: TroubleshootrStatus['recent'] = []
  private lastRunAt = 0

  constructor(
    db: Db,
    dataDir: string,
    sync: SyncService,
    deviceName: string,
    private onImported: () => void,
    private windowOpen: () => boolean = () => true
  ) {
    this.deps = {
      db,
      dataDir,
      deviceName,
      credentials: () => sync.credentials(),
      // The private key is encrypted with Windows, like the sync key.
      getKeys: () => getSecret<DropKeys>(db, 'troubleshootr.drop'),
      putKeys: (keys) => putSecret(db, 'troubleshootr.drop', keys)
    }
  }

  start(): void {
    setInterval(() => {
      if (this.deps.getKeys() && checkDue(Date.now(), this.lastRunAt, this.windowOpen())) void this.checkNow().catch(() => undefined)
    }, 5_000)
  }

  /** Window focus: check again unless it just did (the technician is likely back from a customer's PC). */
  poke(): void {
    if (Date.now() - this.lastRunAt > 5_000) void this.checkNow().catch(() => undefined)
  }

  async status(): Promise<TroubleshootrStatus> {
    const s = await troubleshootrStatus(this.deps)
    return { ...s, syncOn: !!(await this.deps.credentials()), lastCheckAt: lastCheckAt(this.deps.db), recent: this.recent, error: this.error }
  }

  async connect(): Promise<TroubleshootrStatus> {
    await connectTroubleshootr(this.deps)
    this.error = null
    return this.status()
  }

  async disconnect(): Promise<TroubleshootrStatus> {
    await disconnectTroubleshootr(this.deps)
    this.error = null
    return this.status()
  }

  async checkNow(): Promise<TroubleshootrStatus> {
    if (!this.deps.getKeys()) return this.status()
    this.running ??= (async () => {
      this.lastRunAt = Date.now()
      try {
        const { imported, errors, movedTo } = await collectReports(this.deps)
        if (movedTo) this.error = `Troubleshootr was connected on ${movedTo}; reports now go there.`
        else {
          await publishOpenTickets(this.deps)
          this.error = errors[0] ?? null
        }
        if (imported.length) {
          this.recent = [...imported.map((r) => ({ ...r, at: Date.now() })), ...this.recent].slice(0, 10)
          this.onImported()
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.running = null
      }
      return this.status()
    })()
    return this.running
  }
}
