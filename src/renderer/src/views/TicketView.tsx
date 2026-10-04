import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarCheck, CalendarDays, DollarSign, ExternalLink, Mail, Phone, RotateCcw, User } from 'lucide-react'
import {
  formatTicketNumber,
  type Customer,
  type CustomerInput,
  type DocJSON,
  type Ticket,
  type TicketUpdate
} from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { useAutosave } from '../lib/useAutosave'
import { formatMoney, parseMoney } from '../lib/format'
import { NoteEditor } from '../editor/NoteEditor'
import { ConfirmButton, SaveIndicator, StatusSelect } from '../components/common'
import { CustomerPicker, ClearButton } from '../components/CustomerPicker'
import { PhotoGallery } from '../components/PhotoGallery'
import { Backlinks } from '../components/Backlinks'
import { LinkedEvents } from '../components/LinkedEvents'

export function TicketView({ id }: { id: string }) {
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined)
  const reload = useCallback(() => api.tickets.get(id).then(setTicket), [id])
  useEffect(() => {
    let cancelled = false
    setTicket(undefined)
    void api.tickets.get(id).then((t) => !cancelled && setTicket(t))
    return () => {
      cancelled = true
    }
  }, [id])

  if (ticket === undefined) return <div className="page" />
  if (ticket === null)
    return (
      <div className="page empty-state">
        <p>This ticket doesn’t exist anymore.</p>
        <button type="button" className="btn" onClick={() => go({ view: 'tickets' })}>
          All tickets
        </button>
      </div>
    )
  return <TicketPage key={`${ticket.id}:${ticket.deletedAt}`} ticket={ticket} reload={reload} />
}

type Fields = Omit<TicketUpdate, 'content'>

