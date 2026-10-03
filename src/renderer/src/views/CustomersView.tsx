import { useEffect, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import type { CustomerSummary } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { DRAG_MIME, newCustomer } from '../actions'
import { formatDay } from '../lib/format'

export function CustomersView() {
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const list = await api.customers.list({ query })
      if (!cancelled) setCustomers(list)
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  return (
    <div className="page list-page wide">
      <div className="list-header">
        <h1>Customers</h1>
        <button type="button" className="btn primary" onClick={() => void newCustomer()}>
          <Plus /> New customer
        </button>
      </div>

      <div className="filter-field">
        <Search />
        <input placeholder="Search name, phone, email, address…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search customers" />
        {query && (
          <button type="button" className="icon-btn sm" aria-label="Clear search" onClick={() => setQuery('')}>
            <X />
          </button>
        )}
      </div>

      {customers === null ? null : customers.length === 0 ? (
        <div className="empty-state">{query ? 'No customers match.' : 'No customers yet.'}</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th className="num">Tickets</th>
                <th>Last visit</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="customer-row"
                  onClick={() => go({ view: 'customer', id: c.id })}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: 'customer', id: c.id }))
                    e.dataTransfer.effectAllowed = 'link'
                  }}
                >
                  <td className="cell-main">{c.name || <span className="muted">Unnamed customer</span>}</td>
                  <td className="nowrap">{c.phone}</td>
                  <td>{c.email}</td>
                  <td className="num">{c.ticketCount || ''}</td>
                  <td className="nowrap">{formatDay(c.lastVisit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
