import { app, clipboard, shell } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import { VaultCore } from './vault-core'

const CLIPBOARD_CLEAR_MS = 30_000

/** The vault on the PC: adds opening files in their Windows app and copying with clipboard clean-up. */
export class VaultSession extends VaultCore {
  private copied: string | null = null

  /** Decrypted copies opened in other apps live here, and are deleted when the vault locks (and on start/quit). */
  readonly tempDir = join(app.getPath('temp'), 'plannr-vault-open')

  constructor(db: Db, dataDir: string, onLocked: () => void) {
    super(db, dataDir, onLocked)
    this.cleanTemp()
  }

  protected override afterLock(): void {
    this.cleanTemp()
  }
  /** Writes a temporary decrypted copy and opens it in its Windows app (e.g. a PDF reader for printing). */
  async openFile(fileId: string): Promise<void> {
    this.key()
    const file = this.readFile(fileId)
    if (!file) throw new Error('File not found')
    const dir = join(this.tempDir, randomUUID())
    mkdirSync(dir, { recursive: true })
    const safeName = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'file' // no characters Windows forbids in file names
    const path = join(dir, safeName)
    writeFileSync(path, file.data)
    await shell.openPath(path)
  }

  cleanTemp(): void {
    try {
      rmSync(this.tempDir, { recursive: true, force: true })
    } catch {
      // a file may still be open in another app; it's removed next time
    }
  }

  /** Copies a field and clears the clipboard after 30 s — unless something else was copied since. */
  async copy(id: string, field: string): Promise<void> {
    const value = this.fieldValue(id, field)
    await clipboard.writeText(value)
    this.copied = value
    setTimeout(() => void this.clearIfStill(value), CLIPBOARD_CLEAR_MS)
  }

  private async clearIfStill(value: string): Promise<void> {
    if (value && (await clipboard.readText()) === value) await clipboard.writeText('')
    if (value === this.copied) this.copied = null
  }

  /** On quit: if a vault value was copied in the last 30 s, clear the clipboard now (synchronously). */
  clearClipboardNow(): void {
    if (this.copied) clipboard.clear()
    this.copied = null
  }
}
