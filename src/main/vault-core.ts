import type { Db } from './db'
import * as vault from './services/vault'
import { getSetting, setSetting } from './services/settings'
import type { VaultFile, VaultItem, VaultItemKind, VaultItemPatch, VaultItemSummary, VaultResult, VaultStatus } from '../shared/api'

const FREE_ATTEMPTS = 5

/**
 * The unlocked vault lives only here (the PC's main process, or the phone's database worker): the screens never see
 * the key. Locks automatically after inactivity; the apps also lock it on sleep, screen lock, close-to-tray…
 */
export class VaultCore {
  private dek: Buffer | null = null
  private lastActive = 0
  private failures = 0
  private retryAt = 0

  constructor(
    protected db: Db,
    protected dataDir: string,
    private onLocked: () => void
  ) {
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
    this.afterLock()
    this.onLocked()
  }

  /** Clean-up a platform does when the vault locks */
  protected afterLock(): void {}

  touch(): void {
    if (this.dek) this.lastActive = Date.now()
  }

  protected key(): Buffer {
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


  /** A field's value (for copying it to the clipboard) */
  fieldValue(id: string, field: string): string {
    return this.get(id)?.fields[field] ?? ''
  }
}
