import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import { backupDue, KEEP, listBackups, restoreSnapshot, runBackup } from '../../src/main/services/backup'
import { getSetting } from '../../src/main/services/settings'

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `plannr-${name}-`))

describe('backups', () => {
  it('snapshots the database, mirrors files once, and lists newest first', async () => {
    const dataDir = temp('data')
    const backupDir = temp('backup')
    const db = openDb(join(dataDir, 'plannr.db'))
    notes.createNote(db, { title: 'Keep me' })
    mkdirSync(join(dataDir, 'attachments', 'ab'), { recursive: true })
    writeFileSync(join(dataDir, 'attachments', 'ab', 'photo.png'), 'PNGDATA')

    expect(backupDue(db)).toBe(true)
    const first = await runBackup(db, dataDir, backupDir, new Date(2026, 9, 4, 9, 0, 0))
    expect(first.file).toBe('plannr-2026-10-04_090000.db')
    expect(backupDue(db)).toBe(false)
    expect(readFileSync(join(backupDir, 'files', 'attachments', 'ab', 'photo.png'), 'utf8')).toBe('PNGDATA')
    await runBackup(db, dataDir, backupDir, new Date(2026, 9, 5, 9, 0, 0))
    expect(listBackups(backupDir).map((b) => b.file)).toEqual(['plannr-2026-10-05_090000.db', 'plannr-2026-10-04_090000.db'])

    // The snapshot is a real, complete database
    const snap = openDb(join(backupDir, 'snapshots', first.file))
    expect(notes.listNotes(snap).map((n) => n.title)).toEqual(['Keep me'])
    snap.close()
    db.close()
  })

  it(`keeps only the newest ${KEEP} snapshots`, async () => {
    const dataDir = temp('data')
    const backupDir = temp('backup')
    const db = openDb(join(dataDir, 'plannr.db'))
    for (let i = 0; i < KEEP + 3; i++) await runBackup(db, dataDir, backupDir, new Date(2026, 0, 1 + i, 9))
    const list = listBackups(backupDir)
    expect(list).toHaveLength(KEEP)
    expect(list.at(-1)!.file).toBe('plannr-2026-01-04_090000.db') // the 3 oldest were removed
    db.close()
  })

  it('restores a snapshot (saving the current data first) and brings back missing files', async () => {
    const dataDir = temp('data')
    const backupDir = temp('backup')
    let db = openDb(join(dataDir, 'plannr.db'))
    notes.createNote(db, { title: 'Original' })
    mkdirSync(join(dataDir, 'vault'), { recursive: true })
    writeFileSync(join(dataDir, 'vault', 'abc.bin'), 'CIPHERTEXT')
    const snap = await runBackup(db, dataDir, backupDir, new Date(2026, 9, 4, 9))

    // Later: the note is deleted forever and a vault file is lost
    notes.destroyNote(db, notes.listNotes(db)[0].id)
    notes.createNote(db, { title: 'Newer' })
    db.close()
    rmSync(join(dataDir, 'vault', 'abc.bin'))

    restoreSnapshot(dataDir, backupDir, snap.file, new Date(2026, 9, 6, 12))
    db = openDb(join(dataDir, 'plannr.db'))
    expect(notes.listNotes(db).map((n) => n.title)).toEqual(['Original'])
    expect(existsSync(join(dataDir, 'vault', 'abc.bin'))).toBe(true)
    // What was there before the restore was kept, so the restore itself can be undone
    const safety = listBackups(backupDir).find((b) => b.file === 'plannr-2026-10-06_120000-before-restore.db')!
    const before = openDb(join(backupDir, 'snapshots', safety.file))
    expect(notes.listNotes(before).map((n) => n.title)).toEqual(['Newer'])
    before.close()
    db.close()
  })

  it('restoring right after backing up (same second) restores the backup, not the safety copy', async () => {
    const dataDir = temp('data')
    const backupDir = temp('backup')
    let db = openDb(join(dataDir, 'plannr.db'))
    notes.createNote(db, { title: 'In backup' })
    const at = new Date(2026, 9, 4, 9, 0, 0)
    const snap = await runBackup(db, dataDir, backupDir, at)
    notes.destroyNote(db, notes.listNotes(db)[0].id)
    db.close()
    restoreSnapshot(dataDir, backupDir, snap.file, at) // same timestamp
    restoreSnapshot(dataDir, backupDir, snap.file, at) // and again: the second safety copy gets its own name
    db = openDb(join(dataDir, 'plannr.db'))
    expect(notes.listNotes(db).map((n) => n.title)).toEqual(['In backup'])
    expect(listBackups(backupDir).map((b) => b.file).sort()).toEqual([
      'plannr-2026-10-04_090000-before-restore-2.db',
      'plannr-2026-10-04_090000-before-restore.db',
      'plannr-2026-10-04_090000.db'
    ])
    db.close()
  })

  it('refuses files that are not Plannr backups and records failures', async () => {
    const dataDir = temp('data')
    const backupDir = temp('backup')
    expect(() => restoreSnapshot(dataDir, backupDir, '../../plannr.db')).toThrow(/Not a Plannr backup/)
    expect(() => restoreSnapshot(dataDir, backupDir, 'plannr-2026-01-01_000000.db')).toThrow(/not found/)
    const db = openDb(join(dataDir, 'plannr.db'))
    writeFileSync(join(backupDir, 'not-a-folder'), 'x')
    await expect(runBackup(db, dataDir, join(backupDir, 'not-a-folder'))).rejects.toThrow()
    expect(getSetting(db, 'backupError')).toBeTruthy()
    db.close()
  })
})
