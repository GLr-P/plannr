import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Building2, Mail, MapPin, Phone, Plus, Trash2, UserRound, Users, X } from 'lucide-react'
import { CUSTOMER_RELATIONS, formatTicketNumber, type Customer, type CustomerInput, type LinkedCustomer, type TicketSummary } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { useAutosave } from '../lib/useAutosave'
import { formatDay, formatMoney, todayISO } from '../lib/format'
import { ConfirmButton, SaveIndicator, StatusPill } from '../components/common'
import { undoToast } from '../lib/toast'
import { Backlinks } from '../components/Backlinks'
import { CustomerEmails } from '../components/CustomerEmails'
import { LinkedEvents } from '../components/LinkedEvents'
import { CustomerPicker } from '../components/CustomerPicker'
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

/** A phone typed in the email box (or an email in the phone box) goes where it belongs */
export function sortContact(phone: string, email: string): { phone: string; email: string } | null {
  const looksEmail = (v: string): boolean => /^\S+@\S+\.\S+$/.test(v.trim())
  const looksPhone = (v: string): boolean => /^[+()\d\s.-]+$/.test(v.trim()) && (v.match(/\d/g)?.length ?? 0) >= 7
  if (looksEmail(phone) && !email.trim()) return { phone: '', email: phone.trim() }
  if (looksPhone(email) && !phone.trim()) return { phone: email.trim(), email: '' }
  return null
}

type Extra = 'business' | 'address' | 'people'

