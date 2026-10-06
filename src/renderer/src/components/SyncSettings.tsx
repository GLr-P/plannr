import { useEffect, useMemo, useState } from 'react'
import { Copy, Eye, EyeOff, Laptop, Link2, RefreshCw, Unlink } from 'lucide-react'
import qrcode from 'qrcode-generator'
import type { SyncStatus } from '../../../shared/api'
import { api } from '../api'
import { relativeTime } from '../lib/format'

const cleanError = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

/** A QR code drawn as SVG squares (black on white, so phone cameras read it in dark mode too). */
function Qr({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 3} ${r + 3}h1v1h-1z`
    return { size: n + 6, path: d }
  }, [text])
  return (
    <svg className="sync-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code that adds a device" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/** Settings → Sync & devices: keep your phone and other PCs in sync through your own (free) sync server. */
export function SyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [mode, setMode] = useState<'first' | 'join' | null>(null)
  const [server, setServer] = useState('')
  const [code, setCode] = useState('')
  const [link, setLink] = useState('')
  const [shownLink, setShownLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [web, setWeb] = useState(false)
  const device = web ? 'this phone' : 'this PC'

  useEffect(() => {
    void api.app.info().then((info) => setWeb(info.web))
    void api.sync.status().then(setStatus)
    const t = setInterval(() => void api.sync.status().then(setStatus), 2_000)
    return () => clearInterval(t)
  }, [])

  const run = async (label: string, p: () => Promise<SyncStatus>): Promise<boolean> => {
    setBusy(label)
    setError(null)
    try {
      setStatus(await p())
      return true
    } catch (e) {
      setError(cleanError(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!status) return null

  if (!status.enabled) {
    return (
      <section className="setting integration sync-setting">
        <div className="integration-main">
          <h3>Sync & devices</h3>
          <p className="muted">
            Use Plannr on your phone and other computers. Everything is encrypted on this device before it leaves, with a key only your devices have, and kept
            on a free sync server you own (Cloudflare).
          </p>
          {mode === null && (
            <div className="backup-actions">
              {!web && (
                <button type="button" className="btn sm primary" onClick={() => setMode('first')}>
                  <Laptop /> Start syncing from this PC
                </button>
              )}
              <button type="button" className="btn sm" onClick={() => setMode('join')}>
                <Link2 /> Join with a link
              </button>
            </div>
          )}
          {mode === 'first' && (
            <form
              className="integration-form"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await run('setup', () => api.sync.setup(server, code))) {
                  setCode('')
                  setMode(null)
                }
              }}
            >
              <div className="integration-fields">
                <span className="small">Your sync server’s address and the setup code chosen when it was set up.</span>
                <label className="mfield">
                  <span>Sync server address</span>
                  <input
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="https://plannr-sync.yourname.workers.dev"
                    spellCheck={false}
                    aria-label="Sync server address"
                  />
                </label>
                <label className="mfield">
                  <span>Setup code</span>
                  <input type="password" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Setup code" />
                </label>
                <div className="backup-actions">
                  <button type="submit" className="btn sm primary" disabled={!!busy || !server.trim() || !code.trim()}>
                    {busy === 'setup' ? 'Sending everything up…' : 'Turn on sync'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}
          {mode === 'join' && (
            <form
              className="integration-form"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await run('join', () => api.sync.join(link))) {
                  setLink('')
                  setMode(null)
                }
              }}
            >
              <div className="integration-fields">
                <span className="small">
                  On a device that already syncs, open Settings → Sync & devices → Add a device, copy the link and paste it here. If {device} is new, its
                  starter templates are replaced with yours; otherwise its things are combined with your other devices’.
                </span>
                <label className="mfield">
                  <span>Join link</span>
                  <input
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://…/#join=…"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Join link"
                  />
                </label>
                <div className="backup-actions">
                  <button type="submit" className="btn sm primary" disabled={!!busy || !link.trim()}>
                    {busy === 'join' ? 'Joining…' : 'Join'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}
          {error && <p className="small error-text">{error}</p>}
        </div>
      </section>
    )
  }

  const state = status.syncing ? 'Syncing…' : status.lastSyncAt ? `Synced ${relativeTime(status.lastSyncAt).toLowerCase()}` : 'Not synced yet'
  return (
    <>
      <section className="setting integration sync-setting">
        <div className="integration-main">
          <h3>Sync & devices</h3>
          <p className="small integration-status" aria-live="polite">
            <span className={status.error ? 'dot-error' : 'dot-ok'} /> {state}
            {status.pending > 0 && (
              <span className="muted">
                {' '}
                · {status.pending} change{status.pending === 1 ? '' : 's'} to send
              </span>
            )}
            {status.filesWaiting > 0 && (
              <span className="muted">
                {' '}
                · downloading {status.filesWaiting} file{status.filesWaiting === 1 ? '' : 's'}
              </span>
            )}
          </p>
          <p className="small muted">
            Through <code className="path inline">{status.server}</code>. Changes go up within seconds and come in every minute.
          </p>
          {status.fileStore === 'd1' && (
            <p className="small muted">Files and photos are kept in the server’s database (up to 60 MB each). Add Cloudflare R2 storage for bigger files.</p>
          )}
          {!web && <p className="small muted">Connect Google Calendar and QuickBooks on one PC only; the others get the results through sync.</p>}
          <div className="backup-actions">
            <button type="button" className="btn sm" disabled={status.syncing} onClick={() => void run('sync', () => api.sync.syncNow())}>
              <RefreshCw /> Sync now
            </button>
            {confirmOff ? (
              <>
                <span className="small">Stop syncing on {device}? Nothing is deleted here or on your other devices.</span>
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={async () => {
                    setConfirmOff(false)
                    setShownLink(null)
                    await run('off', () => api.sync.disconnect())
                  }}
                >
                  Stop syncing
                </button>
                <button type="button" className="btn sm" onClick={() => setConfirmOff(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn sm" onClick={() => setConfirmOff(true)}>
                <Unlink /> Turn off
              </button>
            )}
          </div>
          {(error ?? status.error) && <p className="small error-text">{error ?? status.error}</p>}
        </div>
      </section>

      <section className="setting integration sync-setting">
        <div className="integration-main">
          <h3>Add a device</h3>
          <p className="muted">
            iPhone: point the Camera at the code, tap the link, then in Safari tap Share → Add to Home Screen. Another PC: copy the link and paste it in that
            PC’s Plannr under Settings → Sync & devices → Join with a link.
          </p>
          <p className="small warn-text">Anyone with this code or link can open your Plannr data. Only use it on your own devices.</p>
          {shownLink ? (
            <div className="sync-add">
              <Qr text={shownLink} />
              <div className="sync-link">
                <code className="path">{shownLink}</code>
                <div className="backup-actions">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(shownLink)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2_000)
                    }}
                  >
                    <Copy /> {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button type="button" className="btn sm" onClick={() => setShownLink(null)}>
                    <EyeOff /> Hide
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="backup-actions">
              <button type="button" className="btn sm primary" onClick={async () => setShownLink(await api.sync.link())}>
                <Eye /> Show code and link
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
