import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, EyeOff, Eye, FileText, LayoutTemplate, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { ICONS } from '../lib/icons'
import { closeMenu } from './ContextMenu'
import { useSections } from '../store/sections'
import { allSections, SECTION_GROUPS, type SectionPreset } from '../../../shared/ticket-sections'
import type { TemplateSummary } from '../../../shared/api'

/**
 * + Add on a ticket: boxes you removed, presets (your ticket templates), your own sections and the built-in ones,
 * grouped and searchable. A ticked section is on the ticket already (clicking a text section jumps to it, a part is
 * removed). Built-in sections can be hidden from this list and your own deleted; "New section" makes a blank one.
 */
interface Props {
  /** Section ids on the ticket now (text sections and parts) */
  present: Set<string>
  /** Text sections can't be added to free-form (canvas) tickets */
  textSections: boolean
  templates: TemplateSummary[]
  hiddenBoxes: { id: string; label: string }[]
  onSection: (s: SectionPreset) => void
  onTemplate: (t: TemplateSummary) => void
  onBox: (id: string) => void
  onNewSection: () => void
}

type Row =
  | { kind: 'box'; id: string; title: string }
  | { kind: 'template'; t: TemplateSummary }
  | { kind: 'section'; s: ReturnType<typeof allSections>[number] }
  | { kind: 'new' }

