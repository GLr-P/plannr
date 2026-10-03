import { useEffect, useRef, useState } from 'react'
import { Plus, User, X } from 'lucide-react'
import type { CustomerSummary } from '../../../shared/api'
import { api } from '../api'

/**
 * Type to find a customer (name, phone or email) or create a new one on the spot.
 * Results appear in place; nothing navigates away.
 */
export function CustomerPicker({
  onPick,
  autoFocus,
  placeholder = 'Search or add a customer…'
}: {
  onPick: (customerId: string) => void
  autoFocus?: boolean
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSummary[]>([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await api.customers.list({ query, limit: 8 })
      if (!cancelled) {
        setResults(r)
        setSelected(0)
      }
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const create = async (): Promise<void> => {
    const c = await api.customers.create({ name: query.trim() })
    onPick(c.id)
  }
  const options = query.trim() ? results.length + 1 : results.length // + "create" row

  const choose = (i: number): void => {
    if (i < results.length) onPick(results[i].id)
    else void create()
  }

  return (
    <div className="picker" ref={boxRef}>
      <input
        className="prop-input"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => Math.min(s + 1, options - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter' && options > 0) {
            e.preventDefault()
            choose(selected)
          } else if (e.key === 'Escape') setOpen(false)
        }}
        aria-label="Customer"
      />
      {open && options > 0 && (
        <div className="picker-menu menu" role="listbox">
          {results.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className="menu-item"
              data-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(i)
              }}
            >
              <span className="menu-icon">
                <User />
              </span>
              <span className="menu-label">{c.name || 'Unnamed customer'}</span>
              <span className="menu-hint">{c.phone || c.email}</span>
            </button>
          ))}
          {query.trim() && (
            <button
              type="button"
              className="menu-item"
              data-selected={selected === results.length}
              onMouseEnter={() => setSelected(results.length)}
              onMouseDown={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <span className="menu-icon">
                <Plus />
              </span>
              <span className="menu-label">New customer “{query.trim()}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ClearButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="icon-btn sm" title={label} aria-label={label} onClick={onClick}>
      <X />
    </button>
  )
}
