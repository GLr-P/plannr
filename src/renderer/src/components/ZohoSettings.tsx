import { useEffect, useState } from 'react'
import { KeyRound, Link2, Unlink } from 'lucide-react'
import { ZOHO_REGIONS, type ZohoRegion, type ZohoStatus } from '../../../shared/api'
import { api } from '../api'

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** Settings: connect Zoho Mail (read-only) to see customer email history. */
export function ZohoSettings() {
  const [status, setStatus] = useState<ZohoStatus | null>(null)
  const [region, setRegion] = useState<ZohoRegion>('com')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState(false)

  useEffect(() => {
    void api.zoho.status().then((s) => {
      setStatus(s)
      if (s.region) setRegion(s.region)
    })
  }, [])

  const run = async (label: string, p: () => Promise<ZohoStatus>): Promise<boolean> => {
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
  const showKeyForm = !status.configured || editingKey

  return (
    <section className="setting integration">
      <div className="integration-main">
        <h3>Zoho Mail</h3>
        <p className="muted">See your emails with each customer on their page and tickets, and read them without leaving Plannr. Read-only.</p>

        {showKeyForm ? (
          <form
            className="integration-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await run('save', () => api.zoho.configure({ region, clientId, clientSecret }))) {
                setClientSecret('')
                setEditingKey(false)
              }
            }}
          >
            <span className="step-no">1</span>
            <div className="integration-fields">
              <span className="small">Paste the key from api-console.zoho.com (stored encrypted on this PC).</span>
              <label className="mfield">
                Your Zoho region
                <select value={region} onChange={(e) => setRegion(e.target.value as ZohoRegion)} aria-label="Zoho region">
                  {ZOHO_REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mfield">
                Client ID
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1000.XXXXXXXX…" spellCheck={false} aria-label="Zoho Client ID" />
              </label>
              <label className="mfield">
                Client Secret
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} spellCheck={false} aria-label="Zoho Client Secret" autoComplete="off" />
              </label>
              <button type="submit" className="btn sm primary" disabled={!!busy || !clientId || !clientSecret}>
                <KeyRound /> Save key
              </button>
            </div>
          </form>
        ) : !status.connected ? (
          <div className="integration-step">
            <span className="step-no">2</span>
            <span>Sign in to Zoho and allow read access to your mail.</span>
            <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void run('connect', () => api.zoho.connect())}>
              <Link2 /> {busy === 'connect' ? 'Waiting for Zoho…' : 'Connect'}
            </button>
            <button type="button" className="link-btn tight" onClick={() => setEditingKey(true)}>
              Change key
            </button>
          </div>
        ) : (
          <>
            <p className="small integration-status">
              <span className="dot-ok" /> Connected{status.email ? ` as ${status.email}` : ''}
            </p>
            <div className="backup-actions">
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('disconnect', () => api.zoho.disconnect())}>
                <Unlink /> Disconnect
              </button>
            </div>
          </>
        )}
        {(error ?? status.error) && <p className="small error-text">{error ?? status.error}</p>}
      </div>
    </section>
  )
}
