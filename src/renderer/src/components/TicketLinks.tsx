import { useEffect, useState } from 'react'
import { Briefcase, UserRound } from 'lucide-react'
import { formatTicketNumber, type Customer, type LinkedCustomer, type TicketSummary } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { formatDay } from '../lib/format'
import { StatusPill } from './common'
import { CustomerPicker } from './CustomerPicker'

/** Small chips for a ticket that's for a business or for someone other than the customer */
export function ForChips({ t }: { t: Pick<TicketSummary, 'business' | 'customerCompany' | 'forId' | 'forName'> }) {
  if (!t.business && !t.forId) return null
  return (
    <span className="for-chips">
      {t.business && (
        <span className="for-chip" title="For their business">
          <Briefcase /> {t.customerCompany || 'Business'}
        </span>
      )}
      {t.forId && (
        <span className="for-chip" title="Who it's for">
          <UserRound /> for {t.forName}
        </span>
      )}
    </span>
  )
}

/**
 * Who a ticket is for: the customer themselves, their business, or one of their linked people. "Someone else…"
 * picks (or adds) a person and links them to the customer.
 */
export function ForPicker({
  customer,
  forId,
  business,
  disabled,
  onChange
}: {
  customer: Customer
  forId: string | null
  business: boolean
  disabled?: boolean
  onChange: (patch: { forId: string | null; business: boolean }) => void
}) {
  const [people, setPeople] = useState<LinkedCustomer[]>([])
  const [other, setOther] = useState(false)
  useEffect(() => {
    if (customer.id) void api.customers.linked(customer.id).then(setPeople)
  }, [customer.id, customer.related])

  // The person it's for might not be linked (yet): still show them
  const [forName, setForName] = useState('')
  useEffect(() => {
    if (forId && !people.some((p) => p.id === forId)) void api.customers.get(forId).then((c) => setForName(c?.name || 'Someone else'))
  }, [forId, people])

  const value = business ? 'business' : forId ?? ''
  if (other)
    return (
      <span className="prop-value">
        <CustomerPicker
          autoFocus
          label="Who it’s for"
          placeholder="Search or add a person…"
          exclude={[customer.id]}
          onPick={async (id) => {
            setOther(false)
            if (!customer.related.some((l) => l.id === id) && !people.some((p) => p.id === id)) {
              await api.customers.update(customer.id, { related: [...customer.related, { id, relation: '' }] })
              setPeople(await api.customers.linked(customer.id))
            }
            onChange({ forId: id, business: false })
          }}
        />
      </span>
    )
  return (
    <select
      className="prop-input"
      value={value}
      disabled={disabled}
      aria-label="Who it’s for"
      onChange={(e) => {
        const v = e.target.value
        if (v === '__other') return setOther(true)
        if (v === 'business') return onChange({ forId: null, business: true })
        onChange({ forId: v || null, business: false })
      }}
    >
      <option value="">{customer.name || 'The customer'}</option>
      {(customer.company || business) && <option value="business">Their business{customer.company ? ` · ${customer.company}` : ''}</option>}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.relation ? ` (${p.reverse ? `${p.relation} of` : p.relation})` : ''}
        </option>
      ))}
      {forId && !people.some((p) => p.id === forId) && <option value={forId}>{forName}</option>}
      <option value="__other">Someone else…</option>
    </select>
  )
}

/** Other tickets on this customer's account and for the person this ticket is for */
export function MoreTickets({ ticketId, customerId, customerName, forId }: { ticketId: string; customerId: string | null; customerName: string; forId: string | null }) {
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const lists = await Promise.all([customerId ? api.tickets.list({ customerId, status: 'all' }) : [], forId ? api.tickets.list({ customerId: forId, status: 'all' }) : []])
      const seen = new Set<string>([ticketId])
      const all = lists.flat().filter((t) => !seen.has(t.id) && (seen.add(t.id), true))
      if (!cancelled) setTickets(all.sort((a, b) => b.number - a.number))
    })()
    return () => {
      cancelled = true
    }
  }, [ticketId, customerId, forId])
  if (!tickets.length) return null
  return (
    <section className="more-tickets">
      <h2 className="section-title">More for {customerName || 'this customer'}</h2>
      <ul className="ticket-history">
        {tickets.slice(0, 12).map((t) => (
          <li key={t.id}>
            <button type="button" className="history-row" onClick={() => go({ view: 'ticket', id: t.id })}>
              <span className="mono">{formatTicketNumber(t.number)}</span>
              <span className="history-main">
                {t.device || 'Untitled'}
                {t.issue && <span className="muted"> · {t.issue}</span>}
                <ForChips t={t} />
              </span>
              <StatusPill status={t.status} />
              <span className="history-date">{formatDay(t.receivedOn)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
