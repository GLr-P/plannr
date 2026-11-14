import { useMemo, useRef, useState, useEffect } from 'react'
import { Check, FileText, Search } from 'lucide-react'
import { ICONS } from '../lib/icons'
import { closeMenu } from './ContextMenu'
import { SECTION_GROUPS, TICKET_PRESETS, TICKET_SECTIONS, type SectionPreset, type TicketPreset } from '../../../shared/ticket-sections'

/**
 * The + Add panel on a ticket: presets (bundles for a kind of job) and every section, grouped, with a search box.
 * Sections already on the ticket are ticked: clicking a ticked text section jumps to it, a ticked part is removed.
 */
interface Props {
  /** Section ids on the ticket now (text sections and parts) */
  present: Set<string>
  /** Text sections can't be added to free-form (canvas) tickets */
  textSections: boolean
  onSection: (s: SectionPreset) => void
  onPreset: (p: TicketPreset) => void
}

type Row = { kind: 'preset'; preset: TicketPreset } | { kind: 'section'; section: SectionPreset }

const matches = (q: string, ...texts: string[]): boolean => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = texts.join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function AddToTicketPanel({ present, textSections, onSection, onPreset }: Props) {
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The menu is hidden for its first frame while it finds its place, so autoFocus alone doesn't stick
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const groups = useMemo(() => {
    const out: { label: string; rows: Row[] }[] = []
    if (query.trim()) {
      // Searching: one list, names that match first ("quote lines" → Quote lines, not Parts used's hint)
      const rows: Row[] = [
        ...TICKET_SECTIONS.filter((s) => (textSections || s.part) && matches(query, s.title, s.hint, s.keywords)).map((section): Row => ({ kind: 'section', section })),
        ...(textSections ? TICKET_PRESETS.filter((p) => p.id !== 'quick' && matches(query, p.name, p.hint)).map((preset): Row => ({ kind: 'preset', preset })) : [])
      ]
      const byName = (r: Row): number => (matches(query, r.kind === 'preset' ? r.preset.name : r.section.title) ? 0 : 1)
      rows.sort((a, b) => byName(a) - byName(b))
      return rows.length ? [{ label: 'Results', rows }] : []
    }
    const presets = TICKET_PRESETS.filter((p) => p.id !== 'quick' && matches(query, p.name, p.hint))
    if (presets.length && textSections) out.push({ label: 'Presets', rows: presets.map((preset) => ({ kind: 'preset', preset })) })
    for (const g of SECTION_GROUPS) {
      const rows = TICKET_SECTIONS.filter((s) => s.group === g.id && (textSections || s.part) && matches(query, s.title, s.hint, s.keywords)).map(
        (section): Row => ({ kind: 'section', section })
      )
      if (rows.length) out.push({ label: g.label, rows })
    }
    return out
  }, [query, textSections])
  const flat = groups.flatMap((g) => g.rows)

  useEffect(() => setFocus(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  const choose = (row: Row): void => {
    closeMenu()
    if (row.kind === 'preset') onPreset(row.preset)
    else onSection(row.section)
  }

  let index = -1
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
            {g.rows.map((row) => {
              index++
              const i = index
              const id = row.kind === 'preset' ? row.preset.id : row.section.id
              const title = row.kind === 'preset' ? row.preset.name : row.section.title
              const hint = row.kind === 'preset' ? row.preset.hint : row.section.hint
              const Icon = ICONS[row.kind === 'preset' ? row.preset.icon : row.section.icon] ?? FileText
              const on = row.kind === 'section' && present.has(id)
              const action = row.kind === 'preset' ? 'Add its sections' : on ? (row.section.part ? 'Remove' : 'Go to it') : ''
              return (
                <button
                  key={`${row.kind}:${id}`}
                  type="button"
                  role="option"
                  aria-selected={focus === i}
                  data-focused={focus === i}
                  className={`add-ticket-item ${on ? 'on' : ''}`}
                  onMouseEnter={() => setFocus(i)}
                  onClick={() => choose(row)}
                >
                  <span className="add-ticket-icon">{on ? <Check /> : <Icon />}</span>
                  <span className="add-ticket-text">
                    <span className="add-ticket-title">{title}</span>
                    <span className="add-ticket-hint">{hint}</span>
                  </span>
                  {action && <span className="add-ticket-action">{action}</span>}
                </button>
              )
            })}
          </div>
        ))}
        {!flat.length && <div className="menu-empty">No matching sections</div>}
      </div>
    </div>
  )
}