function TicketPage({ ticket, reload }: { ticket: Ticket; reload: () => Promise<void> }) {
  const [fields, setFields] = useState<Required<Fields>>({
    customerId: ticket.customerId,
    status: ticket.status,
    device: ticket.device,
    issue: ticket.issue,
    priceCents: ticket.priceCents,
    receivedOn: ticket.receivedOn,
    pickupOn: ticket.pickupOn
  })
  const [priceText, setPriceText] = useState(formatMoney(ticket.priceCents))
  const [updatedAt, setUpdatedAt] = useState(ticket.updatedAt)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const trashed = ticket.deletedAt !== null

  const saver = useAutosave<TicketUpdate>(async (patch) => {
    const s = await api.tickets.update(ticket.id, patch)
    setUpdatedAt(s.updatedAt)
    if (patch.status) void useData.getState().refreshCounts()
  })

  // Customer details typed on the ticket are saved to the customer record.
  const customerIdRef = useRef(ticket.customerId)
  const customerSaver = useAutosave<CustomerInput>(async (patch) => {
    if (customerIdRef.current) await api.customers.update(customerIdRef.current, patch)
  })

  useEffect(() => {
    customerIdRef.current = fields.customerId
    if (!fields.customerId) return setCustomer(null)
    void api.customers.get(fields.customerId).then(setCustomer)
  }, [fields.customerId])

  const set = (patch: Fields, immediate = false): void => {
    setFields((f) => ({ ...f, ...patch }))
    saver.queue(patch)
    if (immediate) void saver.flush()
  }

  const setCustomerField = (patch: CustomerInput): void => {
    setCustomer((c) => (c ? { ...c, ...patch } : c))
    customerSaver.queue(patch)
  }

  const pickCustomer = async (customerId: string | null): Promise<void> => {
    await customerSaver.flush() // finish saving edits to the previous customer first
    set({ customerId }, true)
  }

  const onContent = useCallback((doc: DocJSON) => saver.queue({ content: doc }), [saver.queue])

  const restore = async (): Promise<void> => {
    await api.tickets.restore(ticket.id)
    void useData.getState().refreshCounts()
    await reload()
  }

  const trash = async (): Promise<void> => {
    await saver.flush()
    await api.tickets.trash(ticket.id)
    void useData.getState().refreshCounts()
    go({ view: 'tickets' })
  }

  return (
    <div className="page ticket-page">
      <div className="page-toolbar">
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => go({ view: 'tickets' })}>
            Tickets
          </button>
          <span className="crumb-sep">/</span>
          <span className="ticket-no">{formatTicketNumber(ticket.number)}</span>
        </div>
        <div className="toolbar-right">
          <SaveIndicator status={saver.status} updatedAt={updatedAt} />
          {!trashed && (
            <>
              <StatusSelect value={fields.status} onChange={(status) => set({ status }, true)} />
              <ConfirmButton title="Move ticket to trash" onConfirm={trash} />
            </>
          )}
        </div>
      </div>

      {trashed && (
        <div className="banner">
          This ticket is in the trash.
          <button type="button" className="btn sm" onClick={() => void restore()}>
            <RotateCcw /> Restore
          </button>
        </div>
      )}

      <div className="doc">
        <input
          className="doc-title"
          value={fields.device}
          placeholder="Device (e.g. iPhone 13 Pro)"
          readOnly={trashed}
          autoFocus={!ticket.device && !trashed}
          onChange={(e) => set({ device: e.target.value })}
          aria-label="Device"
        />
        <input
          className="doc-subtitle"
          value={fields.issue}
          placeholder="What’s wrong with it?"
          readOnly={trashed}
          onChange={(e) => set({ issue: e.target.value })}
          aria-label="Issue"
        />

        <div className="props">
          <div className="prop">
            <span className="prop-label">
              <User /> Customer
            </span>
            {customer ? (
              <span className="prop-value">
                <input
                  className="prop-input"
                  value={customer.name}
                  placeholder="Name"
                  readOnly={trashed}
                  onChange={(e) => setCustomerField({ name: e.target.value })}
                  aria-label="Customer name"
                />
                <button
                  type="button"
                  className="icon-btn sm"
                  title="Open customer"
                  aria-label="Open customer"
                  onClick={() => go({ view: 'customer', id: customer.id })}
                >
                  <ExternalLink />
                </button>
                {!trashed && <ClearButton label="Change customer" onClick={() => void pickCustomer(null)} />}
              </span>
            ) : trashed ? (
              <span className="prop-value muted">—</span>
            ) : (
              <CustomerPicker onPick={(id) => void pickCustomer(id)} />
            )}
          </div>
          <div className="prop">
            <span className="prop-label">
              <CalendarDays /> Received
            </span>
            <input
              type="date"
              className="prop-input"
              value={fields.receivedOn ?? ''}
              readOnly={trashed}
              onChange={(e) => set({ receivedOn: e.target.value || null }, true)}
              aria-label="Received date"
            />
          </div>
          <div className="prop">
            <span className="prop-label">
              <Phone /> Phone
            </span>
            <input
              className="prop-input"
              value={customer?.phone ?? ''}
              placeholder={customer ? 'Add phone' : 'Pick a customer first'}
              disabled={!customer || trashed}
              onChange={(e) => setCustomerField({ phone: e.target.value })}
              aria-label="Customer phone"
            />
          </div>
          <div className="prop">
            <span className="prop-label">
              <CalendarCheck /> Pickup
            </span>
            <input
              type="date"
              className="prop-input"
              value={fields.pickupOn ?? ''}
              readOnly={trashed}
              onChange={(e) => set({ pickupOn: e.target.value || null }, true)}
              aria-label="Pickup date"
            />
          </div>
          <div className="prop">
            <span className="prop-label">
              <Mail /> Email
            </span>
            <input
              className="prop-input"
              value={customer?.email ?? ''}
              placeholder={customer ? 'Add email' : 'Pick a customer first'}
              disabled={!customer || trashed}
              onChange={(e) => setCustomerField({ email: e.target.value })}
              aria-label="Customer email"
            />
          </div>
          <div className="prop">
            <span className="prop-label">
              <DollarSign /> Price
            </span>
            <input
              className="prop-input"
              value={priceText}
              placeholder="$0.00"
              inputMode="decimal"
              readOnly={trashed}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={() => {
                const cents = parseMoney(priceText)
                setPriceText(formatMoney(cents))
                if (cents !== fields.priceCents) set({ priceCents: cents }, true)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Price"
            />
          </div>
        </div>

        <PhotoGallery ticketId={ticket.id} />

        <div className="ticket-body">
          <NoteEditor docId={ticket.id} content={ticket.content} editable={!trashed} onChange={onContent} />
        </div>

        <LinkedEvents id={ticket.id} refreshKey={fields.pickupOn} />
        <Backlinks id={ticket.id} />
      </div>
    </div>
  )
}
