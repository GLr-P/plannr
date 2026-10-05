import { useEffect, useState } from 'react'
import { KeyRound, Link2, RefreshCw, Unlink } from 'lucide-react'
import type { QboConfig, QboOptions, QboStatus } from '../../../shared/api'
import { api } from '../api'
import { relativeTime, todayISO } from '../lib/format'

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

const CREATE_ITEM = '__create__'

/** Settings: connect QuickBooks Online, choose where things go, see sync status. */
export function QuickBooksSettings() {
  const [status, setStatus] = useState<QboStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingSetup, setEditingSetup] = useState(false)

  useEffect(() => {
    void api.quickbooks.status().then(setStatus)
  }, [])

  const run = async (label: string, p: () => Promise<QboStatus>): Promise<boolean> => {
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
  const setupDone = Boolean(status.config?.itemId && status.config?.taxCodeId && status.config?.paymentAccountId && status.config?.expenseAccountId)

  return (
    <section className="setting integration">
      <div className="integration-main">
        <h3>QuickBooks Online</h3>
        <p className="muted">Customers, ticket payments (as sales receipts) and expenses go to QuickBooks automatically. Your prices include tax; QuickBooks splits it out.</p>

        {!status.configured ? (
          <form
            className="integration-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await run('save', () => api.quickbooks.configureKey({ clientId, clientSecret }))) setClientSecret('')
            }}
          >
            <span className="step-no">1</span>
            <div className="integration-fields">
              <span className="small">Paste the Production keys from developer.intuit.com (stored encrypted on this PC).</span>
              <label className="mfield">
                Client ID
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} aria-label="QuickBooks Client ID" />
              </label>
              <label className="mfield">
                Client Secret
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} spellCheck={false} aria-label="QuickBooks Client Secret" autoComplete="off" />
              </label>
              <button type="submit" className="btn sm primary" disabled={!!busy || !clientId || !clientSecret}>
                <KeyRound /> Save key
              </button>
            </div>
          </form>
        ) : !status.connected ? (
          <div className="integration-step">
            <span className="step-no">2</span>
            <span>Sign in to QuickBooks and choose your company. A Plannr window opens for this.</span>
            <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void run('connect', () => api.quickbooks.connect())}>
              <Link2 /> {busy === 'connect' ? 'Waiting for QuickBooks…' : 'Connect'}
            </button>
          </div>
        ) : !setupDone || editingSetup ? (
          <QboSetup
            initial={status.config}
            onSaved={(s) => {
              setStatus(s)
              setEditingSetup(false)
            }}
            onError={setError}
          />
        ) : (
          <>
            <p className="small integration-status" aria-live="polite">
              <span className="dot-ok" /> Connected{status.companyName ? ` to ${status.companyName}` : ''}
              {status.lastSyncAt && <span className="muted"> · sent {relativeTime(status.lastSyncAt).toLowerCase()}</span>}
              {status.config && <span className="muted"> · from {status.config.startDate}</span>}
            </p>
            {status.problems.length > 0 && (
              <div className="qbo-problems">
                <div className="popover-label">Couldn’t send {status.problems.length} item{status.problems.length === 1 ? '' : 's'} (will retry):</div>
                <ul>
                  {status.problems.slice(0, 6).map((p) => (
                    <li key={p} className="small">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="backup-actions">
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('sync', () => api.quickbooks.syncNow())}>
                <RefreshCw /> {busy === 'sync' ? 'Sending…' : 'Sync now'}
              </button>
              <button type="button" className="btn sm" onClick={() => setEditingSetup(true)}>
                Change where things go
              </button>
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => void run('disconnect', () => api.quickbooks.disconnect())}>
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

function QboSetup({ initial, onSaved, onError }: { initial: QboConfig | null; onSaved: (s: QboStatus) => void; onError: (e: string | null) => void }) {
  const [options, setOptions] = useState<QboOptions | null>(null)
  const [cfg, setCfg] = useState<QboConfig>(
    initial ?? {
      itemId: '',
      taxCodeId: '',
      taxRate: 0,
      paymentAccountId: '',
      paymentAccountType: '',
      expenseAccountId: '',
      purchaseTaxCodeId: '',
      purchaseTaxRate: 0,
      startDate: todayISO()
    }
  )
  const [incomeAccountId, setIncomeAccountId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.quickbooks
      .options()
      .then((o) => {
        setOptions(o)
        setIncomeAccountId(o.incomeAccounts[0]?.id ?? '')
        setCfg((c) => ({
          ...c,
          itemId: c.itemId || o.items.find((i) => /repair/i.test(i.name))?.id || (o.items.length ? '' : CREATE_ITEM)
        }))
      })
      .catch((e) => onError(cleanError(e)))
  }, [onError])

  if (!options) return <p className="small muted">Loading your QuickBooks lists…</p>
  const set = (patch: Partial<QboConfig>): void => setCfg((c) => ({ ...c, ...patch }))
  const ready = cfg.itemId && cfg.taxCodeId && cfg.paymentAccountId && cfg.expenseAccountId && cfg.purchaseTaxCodeId && cfg.startDate

  const save = async (): Promise<void> => {
    setSaving(true)
    onError(null)
    try {
      let itemId = cfg.itemId
      if (itemId === CREATE_ITEM) itemId = (await api.quickbooks.createItem(incomeAccountId)).id
      onSaved(await api.quickbooks.setConfig({ ...cfg, itemId }))
    } catch (e) {
      onError(cleanError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="integration-form">
      <span className="step-no">3</span>
      <div className="integration-fields qbo-setup">
        <span className="small">
          Connected to <strong>{options.companyName || 'your company'}</strong>. Choose where things go:
        </span>
        <label className="mfield">
          Sales: product/service for repairs
          <select value={cfg.itemId} onChange={(e) => set({ itemId: e.target.value })} aria-label="Repair item">
            <option value="">Choose…</option>
            {options.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
            <option value={CREATE_ITEM}>+ Create “Repair services”</option>
          </select>
        </label>
        {cfg.itemId === CREATE_ITEM && (
          <label className="mfield">
            …recorded in income account
            <select value={incomeAccountId} onChange={(e) => setIncomeAccountId(e.target.value)} aria-label="Income account">
              {options.incomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="mfield">
          Sales tax you charge
          <select
            value={cfg.taxCodeId}
            onChange={(e) => {
              const t = options.taxCodes.find((x) => x.id === e.target.value)
              set({ taxCodeId: e.target.value, taxRate: t?.rate ?? 0 })
            }}
            aria-label="Sales tax code"
          >
            <option value="">Choose…</option>
            {options.taxCodes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.rate ?? 0}%)
              </option>
            ))}
          </select>
        </label>
        <label className="mfield">
          Expenses are paid from
          <select
            value={cfg.paymentAccountId}
            onChange={(e) => {
              const a = options.paymentAccounts.find((x) => x.id === e.target.value)
              set({ paymentAccountId: e.target.value, paymentAccountType: a?.detail ?? '' })
            }}
            aria-label="Paid from account"
          >
            <option value="">Choose…</option>
            {options.paymentAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.detail})
              </option>
            ))}
          </select>
        </label>
        <label className="mfield">
          Expense account when the category doesn’t match one
          <select value={cfg.expenseAccountId} onChange={(e) => set({ expenseAccountId: e.target.value })} aria-label="Default expense account">
            <option value="">Choose…</option>
            {options.expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mfield">
          Tax on your purchases
          <select
            value={cfg.purchaseTaxCodeId}
            onChange={(e) => {
              const t = options.taxCodes.find((x) => x.id === e.target.value)
              set({ purchaseTaxCodeId: e.target.value, purchaseTaxRate: Number(t?.detail ?? 0) })
            }}
            aria-label="Purchase tax code"
          >
            <option value="">Choose…</option>
            {options.taxCodes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.detail ?? 0}%)
              </option>
            ))}
          </select>
        </label>
        <label className="mfield">
          Send transactions from
          <input type="date" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value })} aria-label="Send transactions from" />
        </label>
        <span className="small muted">Earlier transactions stay out of QuickBooks, so nothing you entered there by hand gets doubled.</span>
        <button type="button" className="btn sm primary" disabled={!ready || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save and start syncing'}
        </button>
      </div>
    </div>
  )
}
