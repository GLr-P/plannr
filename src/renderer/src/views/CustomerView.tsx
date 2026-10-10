import { useEffect, useState } from 'react'
import { Mail, MapPin, Phone } from 'lucide-react'
import { formatTicketNumber, type Customer, type CustomerInput, type TicketSummary } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { useAutosave } from '../lib/useAutosave'
import { formatDay, formatMoney } from '../lib/format'
import { ConfirmButton, SaveIndicator, StatusPill } from '../components/common'
import { undoToast } from '../lib/toast'
import { Backlinks } from '../components/Backlinks'
import { CustomerEmails } from '../components/CustomerEmails'
import { LinkedEvents } from '../components/LinkedEvents'
import { NewTicketButton } from './TicketsView'

export function CustomerView({ id }: { id: string }) {
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setCustomer(undefined)
    void api.customers.get(id).then((c) => !cancelled && setCustomer(c))
    return () => {
      cancelled = true
    }
  }, [id])

  if (customer === undefined) return <div className="page" />
  if (customer === null || customer.deletedAt !== null)
    return (
      <div className="page empty-state">
        <p>This customer was deleted.</p>
        <button type="button" className="btn" onClick={() => go({ view: 'customers' })}>
          All customers
        </button>
      </div>
    )
  return <CustomerPage key={customer.id} customer={customer} />
}

function CustomerPage({ customer }: { customer: Customer }) {
  const [c, setC] = useState(customer)
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const saver = useAutosave<CustomerInput>(async (patch) => {
    const saved = await api.customers.update(customer.id, patch)
    setC((cur) => ({ ...cur, updatedAt: saved.updatedAt }))
  })

  const remote = useData((s) => s.remote) // changed on another device
  useEffect(() => {
    void api.tickets.list({ customerId: customer.id }).then(setTickets)
  }, [customer.id, remote])

  const set = (patch: CustomerInput): void => {
    setC((cur) => ({ ...cur, ...patch }))
    saver.queue(patch)
  }

  return (
    <div className="page customer-page">
      <div className="page-toolbar">
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => go({ view: 'customers' })}>
            Customers
          </button>
        </div>
        <div className="toolbar-right">
          <SaveIndicator status={saver.status} updatedAt={c.updatedAt} />
          <ConfirmButton
            title="Delete customer (their tickets are kept)"
            onConfirm={async () => {
              await saver.flush()
              await api.customers.trash(customer.id)
              go({ view: 'customers' })
              undoToast(`${customer.name || 'Customer'} deleted`, async () => {
                await api.customers.restore(customer.id)
                go({ view: 'customer', id: customer.id })
              })
            }}
          />
        </div>
      </div>

      <div className="doc">
        <input
          className="doc-title"
          value={c.name}
          placeholder="Customer name"
          autoFocus={!customer.name}
          onChange={(e) => set({ name: e.target.value })}
          aria-label="Customer name"
        />

        <div className="props one-col">
          <label className="prop">
            <span className="prop-label">
              <Phone /> Phone
            </span>
            <input className="prop-input" value={c.phone} placeholder="Add phone" onChange={(e) => set({ phone: e.target.value })} aria-label="Phone" />
          </label>
          <label className="prop">
            <span className="prop-label">
              <Mail /> Email
            </span>
            <input className="prop-input" value={c.email} placeholder="Add email" onChange={(e) => set({ email: e.target.value })} aria-label="Email" />
          </label>
          <label className="prop">
            <span className="prop-label">
              <MapPin /> Address
            </span>
            <input className="prop-input" value={c.address} placeholder="Add address" onChange={(e) => set({ address: e.target.value })} aria-label="Address" />
          </label>
        </div>

        <textarea
          className="notes-area"
          value={c.notes}
          placeholder="Notes about this customer…"
          onChange={(e) => set({ notes: e.target.value })}
          aria-label="Customer notes"
        />

        <div className="list-header section-gap">
          <h2 className="section-title flush">Repair history</h2>
          <NewTicketButton customerId={customer.id} />
        </div>
        {tickets.length === 0 ? (
          <div className="empty-state left">No tickets yet.</div>
        ) : (
          <ul className="ticket-history">
            {tickets.map((t) => (
              <li key={t.id}>
                <button type="button" className="history-row" onClick={() => go({ view: 'ticket', id: t.id })}>
                  <span className="mono">{formatTicketNumber(t.number)}</span>
                  <span className="history-main">
                    {t.device || 'Untitled'}
                    {t.issue && <span className="muted"> · {t.issue}</span>}
                  </span>
                  <StatusPill status={t.status} />
                  <span className="history-date">{formatDay(t.receivedOn)}</span>
                  <span className="history-price">{formatMoney(t.priceCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <CustomerEmails email={c.email} name={c.name} />
        <LinkedEvents id={customer.id} />
        <Backlinks id={customer.id} />
      </div>
    </div>
  )
}
