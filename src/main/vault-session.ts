import { app, clipboard, shell } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import * as vault from './services/vault'
import { getSetting, setSetting } from './services/settings'
import type { VaultFile, VaultItem, VaultItemKind, VaultItemPatch, VaultItemSummary, VaultResult, VaultStatus } from '../shared/api'

const FREE_ATTEMPTS = 5
const CLIPBOARD_CLEAR_MS = 30_000

/**
 * The unlocked vault lives only here, in the main process's memory: the renderer never sees the key.
 * Locks automatically after inactivity, and the app also locks it on sleep, screen lock and close-to-tray.
 */
export class VaultSession {
  private dek: Buffer | null = null
  private lastActive = 0
  private failures = 0
  private retryAt = 0
  private copied: string | null = null

  /** Decrypted copies opened in other apps live here, and are deleted when the vault locks (and on start/quit). */
  readonly tempDir = join(app.getPath('temp'), 'plannr-vault-open')

  constructor(
    private db: Db,
    private dataDir: string,
    private onLocked: () => void
  ) {
    this.cleanTemp()
    setInterval(() => {
      if (this.dek && Date.now() - this.lastActive > this.autoLockMinutes() * 60_000) this.lock()
    }, 15_000).unref?.()
  }

  autoLockMinutes(): number {
    const m = getSetting(this.db, 'vaultAutoLockMinutes')
    return typeof m === 'number' && m > 0 ? m : 5
  }

  setAutoLock(minutes: number): void {
    setSetting(this.db, 'vaultAutoLockMinutes', Math.min(Math.max(Math.round(minutes), 1), 240))
  }

  status(): VaultStatus {
    return {
      setUp: vault.isVaultSetUp(this.db),
      unlocked: this.dek !== null,
      autoLockMinutes: this.autoLockMinutes(),
      retryAfterMs: Math.max(0, this.retryAt - Date.now())
    }
  }

  private openWith(dek: Buffer): void {
    this.dek = dek
    this.failures = 0
    this.retryAt = 0
    this.lastActive = Date.now()
  }

  /** After 5 wrong tries: wait 30 s, then 1 min, 2 min… up to 15 min between attempts. */
  private throttled(): VaultResult | null {
    const wait = this.retryAt - Date.now()
    return wait > 0 ? { ok: false, error: 'Too many wrong attempts. Please wait a moment.', retryAfterMs: wait } : null
  }

  private failed(message: string): VaultResult {
    this.failures++
    if (this.failures >= FREE_ATTEMPTS) {
      const wait = Math.min(30_000 * 2 ** (this.failures - FREE_ATTEMPTS), 15 * 60_000)
      this.retryAt = Date.now() + wait
      return { ok: false, error: message, retryAfterMs: wait }
    }
    return { ok: false, error: message }
  }

  async setup(passcode: string): Promise<{ recoveryKey: string }> {
    const { dek, recoveryKey } = await vault.setupVault(this.db, passcode)
    this.openWith(dek)
    return { recoveryKey }
  }

  async unlock(passcode: string): Promise<VaultResult> {
    const wait = this.throttled()
    if (wait) return wait
    const dek = await vault.unlockWithPasscode(this.db, passcode)
    if (!dek) return this.failed('That passcode isn’t right.')
    this.openWith(dek)
    return { ok: true }
  }

  async recover(recoveryKey: string, newPasscode: string): Promise<VaultResult> {
    const wait = this.throttled()
    if (wait) return wait
    const problem = vault.validatePasscode(newPasscode)
    if (problem) return { ok: false, error: problem }
    const dek = await vault.unlockWithRecoveryKey(this.db, recoveryKey)
    if (!dek) return this.failed('That recovery key isn’t right.')
    await vault.setPasscode(this.db, dek, newPasscode)
    this.openWith(dek)
    return { ok: true }
  }

  async changePasscode(current: string, next: string): Promise<VaultResult> {
    const wait = this.throttled()
    if (wait) return wait
    const problem = vault.validatePasscode(next)
    if (problem) return { ok: false, error: problem }
    const dek = await vault.unlockWithPasscode(this.db, current)
    if (!dek) return this.failed('Your current passcode isn’t right.')
    await vault.setPasscode(this.db, dek, next)
    this.openWith(dek)
    return { ok: true }
  }

  lock(): void {
    if (!this.dek) return
    this.dek.fill(0) // wipe the key from memory
    this.dek = null
    this.cleanTemp()
    this.onLocked()
  }

  touch(): void {
    if (this.dek) this.lastActive = Date.now()
  }

  private key(): Buffer {
    if (!this.dek) throw new Error('The vault is locked')
    this.lastActive = Date.now()
    return this.dek
  }

  list = (): VaultItemSummary[] => vault.listItems(this.db, this.key())
  get = (id: string): VaultItem | null => vault.getItem(this.db, this.key(), id)
  create = (kind: VaultItemKind): VaultItem => vault.createItem(this.db, this.key(), kind)
  update = (id: string, patch: VaultItemPatch): VaultItem => vault.updateItem(this.db, this.key(), id, patch)
  remove = (id: string): void => {
    this.key()
    vault.removeItem(this.db, this.dataDir, id)
  }

  addFile = (itemId: string, file: { name: string; mime: string; data: Uint8Array; inline?: boolean }): VaultFile =>
    vault.addFile(this.db, this.dataDir, this.key(), itemId, file)
  files = (itemId: string): VaultFile[] => vault.listFiles(this.db, this.key(), itemId)
  removeFile = (fileId: string): void => {
    this.key()
    vault.removeFile(this.db, this.dataDir, fileId)
  }
  /** Decrypted file contents (null when locked or unknown) — used by the plannr-vault:// protocol and exports. */
  readFile(fileId: string): { name: string; mime: string; data: Buffer } | null {
    if (!this.dek) return null
    return vault.readFile(this.db, this.dataDir, this.dek, fileId)
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
    const value = this.get(id)?.fields[field] ?? ''
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
