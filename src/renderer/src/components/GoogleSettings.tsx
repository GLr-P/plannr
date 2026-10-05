import { useEffect, useState } from 'react'
import { FileKey, Link2, RefreshCw, Unlink } from 'lucide-react'
import type { GoogleStatus } from '../../../shared/api'
import { api } from '../api'
import { relativeTime } from '../lib/format'

/** Settings: connect Google Calendar (two-way sync of Plannr events + showing other Google calendars). */
export function GoogleSettings() {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.google.status().then(setStatus)
  }, [])

  const run = async (label: string, p: () => Promise<GoogleStatus>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      setStatus(await p())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!status) return null
  const problem = error ?? status.error

  return (
    <section className="setting integration">
      <div className="integration-main">
        <h3>Google Calendar</h3>
        <p className="muted">
          Your Plannr events and pickups show up in a “Plannr” calendar on your phone, changes made there come back, and your other Google
          calendars show in Plannr.
        </p>

        {!status.configured ? (
          <div className="integration-step">
            <span className="step-no">1</span>
            <span>Import the key file you downloaded from Google Cloud (client_secret_….json).</span>
            <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void run('import', () => api.google.importClient())}>
              <FileKey /> Import key file
            </button>
          </div>
        ) : !status.connected ? (
          <div className="integration-step">
            <span className="step-no">2</span>
            <span>Sign in with Google and allow calendar access. (On “Google hasn’t verified this app”, choose Advanced → Go to Plannr.)</span>
            <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void run('connect', () => api.google.connect())}>
              <Link2 /> {busy === 'connect' ? 'Waiting for Google…' : 'Connect'}
            </button>
          </div>
        ) : (
          <>
            <p className="small integration-status" aria-live="polite">
              <span className="dot-ok" /> Connected{status.email ? ` as ${status.email}` : ''}
              {status.lastSyncAt && <span className="muted"> · synced {relativeTime(status.lastSyncAt).toLowerCase()}</span>}
            </p>
            {status.calendars.length > 0 && (
              <div className="calendar-picks">
                <div className="popover-label">Show these Google calendars in Plannr</div>
                {status.calendars.map((c) => (
                  <label key={c.id} className="check">
                    <input
                      type="checkbox"
                      checked={status.selected.includes(c.id)}
                      onChange={(e) => {
                        const ids = e.target.checked ? [...status.selected, c.id] : status.selected.filter((x) => x !== c.id)
                        setStatus({ ...status, selected: ids })
                        void run('calendars', () => api.google.setCalendars(ids))
                      }}
                    />
                    <span className="cal-swatch" style={{ background: c.color || 'var(--accent)' }} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
            <div className="backup-actions">
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('sync', () => api.google.syncNow())}>
                <RefreshCw /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('disconnect', () => api.google.disconnect())}>
                <Unlink /> Disconnect
              </button>
            </div>
          </>
        )}
        {problem && <p className="small error-text">{problem}</p>}
      </div>
    </section>
  )
}
