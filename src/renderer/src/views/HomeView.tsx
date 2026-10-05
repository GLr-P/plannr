import { useEffect, useState } from 'react'
import { CalendarDays, DollarSign, FileText, Flag, Pin, Wrench } from 'lucide-react'
import { formatTicketNumber, type CalendarEvent, type Holiday, type MoneyOccurrence, type TicketSummary } from '../../../shared/api'
import { upcomingBills } from './MoneyView'
import { addDays, formatTime } from '../lib/time'
import { api } from '../api'
import { StatusPill } from '../components/common'
import { NewTicketButton } from './TicketsView'
import { NewNoteButton } from '../components/NewNoteButton'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { openMenu } from '../components/ContextMenu'
import { ItemIcon } from '../lib/icons'
import { noteMenu } from '../menus'
import { formatDay, formatMoney, greeting, noteTitle, relativeTime, todayISO } from '../lib/format'

function dayLabel(date: string): string {
  if (date === todayISO()) return 'Today'
  if (date === addDays(todayISO(), 1)) return 'Tomorrow'
  return formatDay(date)
}

/** Ready-for-pickup first, then by pickup date (soonest first), then newest. */
function byUrgency(a: TicketSummary, b: TicketSummary): number {
  if ((a.status === 'ready') !== (b.status === 'ready')) return a.status === 'ready' ? -1 : 1
  if (a.pickupOn !== b.pickupOn) return !a.pickupOn ? 1 : !b.pickupOn ? -1 : a.pickupOn.localeCompare(b.pickupOn)
  return b.number - a.number
}

export function HomeView() {
  const notes = useData((s) => s.notes)
  const pinned = notes.filter((n) => n.pinned)
  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [bills, setBills] = useState<MoneyOccurrence[]>([])
  useEffect(() => {
    void upcomingBills(7).then(setBills)
    void api.calendar.range(todayISO(), addDays(todayISO(), 7)).then(setUpcoming)
    void api.holidays.range(todayISO(), addDays(todayISO(), 7)).then(setHolidays)
    void api.tickets.list({ status: 'open' }).then((list) => setTickets(list.sort(byUrgency)))
  }, [])
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="page home">
      <header className="home-header">
        <div>
          <h1>{greeting()}</h1>
          <p className="muted">{today}</p>
        </div>
        <div className="header-actions">
          <NewNoteButton />
          <NewTicketButton />
        </div>
      </header>

      {(upcoming.length > 0 || holidays.length > 0 || bills.length > 0) && (
        <section>
          <h2 className="section-title">Coming up</h2>
          <ul className="ticket-history">
            {holidays.map((h) => (
              <li key={h.id}>
                <button type="button" className="history-row" onClick={() => go({ view: 'calendar', date: h.date })}>
                  <Flag className="row-lead holiday-flag" />
                  <span className="upcoming-day">{dayLabel(h.date)}</span>
                  <span className="history-main">{h.title}</span>
                  <span className="history-date">{h.observance ? 'Observance' : 'Holiday'}</span>
                </button>
              </li>
            ))}
            {bills.map((b) => (
              <li key={`${b.recurringId}:${b.date}`}>
                <button type="button" className="history-row" onClick={() => go({ view: 'money', itemId: b.recurringId })}>
                  <DollarSign className="row-lead" />
                  <span className="upcoming-day">{dayLabel(b.date)}</span>
                  <span className="history-main">
                    {b.name || 'Bill'}
                    <span className="muted"> · {b.kind === 'subscription' ? 'renews' : 'due'}{b.autopay ? ' (auto-pay)' : ''}</span>
                  </span>
                  <span className="history-date">{formatMoney(b.amountCents)}</span>
                </button>
              </li>
            ))}
            {upcoming.map((e) => (
              <li key={e.id}>
                <button type="button" className="history-row" onClick={() => go({ view: 'calendar', date: e.date, eventId: e.id })}>
                  {e.kind === 'pickup' ? <Wrench className="row-lead" /> : <CalendarDays className="row-lead" />}
                  <span className="upcoming-day">{dayLabel(e.date)}</span>
                  <span className="history-main">
                    {e.title || '(untitled)'}
                    {e.linkTitle && e.linkTitle !== e.title && <span className="muted"> · {e.linkTitle}</span>}
                  </span>
                  <span className="history-date">{e.startTime ? formatTime(e.startTime) : 'All day'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tickets.length > 0 && (
        <section>
          <h2 className="section-title">
            Open tickets <span className="muted">{tickets.length}</span>
          </h2>
          <ul className="ticket-history">
            {tickets.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" className="history-row" onClick={() => go({ view: 'ticket', id: t.id })}>
                  <span className="mono">{formatTicketNumber(t.number)}</span>
                  <span className="history-main">
                    {t.customerName || 'No customer'}
                    <span className="muted"> · {t.device || 'No device'}</span>
                  </span>
                  <StatusPill status={t.status} />
                  <span className={`history-date ${t.pickupOn && t.pickupOn < todayISO() ? 'overdue' : ''}`}>
                    {t.pickupOn ? `Pickup ${formatDay(t.pickupOn)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {tickets.length > 8 && (
            <button type="button" className="link-btn" onClick={() => go({ view: 'tickets' })}>
              See all {tickets.length} open tickets
            </button>
          )}
        </section>
      )}

      {pinned.length > 0 && (
        <section>
          <h2 className="section-title">Pinned</h2>
          <div className="card-grid">
            {pinned.map((n) => (
              <button key={n.id} type="button" className="card" onClick={() => go({ view: 'note', id: n.id })} onContextMenu={(e) => openMenu(e, noteMenu(n))}>
                <div className="card-title">
                  <ItemIcon icon={n.icon} color={n.color} fallback={Pin} /> {noteTitle(n.title)}
                </div>
                <div className="card-preview">{n.preview || 'Empty note'}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Recent</h2>
        {recent.length === 0 ? (
          <div className="empty-state welcome">
            <p>Welcome to Plannr. Create your first note to get started.</p>
            <p className="muted">
              Tip: press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to search, and type <kbd>/</kbd> inside a note for headings, checklists,
              toggles and images.
            </p>
          </div>
        ) : (
          <ul className="simple-list">
            {recent.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => go({ view: 'note', id: n.id })} onContextMenu={(e) => openMenu(e, noteMenu(n))}>
                  <ItemIcon icon={n.icon} color={n.color} fallback={FileText} />
                  <span className="simple-title">{noteTitle(n.title)}</span>
                  <span className="simple-meta">{relativeTime(n.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