const matches = (q: string, ...texts: string[]): boolean => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = texts.join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function AddToTicketPanel({ present, textSections, templates, hiddenBoxes, onSection, onTemplate, onBox, onNewSection }: Props) {
  const { lib, setHidden, remove } = useSections()
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(0)
  const [showHidden, setShowHidden] = useState(false)
  const [armed, setArmed] = useState<string | null>(null) // delete asks for a second click
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The menu is hidden for its first frame while it finds its place, so autoFocus alone doesn't stick
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const sections = useMemo(() => allSections(lib, true).filter((s) => textSections || s.part), [lib, textSections])
  const hiddenCount = sections.filter((s) => s.hidden).length

  const groups = useMemo(() => {
    const out: { label: string; rows: Row[] }[] = []
    const sectionRow = (s: (typeof sections)[number]): Row => ({ kind: 'section', s })
    if (query.trim()) {
      const rows: Row[] = [
        ...hiddenBoxes.filter((b) => matches(query, b.label)).map((b): Row => ({ kind: 'box', id: b.id, title: b.label })),
        ...sections.filter((s) => !s.hidden && matches(query, s.title, s.hint, s.keywords)).map(sectionRow),
        ...(textSections ? templates.filter((t) => matches(query, t.name)).map((t): Row => ({ kind: 'template', t })) : [])
      ]
      const title = (r: Row): string => (r.kind === 'box' ? r.title : r.kind === 'template' ? r.t.name : r.kind === 'section' ? r.s.title : '')
      rows.sort((a, b) => Number(!matches(query, title(a))) - Number(!matches(query, title(b))))
      if (textSections) rows.push({ kind: 'new' })
      return [{ label: 'Results', rows }]
    }
    if (hiddenBoxes.length) out.push({ label: 'Removed from this ticket', rows: hiddenBoxes.map((b) => ({ kind: 'box', id: b.id, title: b.label })) })
    if (textSections) out.push({ label: 'Presets', rows: templates.map((t) => ({ kind: 'template', t })) })
    const mine = sections.filter((s) => s.mine && !s.hidden)
    if (mine.length || textSections) out.push({ label: 'Your sections', rows: [...mine.map(sectionRow), ...(textSections ? [{ kind: 'new' } as Row] : [])] })
    for (const g of SECTION_GROUPS) {
      const rows = sections.filter((s) => !s.mine && !s.hidden && s.group === g.id).map(sectionRow)
      if (rows.length) out.push({ label: g.label, rows })
    }
    if (showHidden && hiddenCount) out.push({ label: 'Hidden', rows: sections.filter((s) => s.hidden).map(sectionRow) })
    return out
  }, [query, sections, templates, hiddenBoxes, textSections, showHidden, hiddenCount])
  const flat = groups.flatMap((g) => g.rows)

  useEffect(() => setFocus(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  const choose = (row: Row): void => {
    if (row.kind === 'section' && row.s.hidden) return void setHidden(row.s.id, false)
    closeMenu()
    if (row.kind === 'box') onBox(row.id)
    else if (row.kind === 'template') onTemplate(row.t)
    else if (row.kind === 'new') onNewSection()
    else onSection(row.s)
  }

  let index = -1
  const item = (row: Row, key: string, icon: ReactNode, title: string, hint: string, action: string, on: boolean, tool?: ReactNode): ReactNode => {
    index++
    const i = index
    return (
      <div key={key} className={`add-ticket-row ${on ? 'on' : ''}`} data-focused={focus === i} onMouseEnter={() => setFocus(i)}>
        <button type="button" role="option" aria-selected={focus === i} className="add-ticket-item" onClick={() => choose(row)}>
          <span className="add-ticket-icon">{on ? <Check /> : icon}</span>
          <span className="add-ticket-text">
            <span className="add-ticket-title">{title}</span>
            {hint && <span className="add-ticket-hint">{hint}</span>}
          </span>
          {action && <span className="add-ticket-action">{action}</span>}
        </button>
        {tool}
      </div>
    )
  }

  const render = (row: Row): ReactNode => {
    if (row.kind === 'new') return item(row, 'new', <Plus />, 'New section', 'A blank section you name and fill with your own boxes', '', false)
    if (row.kind === 'box') return item(row, `box:${row.id}`, <RotateCcw />, row.title, 'Put it back on this ticket', '', false)
    if (row.kind === 'template') {
      const Icon = ICONS[row.t.icon] ?? LayoutTemplate
      return item(row, `t:${row.t.id}`, <Icon />, row.t.name, 'Adds its sections to this ticket', '', false)
    }
    const s = row.s
    const Icon = ICONS[s.icon] ?? FileText
    const on = present.has(s.id)
    const action = s.hidden ? 'Unhide' : on ? (s.part ? 'Remove' : 'Go to it') : s.changed ? 'Your version' : ''
    const tool = s.hidden ? null : s.mine ? (
      <button
        type="button"
        className={`icon-btn sm add-ticket-tool ${armed === s.id ? 'danger' : ''}`}
        title={armed === s.id ? 'Click again to delete it from your sections' : 'Delete from your sections'}
        aria-label={`Delete ${s.title} from your sections`}
        onClick={() => (armed === s.id ? (void remove(s.id), setArmed(null)) : setArmed(s.id))}
      >
        <Trash2 />
      </button>
    ) : (
      <button type="button" className="icon-btn sm add-ticket-tool" title="Hide from this list" aria-label={`Hide ${s.title}`} onClick={() => void setHidden(s.id, true)}>
        <EyeOff />
      </button>
    )
    return item(row, `s:${s.id}`, <Icon />, s.title, s.hint, action, on, tool)
  }

  return (
    <div
      className="add-ticket"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setFocus((f) => (flat.length ? (f + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length : 0))
        } else if (e.key === 'Enter' && flat[focus]) {
          e.preventDefault()
          choose(flat[focus])
        }
      }}
    >
      <label className="add-ticket-search">
        <Search />
        <input ref={inputRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sections…" aria-label="Search sections" />
      </label>
      <div className="add-ticket-list" ref={listRef} role="listbox" aria-label="Sections">
        {groups.map((g) => (
          <div key={g.label} className="add-ticket-group">
            <div className="add-ticket-heading">{g.label}</div>
            {g.rows.map(render)}
          </div>
        ))}
        {!flat.length && <div className="menu-empty">No matching sections</div>}
      </div>
      {hiddenCount > 0 && !query && (
        <button type="button" className="add-ticket-footer" onClick={() => setShowHidden((v) => !v)}>
          <Eye /> {showHidden ? 'Hide the hidden sections' : `Show hidden sections (${hiddenCount})`}
        </button>
      )}
    </div>
  )
}
