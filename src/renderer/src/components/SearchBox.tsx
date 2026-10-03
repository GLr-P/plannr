import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Plus, Search } from 'lucide-react'
import type { SearchResult } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { newNote } from '../actions'
import { noteTitle, relativeTime } from '../lib/format'

type Row =
  | { kind: 'result'; result: SearchResult }
  | { kind: 'recent'; id: string; title: string; updatedAt: number }
  | { kind: 'create'; title: string }

/** Renders a snippet whose matches are wrapped in \u0001…\u0002 as <mark>. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? <mark key={i}>{p.slice(1, -1)}</mark> : <Fragment key={i}>{p}</Fragment>
      )}
    </>
  )
}

export function SearchBox() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const resultsFor = useRef('') // the query `results` belong to
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const recent = useData((s) => s.notes)

  // Ctrl+K / Ctrl+P focuses search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      resultsFor.current = query
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await api.search.query(query, { limit: 20 })
      if (cancelled) return
      setResults(r)
      resultsFor.current = query
    }, 50)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const rows: Row[] = useMemo(() => {
    if (!query.trim()) {
      return recent.slice(0, 6).map((n) => ({ kind: 'recent', id: n.id, title: n.title, updatedAt: n.updatedAt }))
    }
    return [...results.map((result) => ({ kind: 'result' as const, result })), { kind: 'create', title: query.trim() }]
  }, [query, results, recent])

  useEffect(() => setSelected(0), [rows])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const choose = (row: Row): void => {
    if (row.kind === 'create') void newNote(null, row.title)
    else go({ view: 'note', id: row.kind === 'result' ? row.result.id : row.id })
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && query.trim() && resultsFor.current !== query) {
      // Enter pressed before results arrived: search now and open the best match (never create by accident).
      e.preventDefault()
      const q = query
      void api.search.query(q, { limit: 1 }).then((r) => choose(r[0] ? { kind: 'result', result: r[0] } : { kind: 'create', title: q.trim() }))
    } else if (e.key === 'Enter' && rows[selected]) {
      e.preventDefault()
      choose(rows[selected])
    } else if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <div className="search" ref={boxRef}>
      <div className={`search-field ${open ? 'focused' : ''}`}>
        <Search className="search-icon" />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search everything…"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          aria-label="Search"
        />
        <kbd>Ctrl K</kbd>
      </div>
      {open && rows.length > 0 && (
        <div className="search-results" role="listbox">
          {!query.trim() && <div className="search-group">Recent</div>}
          {query.trim() && results.length > 0 && <div className="search-group">Notes</div>}
          {query.trim() && results.length === 0 && <div className="search-empty">No matches for “{query.trim()}”</div>}
          {rows.map((row, i) => (
            <button
              key={row.kind === 'result' ? row.result.id : row.kind === 'recent' ? row.id : 'create'}
              type="button"
              className="search-row"
              data-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(row)
              }}
            >
              {row.kind === 'create' ? (
                <>
                  <Plus className="row-icon" />
                  <span className="row-title">
                    Create note “{row.title}”
                  </span>
                </>
              ) : (
                <>
                  <FileText className="row-icon" />
                  <span className="row-main">
                    <span className="row-title">{noteTitle(row.kind === 'result' ? row.result.title : row.title)}</span>
                    {row.kind === 'result' && row.result.snippet && (
                      <span className="row-snippet">
                        <Snippet text={row.result.snippet} />
                      </span>
                    )}
                  </span>
                  <span className="row-meta">
                    {relativeTime(row.kind === 'result' ? row.result.updatedAt : row.updatedAt)}
                  </span>
                </>
              )}
            </button>
          ))}
          <div className="search-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> to move
            </span>
            <span>
              <kbd>Enter</kbd> to open
            </span>
            <span>
              <kbd>Esc</kbd> to close
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