function CustomerPage({ customer }: { customer: Customer }) {
  const [c, setC] = useState(customer)
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [linked, setLinked] = useState<LinkedCustomer[]>([])
  // Sections added on this visit (an empty one isn't kept: next time only sections with something in them show)
  const [opened, setOpened] = useState<Set<Extra>>(new Set())
  const saver = useAutosave<CustomerInput>(async (patch) => {
    const saved = await api.customers.update(customer.id, patch)
    setC((cur) => ({ ...cur, updatedAt: saved.updatedAt }))
  })

  const remote = useData((s) => s.remote) // changed on another device
  const loadLinked = useCallback(() => void api.customers.linked(customer.id).then(setLinked), [customer.id])
  useEffect(() => {
    void api.tickets.list({ customerId: customer.id }).then(setTickets)
    loadLinked()
  }, [customer.id, remote, loadLinked])

  const set = (patch: CustomerInput): void => {
    setC((cur) => ({ ...cur, ...patch }))
    saver.queue(patch)
  }
  const tidyContact = (): void => {
    const fixed = sortContact(c.phone, c.email)
    if (fixed) set(fixed)
  }

  const hasAddress = Boolean(c.address || c.city || c.region || c.postalCode)
  const shown: Record<Extra, boolean> = {
    business: Boolean(c.company) || opened.has('business'),
    address: hasAddress || opened.has('address'),
    people: linked.length > 0 || opened.has('people')
  }
  const open = (x: Extra, focus: string): void => {
    setOpened((o) => new Set(o).add(x))
    requestAnimationFrame(() => document.querySelector<HTMLElement>(focus)?.focus())
  }
  const close = (x: Extra): void => {
    setOpened((o) => {
      const n = new Set(o)
      n.delete(x)
      return n
    })
    if (x === 'business' && c.company) set({ company: '' })
    if (x === 'address' && hasAddress) set({ address: '', city: '', region: '', postalCode: '' })
  }

  const link = async (otherId: string, relation: string): Promise<void> => {
    await saver.flush()
    const related = [...c.related.filter((l) => l.id !== otherId), { id: otherId, relation: relation.trim() }]
    const saved = await api.customers.update(customer.id, { related })
    setC((cur) => ({ ...cur, related: saved.related, updatedAt: saved.updatedAt }))
    loadLinked()
  }
  const unlink = async (person: LinkedCustomer): Promise<void> => {
    await saver.flush()
    if (person.reverse) {
      const other = await api.customers.get(person.id) // the link was made on their page
      if (other) await api.customers.update(other.id, { related: other.related.filter((l) => l.id !== customer.id) })
    } else {
      const saved = await api.customers.update(customer.id, { related: c.related.filter((l) => l.id !== person.id) })
      setC((cur) => ({ ...cur, related: saved.related, updatedAt: saved.updatedAt }))
    }
    loadLinked()
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
            <input className="prop-input" value={c.phone} placeholder="Add phone" inputMode="tel" onChange={(e) => set({ phone: e.target.value })} onBlur={tidyContact} aria-label="Phone" />
          </label>
          <label className="prop">
            <span className="prop-label">
              <Mail /> Email
            </span>
            <input className="prop-input" value={c.email} placeholder="Add email" inputMode="email" onChange={(e) => set({ email: e.target.value })} onBlur={tidyContact} aria-label="Email" />
          </label>
        </div>

        {shown.business && (
          <section className="customer-extra" aria-label="Business details">
            <ExtraHead icon={<Building2 />} title="Business" onRemove={() => close('business')} filled={Boolean(c.company)} />
            <div className="props one-col">
              <label className="prop">
                <span className="prop-label">Name</span>
                <input id="customer-business" className="prop-input" value={c.company} placeholder="Business name" onChange={(e) => set({ company: e.target.value })} aria-label="Business" />
              </label>
            </div>
          </section>
        )}

        {shown.address && (
          <section className="customer-extra" aria-label="Address details">
            <ExtraHead icon={<MapPin />} title="Address" onRemove={() => close('address')} filled={hasAddress} />
            <div className="props one-col">
              <label className="prop">
                <span className="prop-label">Street</span>
                <input id="customer-street" className="prop-input" value={c.address} placeholder="Street address" onChange={(e) => set({ address: e.target.value })} aria-label="Address" />
              </label>
              <label className="prop">
                <span className="prop-label">Town</span>
                <input className="prop-input" value={c.city} placeholder="Town or city" onChange={(e) => set({ city: e.target.value })} aria-label="Town" />
              </label>
              <label className="prop">
                <span className="prop-label">Province</span>
                <input className="prop-input" value={c.region} placeholder="Province or state" onChange={(e) => set({ region: e.target.value })} aria-label="Province" />
              </label>
              <label className="prop">
                <span className="prop-label">Postal code</span>
                <input className="prop-input" value={c.postalCode} placeholder="Postal code" onChange={(e) => set({ postalCode: e.target.value })} aria-label="Postal code" />
              </label>
            </div>
          </section>
        )}

        {shown.people && (
          <section className="customer-extra" aria-label="Linked people">
            <ExtraHead icon={<Users />} title="Linked people" onRemove={linked.length ? undefined : () => close('people')} filled={false} />
            {linked.length > 0 && (
              <ul className="linked-people">
                {linked.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="linked-person" onClick={() => go({ view: 'customer', id: p.id })}>
                      <UserRound />
                      <span className="linked-name">{p.name}</span>
                      {p.relation && <span className="badge">{p.reverse ? `${p.relation} of` : p.relation}</span>}
                      <span className="muted small">{p.phone || p.email}</span>
                    </button>
                    <button type="button" className="icon-btn sm" aria-label={`Unlink ${p.name}`} title="Unlink" onClick={() => void unlink(p)}>
                      <X />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <LinkPerson exclude={[customer.id, ...linked.map((l) => l.id)]} onLink={(id, relation) => void link(id, relation)} />
          </section>
        )}

        {(!shown.business || !shown.address || !shown.people) && (
          <div className="add-chips" aria-label="Add to this customer">
            {!shown.business && (
              <button type="button" className="chip" onClick={() => open('business', '#customer-business')}>
                <Plus /> Business
              </button>
            )}
            {!shown.address && (
              <button type="button" className="chip" onClick={() => open('address', '#customer-street')}>
                <Plus /> Address
              </button>
            )}
            {!shown.people && (
              <button type="button" className="chip" onClick={() => open('people', '.link-person .link-relation')}>
                <Plus /> Linked person
              </button>
            )}
          </div>
        )}

        <textarea
          className="notes-area"
          value={c.notes}
          placeholder="Notes about this customer…"
          onChange={(e) => set({ notes: e.target.value })}
          aria-label="Customer notes"
        />

        {tickets.length > 0 && (
          <div className="customer-stats">
            <div>
              <span className="small muted">Tickets</span>
              <b>{tickets.length}</b>
            </div>
            <div>
              <span className="small muted">Paid in total</span>
              <b>{formatMoney(tickets.reduce((s, t) => s + t.paidCents, 0))}</b>
            </div>
            <div>
              <span className="small muted">Last visit</span>
              <b>{formatDay(tickets.map((t) => t.receivedOn ?? '').sort().pop() || null)}</b>
            </div>
            {tickets.some((t) => t.priceCents !== null && t.priceCents > t.paidCents && t.status !== 'picked_up') && (
              <div>
                <span className="small muted">Still owing</span>
                <b className="owing">{formatMoney(tickets.reduce((s, t) => s + Math.max(0, (t.priceCents ?? 0) - t.paidCents), 0))}</b>
              </div>
            )}
          </div>
        )}
        <div className="list-header section-gap">
          <h2 className="section-title flush">Tickets</h2>
          <NewTicketButton customerId={customer.id} />
        </div>
        {tickets.length === 0 ? (
          <div className="empty-state left">No tickets yet.</div>
        ) : (
          historyGroups(tickets, customer.id, c.company).map((g) => (
            <div key={g.key} className="history-group">
              {g.label && <div className="history-group-label">{g.label}</div>}
              <ul className="ticket-history">
                {g.tickets.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="history-row" onClick={() => go({ view: 'ticket', id: t.id })}>
                      <span className="mono">{formatTicketNumber(t.number)}</span>
                      <span className="history-main">
                        {t.device || 'Untitled'}
                        {t.issue && <span className="muted"> · {t.issue}</span>}
                      </span>
                      {t.warrantyUntil && t.warrantyUntil >= todayISO() && (
                        <span className="badge warranty-badge" title={`Under warranty until ${formatDay(t.warrantyUntil)}`}>
                          Warranty to {formatDay(t.warrantyUntil)}
                        </span>
                      )}
                      <StatusPill status={t.status} />
                      <span className="history-date">{formatDay(t.receivedOn)}</span>
                      <span className="history-price">{formatMoney(t.priceCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        <CustomerEmails email={c.email} name={c.name} />
        <LinkedEvents id={customer.id} />
        <Backlinks id={customer.id} />
      </div>
    </div>
  )
}

/**
 * A customer's tickets split by who they were for: their own, their business's, each linked person's on their
 * account, and tickets done for them on someone else's account. No heading when there are only their own.
 */
export function historyGroups(tickets: TicketSummary[], me: string, company: string): { key: string; label: string; tickets: TicketSummary[] }[] {
  const groups = new Map<string, { key: string; label: string; tickets: TicketSummary[] }>()
  const add = (key: string, label: string, t: TicketSummary): void => {
    if (!groups.has(key)) groups.set(key, { key, label, tickets: [] })
    groups.get(key)!.tickets.push(t)
  }
  for (const t of tickets) {
    if (t.customerId !== me) add(`acct:${t.customerId}`, `On ${t.customerName || 'another customer'}’s account`, t)
    else if (t.business) add('business', company ? `Business · ${company}` : 'Business', t)
    else if (t.forId) add(`for:${t.forId}`, `For ${t.forName}`, t)
    else add('own', 'Personal', t)
  }
  // Always in the same order: their own, the business, each person, then other accounts
  const rank = (key: string): number => (key === 'own' ? 0 : key === 'business' ? 1 : key.startsWith('for:') ? 2 : 3)
  const list = [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key))
  if (list.length === 1 && list[0].key === 'own') list[0].label = ''
  return list
}

function ExtraHead({ icon, title, onRemove, filled }: { icon: ReactNode; title: string; onRemove?: () => void; filled: boolean }) {
  const [armed, setArmed] = useState(false)
  return (
    <div className="customer-extra-head">
      {icon}
      <span>{title}</span>
      {onRemove && (
        <button
          type="button"
          className={`icon-btn sm ${armed ? 'danger' : ''}`}
          aria-label={armed ? `Clear ${title.toLowerCase()}` : `Remove ${title.toLowerCase()}`}
          title={filled ? (armed ? 'Click again to clear it' : 'Remove (clears it)') : 'Remove'}
          onBlur={() => setArmed(false)}
          onClick={() => {
            if (filled && !armed) return setArmed(true)
            onRemove()
          }}
        >
          {armed ? <Trash2 /> : <X />}
        </button>
      )}
    </div>
  )
}

/** Link someone: say how they're related, then pick or create them */
function LinkPerson({ exclude, onLink }: { exclude: string[]; onLink: (id: string, relation: string) => void }) {
  const [relation, setRelation] = useState('')
  const [key, setKey] = useState(0) // resets the picker after linking
  return (
    <div className="link-person">
      <input
        className="prop-input link-relation"
        list="customer-relations"
        value={relation}
        placeholder="Relation (e.g. Wife)"
        onChange={(e) => setRelation(e.target.value)}
        aria-label="Relation"
      />
      <datalist id="customer-relations">
        {CUSTOMER_RELATIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <CustomerPicker
        key={key}
        label="Link a person"
        placeholder="Search or add a person…"
        exclude={exclude}
        onPick={(id) => {
          onLink(id, relation)
          setRelation('')
          setKey((k) => k + 1)
        }}
      />
    </div>
  )
}
