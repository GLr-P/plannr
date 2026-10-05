import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleCheck, Download, ExternalLink, Plus, Repeat, Search, SkipForward, Trash2, X } from 'lucide-react'
import {
  FREQUENCIES,
  PAYMENT_METHODS,
  formatTicketNumber,
  statusLabel,
  type MoneyOccurrence,
  type MoneySummary,
  type RecurringItem,
  type RecurringKind,
  type RecurringPatch,
  type Transaction,
  type TransactionType
} from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { useUi } from '../store/ui'
import { useAutosave } from '../lib/useAutosave'
import { formatDay, formatMoney, parseMoney, todayISO } from '../lib/format'
import { addDays } from '../lib/time'
import { ConfirmButton } from '../components/common'

type Tab = 'overview' | 'recurring' | 'transactions'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'recurring', label: 'Bills & subscriptions' },
  { id: 'transactions', label: 'Transactions' }
]

const money0 = (cents: number): string => formatMoney(cents) || '$0.00'
const perLabel = (r: { frequency: RecurringItem['frequency'] }): string => FREQUENCIES.find((f) => f.id === r.frequency)?.per ?? ''

/** "Due today", "in 3 days", "3 days overdue", or a date. */
export function dueLabel(date: string, today = todayISO()): { text: string; overdue: boolean } {
  const days = Math.round((new Date(`${date}T00:00`).getTime() - new Date(`${today}T00:00`).getTime()) / 86_400_000)
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, overdue: true }
  if (days === 0) return { text: 'Due today', overdue: false }
  if (days === 1) return { text: 'Tomorrow', overdue: false }
  if (days <= 14) return { text: `In ${days} days`, overdue: false }
  return { text: formatDay(date), overdue: false }
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthRange = (month: string): { from: string; to: string } => {
  const [y, m] = month.split('-').map(Number)
  return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
}

function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-picker">
      <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft />
      </button>
      <span className="month-label">{monthLabel(month)}</span>
      <button type="button" className="icon-btn" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight />
      </button>
    </div>
  )
}

export function MoneyView({ itemId }: { itemId?: string }) {
  const tab = (useUi((s) => s.prefs.moneyTab) as Tab | undefined) ?? 'overview'
  const setPref = useUi((s) => s.setPref)
  const [month, setMonth] = useState(todayISO().slice(0, 7))

  useEffect(() => {
    if (itemId) setPref('moneyTab', 'recurring') // a reminder or calendar entry opened a bill/subscription
  }, [itemId, setPref])

  return (
    <div className="page wide money-page">
      <div className="list-header">
        <h1>Money</h1>
        <button
          type="button"
          className="btn"
          title="Export this month’s transactions as a spreadsheet (CSV)"
          onClick={() => {
            const { from, to } = monthRange(month)
            void api.money.exportCsv(from, to)
          }}
        >
          <Download /> Export CSV
        </button>
      </div>
      <div className="segmented money-tabs" role="tablist" aria-label="Money sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setPref('moneyTab', t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview month={month} onMonth={setMonth} onOpenItem={(id) => go({ view: 'money', itemId: id })} />}
      {tab === 'recurring' && <Recurring openId={itemId} />}
      {tab === 'transactions' && <Transactions month={month} onMonth={setMonth} />}
    </div>
  )
}

// ---------- Overview ----------

