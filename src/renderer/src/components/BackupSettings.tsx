import { useEffect, useState } from 'react'
import { DatabaseBackup, FolderOpen, FolderSync, RotateCcw } from 'lucide-react'
import type { BackupInfo, BackupStatus } from '../../../shared/api'
import { api } from '../api'
import { relativeTime } from '../lib/format'

const size = (b: number): string => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Settings: automatic daily backups, where they go, and restoring one. */
export function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    void api.backup.status().then(setStatus)
  }, [])

  const run = async (p: Promise<BackupStatus>): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await p)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  const shown = showAll ? status.backups : status.backups.slice(0, 5)

  return (
    <section className="setting backup-setting">
      <div className="backup-main">
        <h3>Backups</h3>
        <p className="muted">
          Plannr backs up everything automatically once a day and keeps the last 30. Vault items stay encrypted in backups. For extra safety,
          pick a folder on a USB drive or in OneDrive.
        </p>
        <p className={`small backup-status ${status.error ? 'error-text' : 'muted'}`} aria-live="polite">
          {busy
            ? 'Backing up…'
            : status.error
              ? `Last backup failed: ${status.error}`
              : status.lastAt
                ? `Last backup ${relativeTime(status.lastAt).toLowerCase()}`
                : 'No backup yet — the first one runs shortly after Plannr starts.'}
        </p>
        <code className="path">{status.dir}</code>
        <div className="backup-actions">
          <button type="button" className="btn sm primary" disabled={busy} onClick={() => void run(api.backup.runNow())}>
            <DatabaseBackup /> Back up now
          </button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void run(api.backup.chooseFolder())}>
            <FolderSync /> Change folder
          </button>
          <button type="button" className="btn sm" onClick={() => void api.backup.openFolder()}>
            <FolderOpen /> Open folder
          </button>
        </div>
        {status.backups.length > 0 && (
          <ul className="backup-list" aria-label="Backups">
            {shown.map((b) => (
              <BackupRow key={b.file} b={b} />
            ))}
          </ul>
        )}
        {status.backups.length > 5 && (
          <button type="button" className="link-btn tight" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${status.backups.length}`}
          </button>
        )}
      </div>
    </section>
  )
}

function BackupRow({ b }: { b: BackupInfo }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <li className="backup-row">
      <span>{when(b.createdAt)}</span>
      <span className="muted">{size(b.size)}</span>
      <button
        type="button"
        className={`btn sm ${armed ? 'armed' : ''}`}
        title="Go back to this backup. What you have now is saved first, so this can be undone."
        onClick={() => (armed ? void api.backup.restore(b.file) : setArmed(true))}
      >
        <RotateCcw /> {armed ? 'Click again — Plannr will restart' : 'Restore'}
      </button>
    </li>
  )
}
