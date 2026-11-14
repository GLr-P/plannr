import { useEffect, useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import { ticketLayout, type EntFeed, type NewsFeed, type Template, type TemplateSummary, type TicketLayout, type VaultStatus } from '../../../shared/api'
import { allSections, SECTION_GROUPS, TICKET_PRESETS, type TicketPreset } from '../../../shared/ticket-sections'
import { NOTE_LIBRARY } from '../../../shared/note-library'
import type { UsePlan } from '../../../shared/use-cases'
import { api } from '../api'
import { ICONS } from '../lib/icons'
import { makePreset } from '../lib/applyUseCases'
import { useSections } from '../store/sections'
import { TicketLayoutPanel } from './TicketLayoutPanel'
import { NewsSetup } from '../views/NewsView'
import { RecoveryKeyScreen, SetupScreen } from '../views/VaultView'

/* The bigger steps of the setup walkthrough (Onboarding.tsx): each changes the real settings as you go. */

const Icon = ({ name }: { name: string }) => {
  const I = ICONS[name] ?? FileText
  return <I />
}

/** The page new tickets start from: pick the preset, rename the boxes, see what it looks like */
export function TicketPageStep({ one }: { one: string }) {
  const [list, setList] = useState<TemplateSummary[]>([])
  const [id, setId] = useState('')
  const [tpl, setTpl] = useState<Template | null>(null)
  const [layout, setLayout] = useState<TicketLayout>(ticketLayout(null))
  useEffect(() => {
    void Promise.all([api.templates.list('ticket'), api.settings.get('defaultTemplateId')]).then(([l, d]) => {
      setList(l)
      setId(typeof d === 'string' && l.some((t) => t.id === d) ? d : (l[0]?.id ?? ''))
    })
  }, [])
  useEffect(() => {
    if (!id) return
    void api.templates.get(id).then((t) => {
      setTpl(t)
      setLayout(ticketLayout(t?.layout))
    })
  }, [id])
  return (
    <>
      <h2>Your {one} page</h2>
      <p className="muted">
        This is how a new {one} starts. Name the boxes what you call them (e.g. <b>Ticket name</b>, <b>Order</b>, <b>Assignment</b>), give them example text, and choose what shows. You can change it later with
        Customize on any {one}.
      </p>
      <label className="mfield">
        New {one}s start from
        <select
          value={id}
          aria-label="New tickets start from"
          onChange={(e) => {
            setId(e.target.value)
            void api.settings.set('defaultTemplateId', e.target.value)
          }}
        >
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="setup-preview" aria-label="Preview">
        <span className="setup-preview-label">{layout.titleLabel}</span>
        <div className="setup-preview-title">{layout.titlePlaceholder}</div>
        {layout.showSummary && (
          <>
            <span className="setup-preview-label">{layout.summaryLabel}</span>
            <div className="setup-preview-line">{layout.summaryPlaceholder}</div>
          </>
        )}
        <div className="setup-preview-props">
          {layout.showCustomer && <span>{layout.customerLabel}</span>}
          {layout.showReceived && <span>{layout.receivedLabel}</span>}
          {(layout.showPickup || layout.parts.includes('pickup')) && <span>{layout.pickupLabel}</span>}
          {layout.showPrice && <span>{layout.priceLabel}</span>}
          {layout.showStatus && <span>Status</span>}
        </div>
      </div>
      {tpl && (
        <TicketLayoutPanel
          key={tpl.id}
          open
          layout={tpl.layout}
          onChange={(l) => {
            setLayout(ticketLayout(l))
            void api.templates.update(tpl.id, { layout: l })
          }}
        />
      )}
    </>
  )
}

/** Presets: bundles of sections for kinds of work, made into templates you start new tickets from */
export function PresetsStep({ plan, many }: { plan: UsePlan; many: string }) {
  const [list, setList] = useState<TemplateSummary[]>([])
  const load = (): void => void api.templates.list('ticket').then(setList)
  useEffect(load, [])
  const has = (p: TicketPreset): TemplateSummary | undefined => list.find((t) => t.name === p.name)
  const toggle = async (p: TicketPreset): Promise<void> => {
    const t = has(p)
    if (t) await api.templates.remove(t.id)
    else await makePreset(p)
    load()
  }
  const mine = new Set(plan.presets.map((p) => p.id))
  const row = (p: TicketPreset) => (
    <label key={p.id} className="setup-check">
      <input type="checkbox" checked={Boolean(has(p))} aria-label={p.name} onChange={() => void toggle(p)} />
      <Icon name={p.icon} />
      <span>
        <b>{p.name}</b>
        <span className="small muted">{p.hint}</span>
      </span>
    </label>
  )
  const own = list.filter((t) => !TICKET_PRESETS.some((p) => p.name === t.name))
  return (
    <>
      <h2>Presets</h2>
      <p className="muted">
        A preset is a kind of {many.toLowerCase().replace(/s$/, '')} with the sections it needs already in it. Tick the ones you want in + New; untick to remove. You can make your own from any{' '}
        {many.toLowerCase().replace(/s$/, '')} later (⋯ → Save as preset).
      </p>
      <h3 className="onboard-sub">For what you picked</h3>
      <div className="setup-grid">{TICKET_PRESETS.filter((p) => mine.has(p.id)).map(row)}</div>
      <details className="setup-more">
        <summary>More presets ({TICKET_PRESETS.filter((p) => !mine.has(p.id)).length})</summary>
        <div className="setup-grid">{TICKET_PRESETS.filter((p) => !mine.has(p.id)).map(row)}</div>
      </details>
      {own.length > 0 && (
        <p className="small muted">
          Also yours: {own.map((t) => t.name).join(', ')}
        </p>
      )}
    </>
  )
}

/** Which sections + Add offers */
export function SectionsStep({ one }: { one: string }) {
  const { lib, load, setHidden } = useSections()
  useEffect(() => void load(), [load])
  const all = allSections(lib, true)
  return (
    <>
      <h2>Sections</h2>
      <p className="muted">
        Sections are blocks you add to a {one} with <b>+ Add</b>: design notes, a due date, measurements, a checklist… Tick the ones you want offered. On any {one} you can also make your own (+ Add → New section).
      </p>
      {[...SECTION_GROUPS, { id: 'mine', label: 'Yours' }].map((g) => {
        const rows = all.filter((s) => (g.id === 'mine' ? s.mine : !s.mine && s.group === g.id))
        if (!rows.length) return null
        return (
          <div key={g.id}>
            <h3 className="onboard-sub">{g.label}</h3>
            <div className="setup-grid">
              {rows.map((s) => (
                <label key={s.id} className="setup-check" title={s.hint}>
                  <input type="checkbox" checked={!s.hidden} aria-label={s.title} onChange={() => void setHidden(s.id, !s.hidden)} />
                  <Icon name={s.icon} />
                  <span>
                    <b>{s.title}</b>
                    <span className="small muted">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

/** Folders to start with, and note templates */
export function NotesStep({ plan, folders, setFolders }: { plan: UsePlan; folders: string[]; setFolders: (f: string[]) => void }) {
  const [have, setHave] = useState<string[]>([])
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [extra, setExtra] = useState('')
  const loadT = (): void => void api.templates.list('note').then(setTemplates)
  useEffect(() => {
    void api.folders.list().then((f) => setHave(f.map((x) => x.name)))
    loadT()
  }, [])
  const offered = [...new Set([...plan.folders, ...folders])].filter((f) => !have.includes(f))
  const toggleT = async (name: string): Promise<void> => {
    const t = templates.find((x) => x.name === name)
    const def = NOTE_LIBRARY.find((x) => x.name === name)!
    if (t) await api.templates.remove(t.id)
    else await api.templates.create({ name: def.name, kind: 'note', icon: def.icon, content: def.content })
    loadT()
  }
  return (
    <>
      <h2>Notes</h2>
      <p className="muted">Notes hold anything: checklists, tables, photos, drawings. Start with a few folders, and pick the kinds of note you’ll write (New note → from a template).</p>
      <h3 className="onboard-sub">Folders to start with</h3>
      <div className="chip-row">
        {offered.map((f) => {
          const on = folders.includes(f)
          return (
            <button key={f} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setFolders(on ? folders.filter((x) => x !== f) : [...folders, f])}>
              {f}
            </button>
          )
        })}
        {have.length > 0 && <span className="small muted">Already there: {have.join(', ')}</span>}
      </div>
      <div className="chip-row">
        <input className="setting-input" value={extra} placeholder="Another folder, e.g. a class or a client" aria-label="New folder name" onChange={(e) => setExtra(e.target.value)} />
        <button
          type="button"
          className="btn sm"
          disabled={!extra.trim()}
          onClick={() => {
            setFolders([...new Set([...folders, extra.trim()])])
            setExtra('')
          }}
        >
          <Plus /> Add
        </button>
      </div>
      <h3 className="onboard-sub">Kinds of note</h3>
      <div className="setup-grid">
        {NOTE_LIBRARY.map((t) => (
          <label key={t.name} className="setup-check">
            <input type="checkbox" checked={templates.some((x) => x.name === t.name)} aria-label={t.name} onChange={() => void toggleT(t.name)} />
            <Icon name={t.icon} />
            <span>
              <b>{t.name}</b>
            </span>
          </label>
        ))}
      </div>
    </>
  )
}

export function NewsStep() {
  const [feed, setFeed] = useState<NewsFeed | null>(null)
  const [change, setChange] = useState(false)
  useEffect(() => void api.news.feed().then(setFeed), [])
  if (!feed) return null
  if (feed.prefs.place && !change)
    return (
      <>
        <h2>News</h2>
        <p>
          Your news and weather are for <b>{feed.prefs.place.name}</b>.{' '}
          <button type="button" className="link-btn" onClick={() => setChange(true)}>
            Change
          </button>
        </p>
        <p className="muted small">More pages (games, tech, anything with a feed) and what to leave out are in News → Settings.</p>
      </>
    )
  return (
    <NewsSetup
      onDone={(f) => {
        setFeed(f)
        setChange(false)
      }}
    />
  )
}

export function EntertainmentStep() {
  const [feed, setFeed] = useState<EntFeed | null>(null)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'youtube' | 'twitch' | 'reddit' | 'podcast'>('youtube')
  const [error, setError] = useState('')
  useEffect(() => void api.entertainment.feed().then(setFeed), [])
  const add = async (): Promise<void> => {
    setError('')
    try {
      setFeed(await api.entertainment.add(text.trim(), kind))
      setText('')
    } catch {
      setError('Couldn’t find that. Try the channel’s link.')
    }
  }
  return (
    <>
      <h2>Entertainment</h2>
      <p className="muted">New videos from YouTube channels you like, who’s live on Twitch, subreddits and podcasts, plus your movies, shows, books and games. Add a few now, or later on the Entertainment page.</p>
      <div className="chip-row">
        <select className="setting-input" value={kind} aria-label="Kind" onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="youtube">YouTube</option>
          <option value="twitch">Twitch</option>
          <option value="reddit">Reddit</option>
          <option value="podcast">Podcast</option>
        </select>
        <input className="setting-input" value={text} placeholder="A link, @handle or name" aria-label="Channel to follow" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && void add()} />
        <button type="button" className="btn sm" disabled={!text.trim()} onClick={() => void add()}>
          <Plus /> Follow
        </button>
      </div>
      {error && <p className="small danger-text">{error}</p>}
      {feed && feed.channels.length > 0 && (
        <div className="chip-row">
          {feed.channels.map((c) => (
            <span key={c.id} className="chip">
              {c.name}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

export function VaultStep() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => void api.vault.status().then(setStatus), [])
  if (!status) return null
  if (key) return <RecoveryKeyScreen recoveryKey={key} onDone={() => setKey(null)} />
  if (status.setUp)
    return (
      <>
        <h2>Vault</h2>
        <p>Your vault is set up. Passwords, cards and private documents go there, locked with your passcode.</p>
      </>
    )
  return (
    <>
      <p className="muted">Optional: set it up now, or the first time you open Vault.</p>
      <SetupScreen
        onDone={(k) => {
          setKey(k)
          void api.vault.status().then(setStatus)
        }}
      />
    </>
  )
}
