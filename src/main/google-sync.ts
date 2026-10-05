import type { Db } from './db'
import { googleApi, isConnected } from './google-client'
import { syncGoogle } from './services/google'

/** Runs Google Calendar sync every few minutes and shortly after local calendar changes; never two at once. */
export class GoogleSync {
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private db: Db,
    private onSynced: () => void
  ) {}

  start(): void {
    setInterval(() => this.schedule(0), 5 * 60_000)
    this.schedule(3_000)
  }

  /** Sync soon (debounced), e.g. after an event was edited. */
  schedule(delayMs = 4_000): void {
    if (!isConnected(this.db)) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.run().catch(() => undefined), delayMs)
  }

  /** Sync now; if one is already running, queue exactly one more run after it. Errors are stored for Settings. */
  async run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await syncGoogle(this.db, googleApi(this.db), { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
          this.onSynced()
        } while (this.again)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }
}
