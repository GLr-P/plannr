import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, Inbox, RefreshCw, Unlink } from 'lucide-react'
import type { TroubleshootrStatus } from '../../../shared/api'
import { api } from '../api'
import { relativeTime } from '../lib/format'

const cleanError = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

/**
 * Settings → Sync & devices → Troubleshootr: connects the diagnostic tool, which then sends scan reports straight into
 * a new ticket, an open ticket or a note. Reports travel through the sync service, sealed so only this PC can open them.
 */
export function TroubleshootrSettings() {
  const [status, setStatus] = useState<TroubleshootrStatus | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.troubleshootr.status().then(setStatus)
    const t = setInterval(() => void api.troubleshootr.status().then(setStatus), 10_000)
    return () => clearInterval(t)
  }, [])

  const run = async (label: string, p: () => Promise<TroubleshootrStatus>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      setStatus(await p())
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  if (!status?.syncOn) return null
  return (
    <section className="setting integration sync-setting">
      <div className="integration-main">
        <h3>Troubleshootr</h3>
        <p className="muted">
          Send scan reports from Troubleshootr (the PC diagnostic tool) straight into Plannr: a new ticket, an open ticket or a note, with the full report
          attached. Paste the link below into Troubleshootr’s Send tab once.
        </p>
        {status.connected ? (
          <>
            <p className="small integration-status" aria-live="polite">
              <span className={status.error ? 'dot-error' : 'dot-ok'} /> Connected
              {status.lastCheckAt && <span className="muted"> · checked {relativeTime(status.lastCheckAt).toLowerCase()}</span>}
            </p>
            {status.recent.length > 0 && (
              <ul className="small">
                {status.recent.map((r) => (
                  <li key={r.id + r.at}>
                    {r.created ? 'New ' : 'Added to '}
                    {r.kind} {r.title} · {relativeTime(r.at).toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
            <p className="small warn-text">The link can only add reports and see open ticket numbers. Reconnect to make an old link stop working.</p>
            {showLink && status.link && (
              <div className="sync-link">
                <code className="path">{status.link}</code>
              </div>
            )}
            <div className="backup-actions">
              {showLink && status.link ? (
                <>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(status.link!)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2_000)
                    }}
                  >
                    <Copy /> {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => setShowLink(false)}>
                    <EyeOff /> Hide
                  </button>
                </>
              ) : (
                <button type="button" className="btn sm" onClick={() => setShowLink(true)}>
                  <Eye /> Show link
                </button>
              )}
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('check', () => api.troubleshootr.checkNow())}>
                <RefreshCw /> {busy === 'check' ? 'Checking…' : 'Check for reports'}
              </button>
              {confirmOff ? (
                <>
                  <span className="small">Disconnect? The link stops working; reports already in Plannr stay.</span>
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={async () => {
                      setConfirmOff(false)
                      setShowLink(false)
                      await run('off', () => api.troubleshootr.disconnect())
                    }}
                  >
                    Disconnect
                  </button>
                  <button type="button" className="btn sm" onClick={() => setConfirmOff(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="btn sm" onClick={() => setConfirmOff(true)}>
                  <Unlink /> Disconnect
                </button>
              )}
            </div>
          </>
        ) : (
          <>
          {status.elsewhere && (
            <p className="small muted">
              Troubleshootr is connected on {status.elsewhere}, which collects the reports. Connecting here moves it to this PC (the old link stops working).
            </p>
          )}
          <div className="backup-actions">
            <button
              type="button"
              className="btn sm primary"
              disabled={!!busy}
              onClick={async () => {
                await run('connect', () => api.troubleshootr.connect())
                setShowLink(true)
              }}
            >
              <Inbox /> {busy === 'connect' ? 'Connecting…' : status.elsewhere ? 'Connect on this PC instead' : 'Connect Troubleshootr'}
            </button>
          </div>
          </>
        )}
        {(error ?? status.error) && <p className="small error-text">{error ?? status.error}</p>}
      </div>
    </section>
  )
}
