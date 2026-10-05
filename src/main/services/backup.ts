import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import type { BackupInfo } from '../../shared/api'
import { getSetting, setSetting } from './settings'

/*
 * Backups
 * -------
 * <backupDir>/snapshots/plannr-YYYY-MM-DD_HHMMSS.db  — full database copies (newest KEEP kept), integrity-checked
 * <backupDir>/files/{attachments,vault}/…             — mirror of stored files; they never change once written,
 *                                                       so each is copied once and the mirror serves every snapshot
 * The vault stays encrypted inside backups (they hold the same ciphertext as the live database).
 */

export const KEEP = 30
const FILE_DIRS = ['attachments', 'vault']
const SNAPSHOT_RE = /^plannr-(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})(-before-restore(?:-\d+)?)?\.db$/

const pad = (n: number): string => String(n).padStart(2, '0')
const stamp = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** Copies files that aren't in `to` yet (recursively). Returns how many were copied. */
function mirror(from: string, to: string): number {
  if (!existsSync(from)) return 0
  mkdirSync(to, { recursive: true })
  let copied = 0
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) copied += mirror(src, dst)
    else if (!existsSync(dst)) {
      copyFileSync(src, dst)
      copied++
    }
  }
  return copied
}

export function listBackups(backupDir: string): BackupInfo[] {
  const dir = join(backupDir, 'snapshots')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((file) => {
      const m = SNAPSHOT_RE.exec(file)
      if (!m) return null
      const [, date, hh, mm, ss] = m
      const [y, mo, d] = date.split('-').map(Number)
      return { file, createdAt: new Date(y, mo - 1, d, Number(hh), Number(mm), Number(ss)).getTime(), size: statSync(join(dir, file)).size }
    })
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Takes a snapshot, checks it, mirrors new files, and prunes old snapshots. Throws on failure (and records it). */
export async function runBackup(db: Db, dataDir: string, backupDir: string, now = new Date()): Promise<BackupInfo> {
  try {
    const snapDir = join(backupDir, 'snapshots')
    mkdirSync(snapDir, { recursive: true })
    const file = `plannr-${stamp(now)}.db`
    const path = join(snapDir, file)
    await sqliteBackup(db, path)

    // Never keep a damaged copy.
    const check = new DatabaseSync(path, { readOnly: true })
    const { integrity_check } = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    check.close()
    if (integrity_check !== 'ok') {
      rmSync(path, { force: true })
      throw new Error(`The backup copy failed its check (${integrity_check})`)
    }

    for (const d of FILE_DIRS) mirror(join(dataDir, d), join(backupDir, 'files', d))
    for (const old of listBackups(backupDir).slice(KEEP)) rmSync(join(snapDir, old.file), { force: true })

    setSetting(db, 'lastBackupAt', now.getTime())
    setSetting(db, 'backupError', null)
    return listBackups(backupDir).find((b) => b.file === file)!
  } catch (err) {
    setSetting(db, 'backupError', err instanceof Error ? err.message : String(err))
    throw err
  }
}

/** True when the last successful backup is older than ~a day (or there's none). */
export function backupDue(db: Db, now = Date.now()): boolean {
  const last = getSetting(db, 'lastBackupAt')
  return typeof last !== 'number' || now - last > 20 * 60 * 60 * 1000
}

/**
 * Puts a snapshot back. The live database must already be CLOSED.
 * The current database is saved as a "before-restore" snapshot first, so a restore can be undone.
 */
export function restoreSnapshot(dataDir: string, backupDir: string, file: string, now = new Date()): void {
  if (!SNAPSHOT_RE.test(file)) throw new Error('Not a Plannr backup file')
  const snapshot = join(backupDir, 'snapshots', file)
  if (!existsSync(snapshot)) throw new Error('Backup not found')
  const live = join(dataDir, 'plannr.db')
  const snapDir = join(backupDir, 'snapshots')
  // Safety copy of what's there now (listed like a snapshot so it can be restored). Never overwrites an existing
  // backup, in particular the one being restored if it was taken in the same second.
  if (existsSync(live)) {
    let name = `plannr-${stamp(now)}-before-restore.db`
    for (let i = 2; existsSync(join(snapDir, name)); i++) name = `plannr-${stamp(now)}-before-restore-${i}.db`
    copyFileSync(live, join(snapDir, name))
  }
  for (const ext of ['-wal', '-shm']) rmSync(live + ext, { force: true })
  copyFileSync(snapshot, live)
  for (const d of FILE_DIRS) mirror(join(backupDir, 'files', d), join(dataDir, d)) // bring back any files it refers to
}
