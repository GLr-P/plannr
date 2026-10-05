import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  Printer,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  StickyNote,
  Wand2
} from 'lucide-react'
import {
  MIN_PASSCODE_LENGTH,
  VAULT_FIELDS,
  type VaultItem,
  type VaultItemKind,
  type VaultItemSummary,
  type VaultStatus
} from '../../../shared/api'
import { api } from '../api'
import { useAutosave } from '../lib/useAutosave'
import { ConfirmButton, SaveIndicator } from '../components/common'

const KIND_LABEL: Record<VaultItemKind, string> = { login: 'Login', card: 'Card', note: 'Secure note' }
const KIND_ICON: Record<VaultItemKind, React.ReactNode> = { login: <KeyRound />, card: <CreditCard />, note: <StickyNote /> }

export function VaultView() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const refresh = useCallback(() => api.vault.status().then(setStatus), [])

  useEffect(() => {
    void refresh()
    return window.plannrEvents.onVaultLocked(() => void refresh())
  }, [refresh])

  if (!status) return <div className="page" />
  if (recoveryKey) return <RecoveryKeyScreen recoveryKey={recoveryKey} onDone={() => setRecoveryKey(null)} />
  if (!status.setUp)
    return (
      <SetupScreen
        onDone={async (key) => {
          setRecoveryKey(key)
          await refresh()
        }}
      />
    )
  if (!status.unlocked) return <LockScreen status={status} onUnlocked={() => void refresh()} />
  return <VaultMain status={status} onStatus={() => void refresh()} />
}

// ---------- Setup ----------

function PasscodeFields({
  value,
  confirm,
  onValue,
  onConfirm,
  label = 'Choose a passcode'
}: {
  value: string
  confirm: string
  onValue: (v: string) => void
  onConfirm: (v: string) => void
  label?: string
}) {
  const strong = value.length >= 10 || (value.length >= 8 && /\D/.test(value))
  return (
    <>
      <label className="field">
        {label}
        <input type="password" autoFocus value={value} onChange={(e) => onValue(e.target.value)} aria-label={label} autoComplete="new-password" />
      </label>
      <label className="field">
        Type it again
        <input type="password" value={confirm} onChange={(e) => onConfirm(e.target.value)} aria-label="Confirm passcode" autoComplete="new-password" />
      </label>
      <div className={`hint ${value && !strong ? 'warn' : ''}`}>
        {value.length < MIN_PASSCODE_LENGTH
          ? `At least ${MIN_PASSCODE_LENGTH} characters.`
          : strong
            ? 'Good passcode.'
            : 'Works, but longer is much safer — try 8+ characters with a letter, or a few words.'}
      </div>
    </>
  )
}

