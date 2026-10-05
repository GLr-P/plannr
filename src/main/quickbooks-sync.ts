import type { Db } from './db'
import { qboApi, qboConnected } from './quickbooks-client'
import { configComplete, getConfig, syncQuickBooks } from './services/quickbooks'

/** Sends changes to QuickBooks every 15 minutes and shortly after money/customer changes; one run at a time. */
export class QuickBooksSync {
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private db: Db) {}

  private ready(): boolean {
    return qboConnected(this.db) && configComplete(getConfig(this.db))
  }

  start(): void {
    setInterval(() => this.schedule(0), 15 * 60_000)
    this.schedule(10_000)
  }

  schedule(delayMs = 8_000): void {
    if (!this.ready()) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.run().catch(() => undefined), delayMs)
  }

  async run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await syncQuickBooks(this.db, qboApi(this.db))
        } while (this.again)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }
}
