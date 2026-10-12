import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Package, Plus, RefreshCw, Trash2, Truck } from 'lucide-react'
import type { PackageInfo } from '../../../shared/api'
import { api } from '../api'
import { formatDay, relativeTime, todayISO } from '../lib/format'

const STATUS_LABEL: Record<PackageInfo['status'], string> = { pending: 'Label created', transit: 'On the way', out: 'Out for delivery', delivered: 'Delivered', problem: 'Problem', unknown: 'Tracking' }

/** Tracking numbers: carrier, status, expected day (on the calendar), and live tracking with a 17TRACK key. */
export function PackagesView() {
  const [list, setList] = useState<PackageInfo[]>([])
  const [number, setNumber] = useState('')
  const [label, setLabel] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tracking, setTracking] = useState<{ configured: boolean; error: string | null } | null>(null)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setList(await api.packages.refresh())
      setTracking(await api.packages.trackingStatus())
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void api.packages.list().then(setList)
    void api.packages.trackingStatus().then((t) => {
      setTracking(t)
      if (t.configured) void refresh()
    })
  }, [refresh])

  const add = async (): Promise<void> => {
    setError('')
    try {
      await api.packages.add({ number, label, expected: expected || null })
      setNumber('')
      setLabel('')
      setExpected('')
      setList(tracking?.configured ? await api.packages.refresh() : await api.packages.list())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Couldn’t add it')
    }
  }

  return (
    <div className="page packages-page">
      <div className="list-header">
        <h1>Packages</h1>
        <div className="news-header-actions">
          {tracking?.configured && (
            <button type="button" className="icon-btn" aria-label="Check tracking now" title="Check tracking now" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw className={busy ? 'spin' : ''} />
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => setShowKey((s) => !s)}>
            Live tracking{tracking?.configured ? ': on' : ''}
          </button>
        </div>
      </div>

      {showKey && tracking && (
        <section className="card pkg-key">
          <p className="small">
            Plannr can check where your packages are using <b>17TRACK</b> (free for up to 100 packages a month, every carrier). Make a free account at{' '}
            <a href="https://api.17track.net" target="_blank" rel="noreferrer">
              api.17track.net
            </a>
            , copy your <b>API key</b> (Settings → Security → Access key) and paste it here. Without it, each package still links to its carrier’s tracking page.
          </p>
          {tracking.error && <p className="small danger-text">{tracking.error}</p>}
          <form
            className="news-add-link"
            onSubmit={async (e) => {
              e.preventDefault()
              setTracking(await api.packages.setTrackingKey(key || null))
              setKey('')
              if (key) void refresh()
            }}
          >
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={tracking.configured ? 'A key is saved (paste a new one to replace it)' : 'Paste your 17TRACK API key'} aria-label="17TRACK key" type="password" />
            <button type="submit" className="btn">
              Save
            </button>
            {tracking.configured && (
              <button type="button" className="btn" onClick={() => void api.packages.setTrackingKey(null).then(setTracking)}>
                Remove
              </button>
            )}
          </form>
        </section>
      )}

      <form
        className="pkg-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Tracking number" aria-label="Tracking number" required />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What it is (optional)" aria-label="What it is" />
        <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} aria-label="Expected" title="Expected delivery (optional)" />
        <button type="submit" className="btn primary">
          <Plus /> Add
        </button>
      </form>
      {error && <p className="small danger-text">{error}</p>}

      {list.length === 0 && <div className="empty-state">No packages. Add a tracking number above; it shows on your calendar on the day it’s expected.</div>}
      <ul className="pkg-list">
        {list.map((p) => (
          <li key={p.id} className={`pkg pkg-${p.status}`}>
            <div className="pkg-row">
              {p.status === 'delivered' ? <CheckCircle2 className="pkg-icon" /> : p.status === 'out' || p.status === 'transit' ? <Truck className="pkg-icon" /> : <Package className="pkg-icon" />}
              <button type="button" className="pkg-main" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                <b>{p.label || p.number}</b>
                <span className="small muted">
                  {p.carrierName} · {p.number}
                  {p.statusText ? ` · ${p.statusText}` : ''}
                </span>
              </button>
              <span className={`pkg-status s-${p.status}`}>{STATUS_LABEL[p.status]}</span>
              <span className="pkg-when small">
                {p.status === 'delivered' ? (p.deliveredAt ? relativeTime(p.deliveredAt) : '') : p.expected ? (p.expected === todayISO() ? 'Today' : formatDay(p.expected)) : ''}
              </span>
              <a className="icon-btn sm" href={p.trackUrl} target="_blank" rel="noreferrer" aria-label={`Track ${p.number}`} title="Open the carrier’s tracking page">
                <ExternalLink />
              </a>
              {p.status !== 'delivered' && (
                <button type="button" className="icon-btn sm" aria-label="Mark delivered" title="Mark delivered" onClick={() => void api.packages.update(p.id, { delivered: true }).then(() => api.packages.list().then(setList))}>
                  <CheckCircle2 />
                </button>
              )}
              <button type="button" className="icon-btn sm" aria-label={`Remove ${p.number}`} onClick={() => void api.packages.remove(p.id).then(() => api.packages.list().then(setList))}>
                <Trash2 />
              </button>
            </div>
            {open === p.id && (
              <div className="pkg-details">
                <label className="mfield">
                  What it is
                  <input defaultValue={p.label} aria-label="Package name" onBlur={(e) => void api.packages.update(p.id, { label: e.target.value }).then(() => api.packages.list().then(setList))} />
                </label>
                <label className="mfield">
                  Expected
                  <input type="date" defaultValue={p.expected ?? ''} aria-label="Expected date" onChange={(e) => void api.packages.update(p.id, { expected: e.target.value || null }).then(() => api.packages.list().then(setList))} />
                </label>
                {p.events.length > 0 && (
                  <ol className="pkg-events">
                    {p.events.map((e, i) => (
                      <li key={i}>
                        <span className="small muted">{e.time ? new Date(e.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span> {e.text}
                        {e.place && <span className="muted"> · {e.place}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