function SetupScreen({ onDone }: { onDone: (recoveryKey: string) => void }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = pass.length >= MIN_PASSCODE_LENGTH && pass === confirm

  const submit = async (): Promise<void> => {
    if (!ready) return setError(pass !== confirm ? 'The two passcodes don’t match.' : `Use at least ${MIN_PASSCODE_LENGTH} characters.`)
    setBusy(true)
    try {
      onDone((await api.vault.setup(pass)).recoveryKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="vault-center">
      <form
        className="vault-card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="vault-badge">
          <ShieldCheck />
        </div>
        <h1>Set up your vault</h1>
        <p className="muted">
          A locked place for passwords, card details and private notes. Everything inside is encrypted with your passcode — it can’t be read from
          Plannr’s files without it.
        </p>
        <PasscodeFields value={pass} confirm={confirm} onValue={setPass} onConfirm={setConfirm} />
        {error && <div className="error-text">{error}</div>}
        <button type="submit" className="btn primary wide" disabled={busy}>
          {busy ? 'Setting up…' : 'Create vault'}
        </button>
      </form>
    </div>
  )
}

function RecoveryKeyScreen({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className="vault-center">
      <div className="vault-card print-area">
        <div className="vault-badge">
          <KeyRound />
        </div>
        <h1>Your recovery key</h1>
        <p className="muted">
          If you ever forget your passcode, this key is the <strong>only</strong> way back into your vault. Print it or save it somewhere safe
          that isn’t just this computer. It won’t be shown again.
        </p>
        <code className="recovery-key" aria-label="Recovery key">
          {recoveryKey}
        </code>
        <div className="row-buttons no-print">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(recoveryKey)
              setCopied(true)
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn" onClick={() => void api.vault.saveRecoveryKey(recoveryKey)}>
            <Save /> Save as file
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer /> Print
          </button>
        </div>
        <label className="check no-print">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved my recovery key somewhere safe
        </label>
        <button type="button" className="btn primary wide no-print" disabled={!saved} onClick={onDone}>
          Open my vault
        </button>
      </div>
    </div>
  )
}

// ---------- Locked ----------

function useCountdown(ms: number): number {
  const [left, setLeft] = useState(ms)
  useEffect(() => {
    setLeft(ms)
    if (ms <= 0) return
    const end = Date.now() + ms
    const t = setInterval(() => {
      const l = Math.max(0, end - Date.now())
      setLeft(l)
      if (l === 0) clearInterval(t)
    }, 250)
    return () => clearInterval(t)
  }, [ms])
  return left
}

function LockScreen({ status, onUnlocked }: { status: VaultStatus; onUnlocked: () => void }) {
  const [mode, setMode] = useState<'passcode' | 'recover'>('passcode')
  const [pass, setPass] = useState('')
  const [key, setKey] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retryMs, setRetryMs] = useState(status.retryAfterMs)
  const waitLeft = useCountdown(retryMs)
  const [shake, setShake] = useState(0)

  const unlock = async (): Promise<void> => {
    if (!pass || busy || waitLeft > 0) return
    setBusy(true)
    const result = await api.vault.unlock(pass)
    setBusy(false)
    if (result.ok) return onUnlocked()
    setError(result.error)
    setRetryMs(result.retryAfterMs ?? 0)
    setPass('')
    setShake((s) => s + 1)
  }

  const recover = async (): Promise<void> => {
    if (busy || waitLeft > 0) return
    if (newPass !== confirm) return setError('The two passcodes don’t match.')
    setBusy(true)
    const result = await api.vault.recover(key, newPass)
    setBusy(false)
    if (result.ok) return onUnlocked()
    setError(result.error)
    setRetryMs(result.retryAfterMs ?? 0)
  }

  return (
    <div className="vault-center">
      <form
        key={shake}
        className={`vault-card ${shake ? 'shake' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          void (mode === 'passcode' ? unlock() : recover())
        }}
      >
        <div className="vault-badge">
          <Lock />
        </div>
        <h1>{mode === 'passcode' ? 'Vault locked' : 'Reset your passcode'}</h1>
        {mode === 'passcode' ? (
          <label className="field">
            Passcode
            <input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Vault passcode" autoComplete="current-password" />
          </label>
        ) : (
          <>
            <p className="muted">Enter the recovery key you saved when you set up the vault, then choose a new passcode.</p>
            <label className="field">
              Recovery key
              <input autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-…" aria-label="Recovery key" spellCheck={false} />
            </label>
            <PasscodeFields value={newPass} confirm={confirm} onValue={setNewPass} onConfirm={setConfirm} label="New passcode" />
          </>
        )}
        {error && <div className="error-text">{error}</div>}
        {waitLeft > 0 && <div className="hint warn">Try again in {Math.ceil(waitLeft / 1000)} s.</div>}
        <button type="submit" className="btn primary wide" disabled={busy || waitLeft > 0}>
          {busy ? 'Checking…' : mode === 'passcode' ? 'Unlock' : 'Reset passcode and unlock'}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === 'passcode' ? 'recover' : 'passcode')
            setError('')
          }}
        >
          {mode === 'passcode' ? 'Forgot passcode? Use your recovery key' : 'Back to passcode'}
        </button>
      </form>
    </div>
  )
}

// ---------- Unlocked ----------

function VaultMain({ status, onStatus }: { status: VaultStatus; onStatus: () => void }) {
  const [items, setItems] = useState<VaultItemSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<'new' | 'settings' | null>(null)
  const [toast, setToast] = useState('')
  const reload = useCallback(async () => setItems(await api.vault.list()), [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Using the vault keeps it unlocked (checked at most every 20 s).
  useEffect(() => {
    let last = 0
    const onActivity = (): void => {
      if (Date.now() - last > 20_000) {
        last = Date.now()
        void api.vault.touch()
      }
    }
    window.addEventListener('mousemove', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const create = async (kind: VaultItemKind): Promise<void> => {
    setMenu(null)
    const item = await api.vault.create(kind)
    await reload()
    setSelected(item.id)
  }

  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => `${i.title} ${i.subtitle}`.toLowerCase().includes(q)) : items

  return (
    <div className="page wide vault-page">
      <div className="list-header">
        <h1>
          Vault <span className="unlocked-pill">Unlocked</span>
        </h1>
        <div className="list-header-actions">
          <div className="menu-anchor">
            <button type="button" className="icon-btn" title="Vault settings" aria-label="Vault settings" onClick={() => setMenu(menu === 'settings' ? null : 'settings')}>
              <Settings2 />
            </button>
            {menu === 'settings' && <VaultSettings status={status} onClose={() => setMenu(null)} onChanged={onStatus} />}
          </div>
          <button type="button" className="btn" onClick={() => void api.vault.lock()}>
            <Lock /> Lock
          </button>
          <div className="menu-anchor">
            <button type="button" className="btn primary" onClick={() => setMenu(menu === 'new' ? null : 'new')}>
              <Plus /> New
            </button>
            {menu === 'new' && (
              <div className="menu dropdown-menu">
                {(['login', 'card', 'note'] as const).map((k) => (
                  <button key={k} type="button" className="menu-item" onClick={() => void create(k)}>
                    <span className="menu-icon">{KIND_ICON[k]}</span>
                    <span className="menu-label">{KIND_LABEL[k]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="vault-split">
        <aside className="vault-list">
          <div className="filter-field">
            <Search />
            <input placeholder="Search vault…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search vault" />
          </div>
          {shown.length === 0 && <div className="muted small vault-empty">{items.length ? 'No matches.' : 'Nothing here yet — click New.'}</div>}
          {shown.map((i) => (
            <button key={i.id} type="button" className={`vault-row ${selected === i.id ? 'active' : ''}`} onClick={() => setSelected(i.id)}>
              <span className="vault-row-icon">{KIND_ICON[i.kind]}</span>
              <span className="vault-row-main">
                <span className="vault-row-title">{i.title || `Untitled ${KIND_LABEL[i.kind].toLowerCase()}`}</span>
                {i.subtitle && <span className="vault-row-sub">{i.subtitle}</span>}
              </span>
            </button>
          ))}
        </aside>
        <section className="vault-detail">
          {selected ? (
            <ItemEditor
              key={selected}
              id={selected}
              onChanged={() => void reload()}
              onDeleted={() => {
                setSelected(null)
                void reload()
              }}
              onToast={setToast}
            />
          ) : (
            <div className="empty-state">Select an item, or click New.</div>
          )}
        </section>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/** Strong random password (no look-alike characters), always with upper, lower, digit and symbol. */
export function generatePassword(length = 20): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?']
  const all = sets.join('')
  const pick = (chars: string): string => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length]
  const out = sets.map(pick)
  while (out.length < length) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

function ItemEditor({ id, onChanged, onDeleted, onToast }: { id: string; onChanged: () => void; onDeleted: () => void; onToast: (s: string) => void }) {
  const [item, setItem] = useState<VaultItem | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const saver = useAutosave<{ title?: string; fields?: Record<string, string> }>(async (patch) => {
    const saved = await api.vault.update(id, patch)
    setItem((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt } : saved))
    onChanged()
  })
  const pendingFields = useRef<Record<string, string>>({})

  useEffect(() => {
    void api.vault.get(id).then(setItem)
  }, [id])

  if (!item) return null

  const setField = (key: string, value: string): void => {
    setItem({ ...item, fields: { ...item.fields, [key]: value } })
    pendingFields.current = { ...pendingFields.current, [key]: value }
    saver.queue({ fields: pendingFields.current })
  }

  const copy = async (key: string, label: string): Promise<void> => {
    await saver.flush()
    await api.vault.copy(id, key)
    onToast(`${label} copied — clears from the clipboard in 30 s`)
  }

  return (
    <div className="vault-editor">
      <div className="vault-editor-head">
        <span className="vault-kind">
          {KIND_ICON[item.kind]} {KIND_LABEL[item.kind]}
        </span>
        <span className="toolbar-right">
          <SaveIndicator status={saver.status} updatedAt={item.updatedAt} />
          <ConfirmButton
            title="Delete item"
            onConfirm={async () => {
              await api.vault.remove(id)
              onDeleted()
            }}
          />
        </span>
      </div>
      <input
        className="doc-title vault-title"
        value={item.title}
        placeholder={`Name this ${KIND_LABEL[item.kind].toLowerCase()} (e.g. ${item.kind === 'login' ? 'Zoho Mail' : item.kind === 'card' ? 'Business Visa' : 'Alarm codes'})`}
        autoFocus={!item.title}
        onChange={(e) => {
          setItem({ ...item, title: e.target.value })
          saver.queue({ title: e.target.value })
        }}
        aria-label="Item name"
      />
      <div className="vault-fields">
        {VAULT_FIELDS[item.kind].map((f) => {
          const value = item.fields[f.key] ?? ''
          const show = !f.secret || revealed[f.key]
          return (
            <div key={f.key} className={`vault-field ${f.multiline ? 'multi' : ''}`}>
              <label className="vault-field-label" htmlFor={`vf-${f.key}`}>
                {f.label}
              </label>
              <div className="vault-field-row">
                {f.multiline ? (
                  <textarea id={`vf-${f.key}`} value={value} onChange={(e) => setField(f.key, e.target.value)} aria-label={f.label} spellCheck={item.kind === 'note'} />
                ) : (
                  <input
                    id={`vf-${f.key}`}
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    aria-label={f.label}
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
                {f.secret && (
                  <button
                    type="button"
                    className="icon-btn sm"
                    title={show ? 'Hide' : 'Show'}
                    aria-label={`${show ? 'Hide' : 'Show'} ${f.label}`}
                    onClick={() => setRevealed({ ...revealed, [f.key]: !show })}
                  >
                    {show ? <EyeOff /> : <Eye />}
                  </button>
                )}
                {f.key === 'password' && (
                  <button
                    type="button"
                    className="icon-btn sm"
                    title="Generate a strong password"
                    aria-label="Generate password"
                    onClick={() => {
                      setField('password', generatePassword())
                      setRevealed({ ...revealed, password: true })
                    }}
                  >
                    <Wand2 />
                  </button>
                )}
                {f.key === 'url' && value && (
                  <button
                    type="button"
                    className="icon-btn sm"
                    title="Open website"
                    aria-label="Open website"
                    onClick={() => window.open(/^https?:\/\//i.test(value) ? value : `https://${value}`, '_blank')}
                  >
                    <ExternalLink />
                  </button>
                )}
                {!f.multiline && value && (
                  <button type="button" className="icon-btn sm" title="Copy" aria-label={`Copy ${f.label}`} onClick={() => void copy(f.key, f.label)}>
                    <Copy />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VaultSettings({ status, onClose, onChanged }: { status: VaultStatus; onClose: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const change = async (): Promise<void> => {
    if (next !== confirm) return setMessage({ ok: false, text: 'The new passcodes don’t match.' })
    const r = await api.vault.changePasscode(current, next)
    setMessage(r.ok ? { ok: true, text: 'Passcode changed.' } : { ok: false, text: r.error })
    if (r.ok) {
      setCurrent('')
      setNext('')
      setConfirm('')
    }
  }

  return (
    <div className="popover vault-settings" ref={ref} role="dialog" aria-label="Vault settings">
      <label className="field">
        Lock automatically after
        <select
          className="select"
          value={status.autoLockMinutes}
          onChange={async (e) => {
            await api.vault.setAutoLock(Number(e.target.value))
            onChanged()
          }}
          aria-label="Auto-lock minutes"
        >
          {[1, 5, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minute{m === 1 ? '' : 's'} of inactivity
            </option>
          ))}
        </select>
      </label>
      <div className="muted small">It also locks when your PC locks or sleeps, and when Plannr goes to the tray.</div>
      <form
        className="change-pass"
        onSubmit={(e) => {
          e.preventDefault()
          void change()
        }}
      >
        <div className="popover-label">Change passcode</div>
        <input type="password" placeholder="Current passcode" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current passcode" />
        <input type="password" placeholder={`New passcode (${MIN_PASSCODE_LENGTH}+ characters)`} value={next} onChange={(e) => setNext(e.target.value)} aria-label="New passcode" />
        <input type="password" placeholder="Type the new one again" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm new passcode" />
        {message && <div className={message.ok ? 'ok-text' : 'error-text'}>{message.text}</div>}
        <button type="submit" className="btn sm primary" disabled={!current || !next}>
          Change passcode
        </button>
      </form>
    </div>
  )
}