function Overview({ month, onMonth, onOpenItem }: { month: string; onMonth: (m: string) => void; onOpenItem: (id: string) => void }) {
  const [s, setS] = useState<MoneySummary | null>(null)
  const load = useCallback(async () => setS(await api.money.summary(month)), [month])
  useEffect(() => {
    void load()
  }, [load])
  if (!s) return null
  const net = s.incomeCents - s.expenseCents

  return (
    <div className="money-overview">
      <MonthPicker month={month} onChange={onMonth} />
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Income</div>
          <div className="stat-value income">{money0(s.incomeCents)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Expenses</div>
          <div className="stat-value expense">{money0(s.expenseCents)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Profit</div>
          <div className={`stat-value ${net < 0 ? 'expense' : ''}`}>{net < 0 ? `−${money0(-net)}` : money0(net)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Subscriptions</div>
          <div className="stat-value">
            {money0(s.subscriptionsMonthlyCents)}
            <span className="stat-unit">/mo</span>
          </div>
          <div className="stat-sub">{money0(s.subscriptionsYearlyCents)} a year</div>
        </div>
      </div>

      <div className="money-columns">
        <section>
          <h2 className="section-title">Coming up · next 30 days</h2>
          {s.upcoming.length === 0 ? (
            <div className="empty-state left">Nothing due. Add bills and subscriptions to see them here.</div>
          ) : (
            <ul className="due-list">
              {s.upcoming.map((o) => (
                <DueRow key={o.recurringId} o={o} onChanged={() => void load()} onOpen={() => onOpenItem(o.recurringId)} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="section-title">Customers who owe you</h2>
          {s.unpaidTickets.length === 0 ? (
            <div className="empty-state left">Everyone’s paid up.</div>
          ) : (
            <ul className="due-list">
              {s.unpaidTickets.map((t) => (
                <li key={t.ticketId}>
                  <button type="button" className="due-row" onClick={() => go({ view: 'ticket', id: t.ticketId })}>
                    <span className="mono">{formatTicketNumber(t.number)}</span>
                    <span className="due-main">
                      <span className="due-name">{t.customerName || 'No customer'}</span>
                      <span className="due-sub">
                        {t.device || 'No device'} · {statusLabel(t.status)}
                      </span>
                    </span>
                    <span className="due-amount owed">Owes {money0(t.priceCents - t.paidCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function DueRow({ o, onChanged, onOpen }: { o: MoneyOccurrence; onChanged: () => void; onOpen: () => void }) {
  const due = dueLabel(o.date)
  return (
    <li className="due-row">
      <button type="button" className="due-main as-button" onClick={onOpen}>
        <span className="due-name">
          {o.name || (o.kind === 'subscription' ? 'Subscription' : 'Bill')}
          {o.autopay && <span className="badge">Auto-pay</span>}
        </span>
        <span className={`due-sub ${due.overdue ? 'overdue' : ''}`}>
          {due.text} · {formatDay(o.date)}
        </span>
      </button>
      <span className="due-amount">{money0(o.amountCents)}</span>
      <button
        type="button"
        className="btn sm"
        title="Record the payment and move to the next due date"
        onClick={async () => {
          await api.money.markPaid(o.recurringId)
          onChanged()
        }}
      >
        <CircleCheck /> Paid
      </button>
    </li>
  )
}

// ---------- Bills & subscriptions ----------

function Recurring({ openId }: { openId?: string }) {
  const [items, setItems] = useState<RecurringItem[]>([])
  const [open, setOpen] = useState<string | null>(openId ?? null)
  const [showCancelled, setShowCancelled] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const load = useCallback(async () => setItems(await api.money.recurring()), [])
  useEffect(() => {
    void load()
    void api.money.categories().then(setCategories)
  }, [load])
  useEffect(() => {
    if (openId) setOpen(openId)
  }, [openId])

  const create = async (kind: RecurringKind): Promise<void> => {
    const r = await api.money.createRecurring(kind)
    await load()
    setOpen(r.id)
  }

  const active = items.filter((i) => i.active)
  const groups: { title: string; list: RecurringItem[] }[] = [
    { title: 'Subscriptions', list: active.filter((i) => i.kind === 'subscription') },
    { title: 'Bills', list: active.filter((i) => i.kind === 'bill') }
  ]
  const cancelled = items.filter((i) => !i.active)

  return (
    <div className="recurring">
      <div className="recurring-actions">
        <button type="button" className="btn primary" onClick={() => void create('subscription')}>
          <Plus /> Subscription
        </button>
        <button type="button" className="btn" onClick={() => void create('bill')}>
          <Plus /> Bill
        </button>
      </div>
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="section-title">
            {g.title} {g.list.length > 0 && <span className="muted">{g.list.length}</span>}
          </h2>
          {g.list.length === 0 ? (
            <div className="empty-state left">None yet.</div>
          ) : (
            <ul className="recurring-list">
              {g.list.map((r) => (
                <RecurringRow
                  key={r.id}
                  r={r}
                  open={open === r.id}
                  categories={categories}
                  onToggle={() => setOpen(open === r.id ? null : r.id)}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
      {cancelled.length > 0 && (
        <section>
          <button type="button" className="section-toggle-btn" onClick={() => setShowCancelled(!showCancelled)}>
            {showCancelled ? 'Hide' : 'Show'} cancelled ({cancelled.length})
          </button>
          {showCancelled && (
            <ul className="recurring-list">
              {cancelled.map((r) => (
                <RecurringRow
                  key={r.id}
                  r={r}
                  open={open === r.id}
                  categories={categories}
                  onToggle={() => setOpen(open === r.id ? null : r.id)}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function RecurringRow({
  r,
  open,
  categories,
  onToggle,
  onChanged
}: {
  r: RecurringItem
  open: boolean
  categories: string[]
  onToggle: () => void
  onChanged: () => void
}) {
  const due = dueLabel(r.nextDue)
  return (
    <li className={`recurring-item ${open ? 'open' : ''} ${r.active ? '' : 'cancelled'}`} data-id={r.id}>
      <div className="recurring-row">
        <button type="button" className="recurring-main" onClick={onToggle} aria-expanded={open}>
          <span className="recurring-icon">
            <Repeat />
          </span>
          <span className="due-main">
            <span className="due-name">
              {r.name || <span className="muted">Untitled {r.kind}</span>}
              {r.autopay && r.active && <span className="badge">Auto-pay</span>}
              {!r.active && <span className="badge muted-badge">Cancelled {r.cancelledOn ? formatDay(r.cancelledOn) : ''}</span>}
            </span>
            {r.active && (
              <span className={`due-sub ${due.overdue ? 'overdue' : ''}`}>
                {r.frequency === 'once' ? '' : 'Next: '}
                {due.text}
                {r.category && ` · ${r.category}`}
              </span>
            )}
          </span>
          <span className="due-amount">
            {money0(r.amountCents)}
            <span className="per">{perLabel(r)}</span>
          </span>
        </button>
        {r.active && (
          <span className="row-actions-visible">
            <button
              type="button"
              className="btn sm"
              title="Record the payment and move to the next due date"
              onClick={async () => {
                await api.money.markPaid(r.id)
                onChanged()
              }}
            >
              <CircleCheck /> Paid
            </button>
            <button
              type="button"
              className="icon-btn sm"
              title="Skip this one (no payment recorded)"
              aria-label="Skip"
              onClick={async () => {
                await api.money.skip(r.id)
                onChanged()
              }}
            >
              <SkipForward />
            </button>
          </span>
        )}
      </div>
      {open && <RecurringEditor r={r} categories={categories} onChanged={onChanged} />}
    </li>
  )
}

function RecurringEditor({ r, categories, onChanged }: { r: RecurringItem; categories: string[]; onChanged: () => void }) {
  const [form, setForm] = useState(r)
  const [amountText, setAmountText] = useState(r.amountCents ? (r.amountCents / 100).toFixed(2) : '')
  const saver = useAutosave<RecurringPatch>(async (patch) => {
    await api.money.updateRecurring(r.id, patch)
    onChanged()
  }, 400)
  const set = (patch: RecurringPatch, immediate = false): void => {
    setForm((f) => ({ ...f, ...patch }))
    saver.queue(patch)
    if (immediate) void saver.flush()
  }

  return (
    <div className="recurring-editor">
      <label className="mfield wide">
        Name
        <input autoFocus={!r.name} value={form.name} placeholder={r.kind === 'subscription' ? 'e.g. Adobe Creative Cloud' : 'e.g. Shop rent'} onChange={(e) => set({ name: e.target.value })} aria-label="Name" />
      </label>
      <label className="mfield">
        Amount
        <input
          value={amountText}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => {
            setAmountText(e.target.value)
            set({ amountCents: parseMoney(e.target.value) ?? 0 })
          }}
          aria-label="Amount"
        />
      </label>
      <label className="mfield">
        How often
        <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value as RecurringItem['frequency'] }, true)} aria-label="How often">
          {FREQUENCIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mfield">
        {form.frequency === 'once' ? 'Due on' : 'Next due'}
        <input type="date" value={form.nextDue} onChange={(e) => e.target.value && set({ nextDue: e.target.value }, true)} aria-label="Next due" />
      </label>
      <label className="mfield">
        Category
        <input list="money-categories" value={form.category} placeholder="e.g. Software" onChange={(e) => set({ category: e.target.value })} aria-label="Category" />
        <datalist id="money-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="mfield">
        Remind me
        <select value={form.remindDays} onChange={(e) => set({ remindDays: Number(e.target.value) }, true)} aria-label="Remind me">
          <option value={-1}>Never</option>
          <option value={0}>On the day</option>
          <option value={1}>1 day before (and on the day)</option>
          <option value={3}>3 days before (and on the day)</option>
          <option value={7}>1 week before (and on the day)</option>
          <option value={14}>2 weeks before (and on the day)</option>
        </select>
      </label>
      <label className="check mfield-check">
        <input type="checkbox" checked={form.autopay} onChange={(e) => set({ autopay: e.target.checked }, true)} />
        Auto-pay (record the payment automatically on the due date)
      </label>
      <label className="mfield wide">
        Website
        <span className="mfield-row">
          <input value={form.url} placeholder="Where to manage or cancel it" onChange={(e) => set({ url: e.target.value })} aria-label="Website" />
          {form.url && (
            <button type="button" className="icon-btn sm" aria-label="Open website" onClick={() => window.open(/^https?:\/\//i.test(form.url) ? form.url : `https://${form.url}`, '_blank')}>
              <ExternalLink />
            </button>
          )}
        </span>
      </label>
      <label className="mfield wide">
        Notes
        <textarea value={form.notes} placeholder="Account number, login hint, what it’s for…" onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" />
      </label>
      <div className="recurring-editor-foot">
        {form.active ? (
          <button type="button" className="btn sm" onClick={() => set({ active: false }, true)}>
            <X /> {r.kind === 'subscription' ? 'Mark cancelled' : 'Stop tracking'}
          </button>
        ) : (
          <button type="button" className="btn sm" onClick={() => set({ active: true }, true)}>
            <Repeat /> Reactivate
          </button>
        )}
        <ConfirmButton
          title="Delete"
          label="Delete"
          onConfirm={async () => {
            await api.money.removeRecurring(r.id)
            onChanged()
          }}
        />
        <span className="muted small">{saver.status === 'saved' ? 'Saved' : 'Saving…'}</span>
      </div>
    </div>
  )
}

// ---------- Transactions ----------

function Transactions({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const [type, setType] = useState<TransactionType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<Transaction[]>([])
  const [adding, setAdding] = useState<TransactionType | null>(null)
  const range = useMemo(() => monthRange(month), [month])
  const load = useCallback(async () => {
    setList(await api.money.transactions({ ...range, type: type === 'all' ? undefined : type, query }))
  }, [range, type, query])
  useEffect(() => {
    const t = setTimeout(() => void load(), 60)
    return () => clearTimeout(t)
  }, [load])

  const income = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0)
  const expense = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0)

  return (
    <div className="transactions">
      <div className="tx-toolbar">
        <MonthPicker month={month} onChange={onMonth} />
        <div className="chips">
          {(['all', 'income', 'expense'] as const).map((t) => (
            <button key={t} type="button" className={`chip-btn ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
              {t === 'all' ? 'All' : t === 'income' ? 'Income' : 'Expenses'}
            </button>
          ))}
        </div>
        <div className="filter-field grow">
          <Search />
          <input placeholder="Search description, category, method, customer…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transactions" />
        </div>
        <button type="button" className="btn" onClick={() => setAdding('income')}>
          <Plus /> Income
        </button>
        <button type="button" className="btn" onClick={() => setAdding('expense')}>
          <Plus /> Expense
        </button>
      </div>

      {adding && (
        <TransactionForm
          type={adding}
          defaultDate={todayISO().startsWith(month) ? todayISO() : range.from}
          onDone={async (saved) => {
            setAdding(null)
            if (saved) await load()
          }}
        />
      )}

      <div className="tx-totals">
        <span>
          In <strong className="income">{money0(income)}</strong>
        </span>
        <span>
          Out <strong className="expense">{money0(expense)}</strong>
        </span>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">No transactions {query ? 'match' : 'this month'}.</div>
      ) : (
        <div className="table-wrap">
          <table className="table tx-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="tx-row">
                  <td className="nowrap">{formatDay(t.date)}</td>
                  <td>
                    <div className="cell-main">{t.description || (t.type === 'income' ? 'Income' : 'Expense')}</div>
                    {t.ticketLabel && (
                      <button type="button" className="link-btn tight" onClick={() => go({ view: 'ticket', id: t.ticketId! })}>
                        {t.ticketLabel}
                      </button>
                    )}
                  </td>
                  <td>{t.category}</td>
                  <td>{t.method}</td>
                  <td className={`num ${t.type}`}>{t.type === 'income' ? '+' : '−'}{money0(t.amountCents)}</td>
                  <td className="num">
                    <span className="row-actions">
                      <ConfirmButton
                        title="Delete transaction"
                        onConfirm={async () => {
                          await api.money.removeTransaction(t.id)
                          await load()
                        }}
                      />
                    </span>
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

export function TransactionForm({
  type,
  defaultDate,
  ticketId,
  defaultAmountCents,
  defaultDescription,
  onDone
}: {
  type: TransactionType
  defaultDate: string
  ticketId?: string
  defaultAmountCents?: number
  defaultDescription?: string
  onDone: (saved: boolean) => void
}) {
  const [date, setDate] = useState(defaultDate)
  const [description, setDescription] = useState(defaultDescription ?? '')
  const [amount, setAmount] = useState(defaultAmountCents ? (defaultAmountCents / 100).toFixed(2) : '')
  const [category, setCategory] = useState(ticketId ? 'Repairs' : '')
  const [method, setMethod] = useState(type === 'income' ? 'Cash' : 'Card')
  const [categories, setCategories] = useState<string[]>([])
  useEffect(() => {
    void api.money.categories().then(setCategories)
  }, [])
  const cents = parseMoney(amount)

  const save = async (): Promise<void> => {
    if (!cents) return
    await api.money.addTransaction({ type, date, description, amountCents: cents, category, method, ticketId: ticketId ?? null })
    onDone(true)
  }

  return (
    <form
      className="tx-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onDone(false)}
    >
      <span className={`tx-form-type ${type}`}>{type === 'income' ? (ticketId ? 'Payment' : 'Income') : 'Expense'}</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      {!ticketId && <input className="grow" autoFocus value={description} placeholder="What for?" onChange={(e) => setDescription(e.target.value)} aria-label="Description" />}
      <input className="amount" autoFocus={Boolean(ticketId)} value={amount} inputMode="decimal" placeholder="$0.00" onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
      {!ticketId && (
        <>
          <input list="tx-categories" value={category} placeholder="Category" onChange={(e) => setCategory(e.target.value)} aria-label="Category" />
          <datalist id="tx-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      )}
      <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
        {PAYMENT_METHODS.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <button type="submit" className="btn sm primary" disabled={!cents}>
        Save
      </button>
      <button type="button" className="icon-btn sm" aria-label="Cancel" onClick={() => onDone(false)}>
        <X />
      </button>
    </form>
  )
}

/** Ticket page: what's been paid, what's owed, and recording payments. */
export function TicketPayments({ ticketId, number, priceCents, onChanged }: { ticketId: string; number: number; priceCents: number | null; onChanged?: () => void }) {
  const [payments, setPayments] = useState<Transaction[]>([])
  const [adding, setAdding] = useState(false)
  const load = useCallback(async () => setPayments(await api.money.transactions({ ticketId, type: 'income' })), [ticketId])
  useEffect(() => {
    void load()
  }, [load])
  const paid = payments.reduce((s, p) => s + p.amountCents, 0)
  const owed = Math.max(0, (priceCents ?? 0) - paid)

  return (
    <section className="ticket-payments">
      <div className="ticket-payments-head">
        <span className="vault-field-label">Payment</span>
        <PaidBadge priceCents={priceCents} paidCents={paid} />
        {!adding && (
          <button type="button" className="btn sm" onClick={() => setAdding(true)}>
            <Plus /> Record payment
          </button>
        )}
      </div>
      {adding && (
        <TransactionForm
          type="income"
          ticketId={ticketId}
          defaultDate={todayISO()}
          defaultAmountCents={owed || undefined}
          defaultDescription={`Payment · ${formatTicketNumber(number)}`}
          onDone={async (saved) => {
            setAdding(false)
            if (saved) {
              await load()
              onChanged?.()
            }
          }}
        />
      )}
      {payments.length > 0 && (
        <ul className="payment-list">
          {payments.map((p) => (
            <li key={p.id}>
              <span>{formatDay(p.date)}</span>
              <span className="muted">{p.method}</span>
              <span className="income">{money0(p.amountCents)}</span>
              <button
                type="button"
                className="icon-btn sm"
                title="Remove payment"
                aria-label="Remove payment"
                onClick={async () => {
                  await api.money.removeTransaction(p.id)
                  await load()
                  onChanged?.()
                }}
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function PaidBadge({ priceCents, paidCents }: { priceCents: number | null; paidCents: number }) {
  if (!priceCents && !paidCents) return null
  if (priceCents && paidCents >= priceCents) return <span className="pay-badge paid">Paid</span>
  if (!priceCents) return <span className="pay-badge paid">{money0(paidCents)} paid</span>
  return <span className="pay-badge owes">Owes {money0(priceCents - paidCents)}</span>
}

/** Due dates within the next `days` days (Home "Coming up"). */
export async function upcomingBills(days: number): Promise<MoneyOccurrence[]> {
  return api.money.occurrences(todayISO(), addDays(todayISO(), days))
}
