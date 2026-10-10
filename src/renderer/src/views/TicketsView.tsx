import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { ChevronDown, Plus, Search, X } from 'lucide-react'
import {
  formatTicketNumber,
  TICKET_STATUSES,
  statusLabel,
  type TemplateSummary,
  type TicketStatus,
  type TicketSummary
} from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { DRAG_MIME, newTicket } from '../actions'
import { formatDay, formatMoney } from '../lib/format'
import { StatusPill } from '../components/common'
import { PaidBadge } from './MoneyView'

type StatusFilter = TicketStatus | 'open' | 'all' | 'trash'

/** Filters survive opening a ticket and coming back. */
const useFilters = create<{ status: StatusFilter; query: string; from: string; to: string }>(() => ({
  status: 'open',
  query: '',
  from: '',
  to: ''
}))

const statusChips = (): { id: StatusFilter; label: string }[] => [
  { id: 'open', label: 'Open' },
  ...TICKET_STATUSES.map((s) => ({ id: s.id as StatusFilter, label: statusLabel(s.id) })),
  { id: 'all', label: 'All' },
  { id: 'trash', label: 'Trash' }
]

export function TicketsView() {
  const { status, query, from, to } = useFilters()
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null)

  const remote = useData((s) => s.remote) // changed on another device
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const list = await api.tickets.list({
        query,
        status: status === 'trash' ? 'all' : status,
        trashed: status === 'trash',
        from: from || undefined,
        to: to || undefined
      })
      if (!cancelled) setTickets(list)
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [status, query, from, to, remote])

  const filtered = Boolean(query || from || to)

  return (
    <div className="page list-page wide">
      <div className="list-header">
        <h1>Tickets</h1>
        <NewTicketButton />
      </div>

      <div className="filter-row">
        <div className="filter-field grow">
          <Search />
          <input
            placeholder="Search name, phone, email, ticket #, title…"
            value={query}
            onChange={(e) => useFilters.setState({ query: e.target.value })}
            aria-label="Search tickets"
          />
          {query && (
            <button type="button" className="icon-btn sm" aria-label="Clear search" onClick={() => useFilters.setState({ query: '' })}>
              <X />
            </button>
          )}
        </div>
        <label className="date-filter">
          From
          <input type="date" value={from} onChange={(e) => useFilters.setState({ from: e.target.value })} aria-label="Received from" />
        </label>
        <label className="date-filter">
          To
          <input type="date" value={to} onChange={(e) => useFilters.setState({ to: e.target.value })} aria-label="Received to" />
        </label>
        {(from || to) && (
          <button type="button" className="btn sm" onClick={() => useFilters.setState({ from: '', to: '' })}>
            Clear dates
          </button>
        )}
      </div>

      <div className="chips" role="tablist" aria-label="Status">
        {statusChips().map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={status === c.id}
            className={`chip-btn ${status === c.id ? 'active' : ''}`}
            onClick={() => useFilters.setState({ status: c.id })}
          >
            {c.label}
          </button>
        ))}
      </div>

      {tickets === null ? null : tickets.length === 0 ? (
        <div className="empty-state">
          {filtered ? 'No tickets match.' : status === 'trash' ? 'Trash is empty.' : status === 'open' ? 'No open tickets.' : 'No tickets yet.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>Ticket</th>
                <th>Status</th>
                <th>Received</th>
                <th>Pickup</th>
                <th className="num">Price</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  className="ticket-row"
                  onClick={() => go({ view: 'ticket', id: t.id })}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: 'ticket', id: t.id }))
                    e.dataTransfer.effectAllowed = 'link'
                  }}
                >
                  <td className="mono">{formatTicketNumber(t.number)}</td>
                  <td>
                    <div className="cell-main">{t.customerName || <span className="muted">No customer</span>}</div>
                    {t.customerPhone && <div className="cell-sub">{t.customerPhone}</div>}
                  </td>
                  <td>
                    <div className="cell-main">{t.device || <span className="muted">No device</span>}</div>
                    {t.issue && <div className="cell-sub">{t.issue}</div>}
                  </td>
                  <td>
                    <StatusPill status={t.status} />
                  </td>
                  <td className="nowrap">{formatDay(t.receivedOn)}</td>
                  <td className="nowrap">{formatDay(t.pickupOn)}</td>
                  <td className="num">
                    <div>{formatMoney(t.priceCents)}</div>
                    {(t.status === 'ready' || t.status === 'picked_up' || t.paidCents > 0) && <PaidBadge priceCents={t.priceCents} paidCents={t.paidCents} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** "New ticket" uses the default template; the arrow picks another template or a blank ticket. */
export function NewTicketButton({ customerId }: { customerId?: string }) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void api.templates.list().then(setTemplates)
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="split-btn" ref={ref}>
      <button type="button" className="btn primary" onClick={() => void newTicket({ customerId })}>
        <Plus /> New ticket
      </button>
      <button type="button" className="btn primary split-arrow" aria-label="Choose template" onClick={() => setOpen((o) => !o)}>
        <ChevronDown />
      </button>
      {open && (
        <div className="menu dropdown-menu">
          {templates.map((t) => (
            <button key={t.id} type="button" className="menu-item" onClick={() => void newTicket({ customerId, templateId: t.id })}>
              <span className="menu-label">{t.name}</span>
            </button>
          ))}
          <button type="button" className="menu-item" onClick={() => void newTicket({ customerId, templateId: null })}>
            <span className="menu-label">Blank ticket</span>
          </button>
        </div>
      )}
    </div>
  )
}
