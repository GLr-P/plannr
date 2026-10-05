import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  CreditCard,
  Download,
  File as FileIcon,
  FileText,
  FolderLock,
  Paperclip,
  X,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LockOpen,
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
  type DocJSON,
  type VaultCustomField,
  type VaultFile,
  type VaultItem,
  type VaultItemKind,
  type VaultItemPatch,
  type VaultItemSummary,
  type VaultStatus
} from '../../../shared/api'
import { api } from '../api'
import { useAutosave } from '../lib/useAutosave'
import { ConfirmButton, SaveIndicator } from '../components/common'
import { NoteEditor } from '../editor/NoteEditor'
import { pickFiles } from '../editor/upload'

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
  const [pickFor, setPickFor] = useState<string | null>(null) // new Document: open the file picker right away
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

  const create = async (kind: VaultItemKind, withFiles = false): Promise<void> => {
    setMenu(null)
    const item = await api.vault.create(kind)
    await reload()
    setPickFor(withFiles ? item.id : null)
    setSelected(item.id)
  }

  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => `${i.title} ${i.subtitle} ${i.searchText}`.toLowerCase().includes(q)) : items

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
                <button type="button" className="menu-item" onClick={() => void create('note', true)}>
                  <span className="menu-icon">
                    <FolderLock />
                  </span>
                  <span className="menu-label">Document</span>
                  <span className="menu-hint">PDFs & files</span>
                </button>
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
              {i.fileCount > 0 && (
                <span className="vault-row-files" title={`${i.fileCount} file${i.fileCount === 1 ? '' : 's'}`}>
                  <Paperclip /> {i.fileCount}
                </span>
              )}
            </button>
          ))}
        </aside>
        <section className="vault-detail">
          {selected ? (
            <ItemEditor
              key={selected}
              id={selected}
              pickFilesOnOpen={pickFor === selected}
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

function ItemEditor({
  id,
  pickFilesOnOpen,
  onChanged,
  onDeleted,
  onToast
}: {
  id: string
  pickFilesOnOpen?: boolean
  onChanged: () => void
  onDeleted: () => void
  onToast: (s: string) => void
}) {
  const [item, setItem] = useState<VaultItem | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const saver = useAutosave<VaultItemPatch>(async (patch) => {
    const saved = await api.vault.update(id, patch)
    setItem((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt } : saved))
    onChanged()
  })
  const pendingFields = useRef<Record<string, string>>({})

  useEffect(() => {
    void api.vault.get(id).then(setItem)
  }, [id])

  // Images pasted into vault notes are encrypted like any other vault file.
  const editorOptions = useMemo(
    () => ({
      mentions: false,
      upload: async (file: File) => {
        const stored = await api.vault.addFile(id, { name: file.name || 'image.png', mime: file.type, data: new Uint8Array(await file.arrayBuffer()), inline: true })
        return { url: stored.url, name: stored.name }
      }
    }),
    [id]
  )
  const onNotes = useCallback((doc: DocJSON) => saver.queue({ notes: doc }), [saver.queue])

  if (!item) return null

  const setField = (key: string, value: string): void => {
    setItem({ ...item, fields: { ...item.fields, [key]: value } })
    pendingFields.current = { ...pendingFields.current, [key]: value }
    saver.queue({ fields: pendingFields.current })
  }

  const setCustom = (custom: VaultCustomField[]): void => {
    setItem({ ...item, custom })
    saver.queue({ custom })
  }

  const copy = async (key: string, label: string): Promise<void> => {
    await saver.flush()
    await api.vault.copy(id, key)
    onToast(`${label} copied — clears from the clipboard in 30 s`)
  }

  const copyText = async (value: string, label: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    onToast(`${label} copied`)
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
            title="Delete item (and its files)"
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
        placeholder={`Name this ${KIND_LABEL[item.kind].toLowerCase()} (e.g. ${item.kind === 'login' ? 'Zoho Mail' : item.kind === 'card' ? 'Business Visa' : 'Insurance papers'})`}
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
            <div key={f.key} className="vault-field">
              <label className="vault-field-label" htmlFor={`vf-${f.key}`}>
                {f.label}
              </label>
              <div className="vault-field-row">
                <input
                  id={`vf-${f.key}`}
                  type={show ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  aria-label={f.label}
                  spellCheck={false}
                  autoComplete="off"
                />
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
                {value && (
                  <button type="button" className="icon-btn sm" title="Copy" aria-label={`Copy ${f.label}`} onClick={() => void copy(f.key, f.label)}>
                    <Copy />
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {item.custom.map((c, i) => {
          const show = !c.secret || revealed[c.id]
          const update = (patch: Partial<VaultCustomField>): void => setCustom(item.custom.map((x, j) => (j === i ? { ...x, ...patch } : x)))
          return (
            <div key={c.id} className="vault-field custom">
              <input
                className="vault-field-label-input"
                value={c.label}
                placeholder="Field name"
                onChange={(e) => update({ label: e.target.value })}
                aria-label="Custom field name"
              />
              <div className="vault-field-row">
                <input
                  type={show ? 'text' : 'password'}
                  value={c.value}
                  onChange={(e) => update({ value: e.target.value })}
                  aria-label={c.label || 'Custom field value'}
                  spellCheck={false}
                  autoComplete="off"
                />
                {c.secret && (
                  <button
                    type="button"
                    className="icon-btn sm"
                    title={show ? 'Hide' : 'Show'}
                    aria-label={`${show ? 'Hide' : 'Show'} ${c.label}`}
                    onClick={() => setRevealed({ ...revealed, [c.id]: !show })}
                  >
                    {show ? <EyeOff /> : <Eye />}
                  </button>
                )}
                <button
                  type="button"
                  className={`icon-btn sm ${c.secret ? 'active' : ''}`}
                  title={c.secret ? 'Hidden field — click to always show it' : 'Make this a hidden field (like a password)'}
                  aria-label={c.secret ? `Always show ${c.label}` : `Make ${c.label} hidden`}
                  onClick={() => update({ secret: !c.secret })}
                >
                  {c.secret ? <Lock /> : <LockOpen />}
                </button>
                {c.value && (
                  <button type="button" className="icon-btn sm" title="Copy" aria-label={`Copy ${c.label}`} onClick={() => void copyText(c.value, c.label || 'Value')}>
                    <Copy />
                  </button>
                )}
                <ConfirmButton title="Remove field" onConfirm={() => setCustom(item.custom.filter((_, j) => j !== i))} />
              </div>
            </div>
          )
        })}
        <button
          type="button"
          className="add-field-btn"
          onClick={() => setCustom([...item.custom, { id: crypto.randomUUID(), label: '', value: '', secret: false }])}
        >
          <Plus /> Add a field
        </button>
      </div>

      <VaultFiles itemId={id} pickOnOpen={pickFilesOnOpen} onChanged={onChanged} />

      <div className="vault-notes">
        <div className="vault-field-label">Notes</div>
        <NoteEditor docId={id} content={item.notes} editable onChange={onNotes} options={editorOptions} />
      </div>
    </div>
  )
}

const fileSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Encrypted attachments: drop or pick files; images and PDFs preview inside Plannr (decrypted only in memory). */
function VaultFiles({ itemId, pickOnOpen, onChanged }: { itemId: string; pickOnOpen?: boolean; onChanged: () => void }) {
  const [files, setFiles] = useState<VaultFile[]>([])
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [preview, setPreview] = useState<VaultFile | null>(null)
  const reload = useCallback(async () => setFiles(await api.vault.files(itemId)), [itemId])

  const add = useCallback(
    async (list: File[]) => {
      if (!list.length) return
      setBusy(true)
      try {
        for (const f of list) await api.vault.addFile(itemId, { name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) })
        await reload()
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [itemId, reload, onChanged]
  )

  useEffect(() => {
    void reload()
    if (pickOnOpen) void pickFiles().then(add)
  }, [reload, pickOnOpen, add])

  return (
    <section
      className={`vault-files ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void add(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="vault-files-head">
        <span className="vault-field-label">
          Files {files.length > 0 && <span className="muted">{files.length}</span>}
        </span>
        <button type="button" className="btn sm" onClick={() => void pickFiles().then(add)} disabled={busy}>
          <Paperclip /> {busy ? 'Encrypting…' : 'Add files'}
        </button>
      </div>
      {files.length === 0 ? (
        <div className="vault-files-empty">Drop PDFs, scans, photos or any file here — they’re encrypted like everything else.</div>
      ) : (
        <ul className="vault-file-list">
          {files.map((f) => (
            <li key={f.id} className="vault-file">
              <button type="button" className="vault-file-main" onClick={() => setPreview(f)} title="Preview">
                {f.mime.startsWith('image/') ? (
                  <img className="vault-file-thumb" src={f.url} alt="" />
                ) : (
                  <span className="vault-file-icon">{f.mime === 'application/pdf' ? <FileText /> : <FileIcon />}</span>
                )}
                <span className="vault-file-text">
                  <span className="vault-file-name">{f.name}</span>
                  <span className="vault-file-meta">{fileSize(f.size)}</span>
                </span>
              </button>
              <span className="row-actions">
                <button type="button" className="icon-btn sm" title="Open in its app (temporary copy)" aria-label={`Open ${f.name}`} onClick={() => void api.vault.openFile(f.id)}>
                  <ExternalLink />
                </button>
                <button type="button" className="icon-btn sm" title="Save a copy…" aria-label={`Save a copy of ${f.name}`} onClick={() => void api.vault.exportFile(f.id)}>
                  <Download />
                </button>
                <ConfirmButton
                  title="Delete file"
                  onConfirm={async () => {
                    await api.vault.removeFile(f.id)
                    await reload()
                    onChanged()
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </section>
  )
}

function FilePreview({ file, onClose }: { file: VaultFile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])
  const isImage = file.mime.startsWith('image/')
  const isPdf = file.mime === 'application/pdf'
  return (
    <div className="file-preview" role="dialog" aria-label={`Preview of ${file.name}`}>
      <div className="file-preview-bar">
        <span className="file-preview-name">{file.name}</span>
        <span className="lightbox-actions">
          <button type="button" className="btn sm" onClick={() => void api.vault.openFile(file.id)}>
            <ExternalLink /> Open in app
          </button>
          <button type="button" className="btn sm" onClick={() => void api.vault.exportFile(file.id)}>
            <Download /> Save a copy
          </button>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close preview" title="Close (Esc)" onClick={onClose}>
            <X />
          </button>
        </span>
      </div>
      {/* Clicking the dark area around the file closes it (the PDF viewer keeps keyboard focus once clicked, so Esc may not reach us) */}
      <div className="file-preview-body" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {isImage ? (
          <img src={file.url} alt={file.name} />
        ) : isPdf ? (
          <iframe src={file.url} title={file.name} />
        ) : (
          <div className="file-preview-none">
            <FileIcon />
            <p>No preview for this kind of file.</p>
            <p className="muted">Use “Open in app” to view it.</p>
          </div>
        )}
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
