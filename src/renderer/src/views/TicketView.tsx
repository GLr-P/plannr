import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarCheck, CalendarDays, DollarSign, ExternalLink, Mail, Phone, RotateCcw, User } from 'lucide-react'
import {
  formatCurrency,
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
import { showToast, undoToast } from '../lib/toast'
import { openMenu } from '../components/ContextMenu'
import { Printer, Receipt, Tag, ClipboardList, FileText as FileTextIcon, FileCheck } from 'lucide-react'
import { TicketLines } from '../components/TicketLines'
import { MessageSquare } from 'lucide-react'
import { loadTemplates } from '../lib/messages'
import { useMessageDialog } from '../components/MessageDialog'
import type { PrintKind } from '../../../shared/api'
import { CustomerPicker, ClearButton } from '../components/CustomerPicker'
import { PhotoGallery } from '../components/PhotoGallery'
import { Backlinks } from '../components/Backlinks'
import { CustomerEmails } from '../components/CustomerEmails'
import { useFormLinks, type FieldLink } from '../editor/formLinks'
import { LinkedEvents } from '../components/LinkedEvents'
import { TicketPayments } from './MoneyView'

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

type Fields = Omit<TicketUpdate, 'content' | 'taxExempt'>

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
  const [fromLines, setFromLines] = useState(false) // the price comes from the line items
  const [taxExempt, setTaxExempt] = useState(ticket.taxExempt)
  const onLinesTotal = useCallback((cents: number | null) => {
    setFromLines(cents !== null)
    if (cents === null) return
    setFields((f) => ({ ...f, priceCents: cents }))
    setPriceText(formatMoney(cents))
  }, [])
  const [updatedAt, setUpdatedAt] = useState(ticket.updatedAt)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const trashed = ticket.deletedAt !== null

  const saver = useAutosave<TicketUpdate>(async (patch) => {
    const s = await api.tickets.update(ticket.id, patch)
    setUpdatedAt(s.updatedAt)
    if (patch.status) void useData.getState().refreshCounts()
    // Ready for pickup: offer to let the customer know.
    if (patch.status === 'ready') {
      showToast('Ready for pickup. Let the customer know?', {
        label: 'Message',
        run: async () => openMessage((await loadTemplates()).find((t) => t.id === 'ready'))
      })
    }
  })

  /** Opens a customer message for this ticket (the menu picks a template; the toast opens "Ready for pickup"). */
  const openMessage = async (template?: Awaited<ReturnType<typeof loadTemplates>>[number]): Promise<void> => {
    await saver.flush()
    const latest = await api.tickets.get(ticket.id)
    if (!template || !latest) return
    useMessageDialog.getState().set({ template, ticket: latest, customer: customerIdRef.current ? await api.customers.get(customerIdRef.current) : null })
  }

  // Customer details typed on the ticket are saved to the customer record.
  const customerIdRef = useRef(ticket.customerId)
  const customerSaver = useAutosave<CustomerInput>(async (patch) => {
    if (customerIdRef.current) await api.customers.update(customerIdRef.current, patch)
  })

  const customerRef = useRef<Customer | null>(null)
  customerRef.current = customer
  useEffect(() => {
    customerIdRef.current = fields.customerId
    if (!fields.customerId) return setCustomer(null)
    if (customerRef.current?.id === fields.customerId) return // just created from a fill-in field: already here
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

  // Fill-in fields linked to the customer: typing into one when the ticket has no customer yet creates one.
  const creating = useRef<Promise<void> | null>(null)
  const pendingCustomer = useRef<CustomerInput>({})
  const setLinkedCustomer = (patch: CustomerInput): void => {
    if (customerIdRef.current) return setCustomerField(patch)
    setCustomer((c) => ({ ...(c ?? { id: '', name: '', phone: '', email: '', address: '', notes: '', createdAt: 0, updatedAt: 0, deletedAt: null }), ...patch }))
    pendingCustomer.current = { ...pendingCustomer.current, ...patch }
    if (creating.current) return
    creating.current = (async () => {
      const first = pendingCustomer.current
      pendingCustomer.current = {}
      const created = await api.customers.create(first)
      customerIdRef.current = created.id
      setCustomer((c) => ({ ...created, ...c, id: created.id }))
      set({ customerId: created.id }, true)
      if (Object.keys(pendingCustomer.current).length) customerSaver.queue(pendingCustomer.current) // typed while it was being created
      pendingCustomer.current = {}
    })().finally(() => (creating.current = null))
  }

  const pickCustomer = async (customerId: string | null): Promise<void> => {
    await customerSaver.flush() // finish saving edits to the previous customer first
    set({ customerId }, true)
  }

  const onContent = useCallback((doc: DocJSON) => saver.queue({ content: doc }), [saver.queue])

  // What linked fill-in fields in the ticket's body show, and where their edits go.
  const setLinked = (link: FieldLink, value: string): void => {
    if (link === 'customer.name') setLinkedCustomer({ name: value })
    else if (link === 'customer.phone') setLinkedCustomer({ phone: value })
    else if (link === 'customer.email') setLinkedCustomer({ email: value })
    else if (link === 'customer.address') setLinkedCustomer({ address: value })
    else if (link === 'ticket.device') set({ device: value })
    else if (link === 'ticket.issue') set({ issue: value })
    else if (link === 'ticket.receivedOn') set({ receivedOn: value || null }, true)
    else if (link === 'ticket.pickupOn') set({ pickupOn: value || null }, true)
  }
  const setLinkedRef = useRef(setLinked)
  setLinkedRef.current = setLinked
  useEffect(() => {
    useFormLinks.setState({
      active: !trashed,
      set: (link, value) => setLinkedRef.current(link, value),
      values: {
        'customer.name': customer?.name ?? '',
        'customer.phone': customer?.phone ?? '',
        'customer.email': customer?.email ?? '',
        'customer.address': customer?.address ?? '',
        'ticket.device': fields.device,
        'ticket.issue': fields.issue,
        'ticket.receivedOn': fields.receivedOn ?? '',
        'ticket.pickupOn': fields.pickupOn ?? '',
        'ticket.number': formatTicketNumber(ticket.number),
        'ticket.price': fields.priceCents === null ? '' : formatCurrency(fields.priceCents)
      }
    })
  }, [customer, fields, trashed, ticket.number])
  useEffect(() => () => useFormLinks.setState({ active: false, values: {} }), [])

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
    undoToast(`${formatTicketNumber(ticket.number)} moved to trash`, async () => {
      await api.tickets.restore(ticket.id)
      void useData.getState().refreshCounts()
      go({ view: 'ticket', id: ticket.id })
    })
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
              <button
                type="button"
                className="btn sm"
                onClick={async (e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const templates = await loadTemplates()
                  openMenu(
                    { clientX: r.left, clientY: r.bottom + 4 },
                    templates.map((t) => ({ label: t.name, icon: <MessageSquare />, onSelect: () => openMessage(t) }))
                  )
                }}
              >
                <MessageSquare /> Message
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const print = async (kind: PrintKind): Promise<void> => {
                    await saver.flush()
                    await api.print.ticket(ticket.id, kind).catch((err: Error) => showToast(err.message))
                  }
                  openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
                    { label: 'Intake slip', icon: <ClipboardList />, onSelect: () => print('intake') },
                    { label: 'Quote', icon: <FileTextIcon />, onSelect: () => print('quote') },
                    { label: 'Invoice', icon: <FileCheck />, onSelect: () => print('invoice') },
                    { label: 'Receipt', icon: <Receipt />, onSelect: () => print('receipt') },
                    { label: 'Device label', icon: <Tag />, onSelect: () => print('label') }
                  ])
                }}
              >
                <Printer /> Print
              </button>
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
              readOnly={trashed || fromLines}
              title={fromLines ? 'Worked out from the line items below' : undefined}
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

        <TicketLines
          ticketId={ticket.id}
          taxExempt={taxExempt}
          readOnly={trashed}
          onTotal={onLinesTotal}
          onTaxExempt={(exempt) => {
            setTaxExempt(exempt)
            void api.tickets.update(ticket.id, { taxExempt: exempt })
          }}
        />

        {!trashed && <TicketPayments key={fields.priceCents ?? 0} ticketId={ticket.id} number={ticket.number} priceCents={fields.priceCents} />}

        <PhotoGallery ticketId={ticket.id} />

        <div className="ticket-body">
          <NoteEditor docId={ticket.id} content={ticket.content} editable={!trashed} onChange={onContent} />
        </div>

        {customer?.email && <CustomerEmails email={customer.email} name={customer.name} />}
        <LinkedEvents id={ticket.id} refreshKey={fields.pickupOn} />
        <Backlinks id={ticket.id} />
      </div>
    </div>
  )
}
