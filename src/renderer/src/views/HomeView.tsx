import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { findWhen } from '../../../shared/news-dates'
import { showToast } from '../lib/toast'
import { AlertTriangle, CalendarDays, DollarSign, FileText, Flag, Newspaper, Pin, Wrench, Plus } from 'lucide-react'
import { formatTicketNumber, type Task, type CalendarEvent, type Holiday, type MoneyOccurrence, type NewsFeed, type NewsItem, type WeatherForecast, type ListItem, type PackageInfo, type MoneySummary, type EntFeed, type TicketSummary } from '../../../shared/api'
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
import { useUi } from '../store/ui'
import { useNavName } from '../store/display'
import { HabitsPanel } from '../components/Habits'
import { weatherEmoji, weekdayShort } from '../lib/weather'
import { hiddenList, homeOrder, type HomeSection } from '../lib/homeSections'
import { dueLabel } from './TasksView'
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
  const homeOrderPref = useUi((s) => s.prefs.homeOrder)
  const homeHiddenPref = useUi((s) => s.prefs.homeHidden)
  const pinned = notes.filter((n) => n.pinned)
  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [bills, setBills] = useState<MoneyOccurrence[]>([])
  const [dueTasks, setDueTasks] = useState<Task[]>([])
  const [news, setNews] = useState<NewsFeed | null>(null)
  const ticketsName = useNavName('tickets', 'Tickets')
  const [forecast, setForecast] = useState<WeatherForecast | null>(null)
  const [listItems, setListItems] = useState<ListItem[]>([])
  const [parcels, setParcels] = useState<PackageInfo[]>([])
  const [moneyMonth, setMoneyMonth] = useState<MoneySummary | null>(null)
  const [ent, setEnt] = useState<EntFeed | null>(null)
  const [quick, setQuick] = useState('')
  const [spent, setSpent] = useState<{ category: string; cents: number }[]>([])
  const [lastMonth, setLastMonth] = useState<MoneySummary | null>(null)
  const tiles = useUi((s) => s.prefs.homeTiles) !== '0'
  const remote = useData((s) => s.remote) // changed on another device
  useEffect(() => {
    void upcomingBills(7).then(setBills)
    void api.tasks.list().then((list) => setDueTasks(list.filter((t) => t.dueDate && t.dueDate <= addDays(todayISO(), 1)).slice(0, 8)))
    void api.calendar.range(todayISO(), addDays(todayISO(), 7)).then(setUpcoming)
    void api.holidays.range(todayISO(), addDays(todayISO(), 7)).then(setHolidays)
    void api.tickets.list({ status: 'open' }).then((list) => setTickets(list.sort(byUrgency)))
    void api.news.feed().then(setNews)
    void api.weather.forecast().then(setForecast)
    void api.lists.items().then(setListItems)
    void api.packages.list().then((l) => setParcels(l.filter((p) => p.status !== 'delivered')))
    void api.money.summary(todayISO().slice(0, 7)).then(setMoneyMonth)
    {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - 1)
      void api.money.summary(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`).then(setLastMonth)
    }
    void api.money.transactions({ from: `${todayISO().slice(0, 7)}-01`, to: todayISO(), type: 'expense' }).then((list) => {
      const by = new Map<string, number>()
      for (const t of list) by.set(t.category || 'Other', (by.get(t.category || 'Other') ?? 0) + t.amountCents)
      setSpent([...by].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents).slice(0, 4))
    })
    void api.entertainment.feed().then(setEnt)
  }, [remote])
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  // Local news: what you need to know, then what's coming up this week, else the latest
  const newsItems: NewsItem[] = (() => {
    if (!news) return []
    const shown = news.items.filter((i) => !i.filtered && i.sourceKind !== 'weather' && i.page === 'local')
    const urgent = shown.filter((i) => i.important).slice(0, 3)
    const soon = shown.filter((i) => i.when && i.when.date >= todayISO() && i.when.date <= addDays(todayISO(), 7) && !urgent.includes(i)).slice(0, 3)
    const picked = [...urgent, ...soon]
    return picked.length ? picked : shown.slice(0, 3)
  })()

  const deals = news ? news.items.filter((i) => i.page !== 'local' && i.important && !i.filtered).slice(0, 5) : []
  const shopping = listItems.filter((i) => !i.done)
  const liveNow = ent?.live.filter((l) => l.live) ?? []
  const newVideos = ent?.videos.filter((v) => v.kind === 'youtube' && !v.watched && !v.short).slice(0, 4) ?? []

  const blocks: Record<HomeSection, ReactNode> = {
    weather: forecast && forecast.days.length > 0 && (
      <section>
        <h2 className="section-title">Weather · {forecast.place}</h2>
        <div className="home-forecast">
          {forecast.days.slice(0, 7).map((d, i) => (
            <button key={d.date} type="button" className="home-day" title={`${d.text}${d.rain ? `, ${d.rain}% chance of rain or snow` : ''}`} onClick={() => go({ view: 'calendar', date: d.date })}>
              <span className="small muted">{i === 0 ? 'Today' : weekdayShort(d.date)}</span>
              <span className="home-day-icon">{weatherEmoji(d.code)}</span>
              <b>{d.max}°</b>
              <span className="small muted">{d.min}°</span>
            </button>
          ))}
        </div>
      </section>
    ),
    habits: (
      <HomeTile title="Today’s habits" onOpen={() => go({ view: 'lists' })}>
        <HabitsPanel compact />
      </HomeTile>
    ),
    lists: shopping.length > 0 && (
      <section>
        <h2 className="section-title">
          Lists <span className="muted">{shopping.length}</span>
        </h2>
        <ul className="ticket-history">
          {shopping.slice(0, 6).map((i) => (
            <li key={i.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'lists' })}>
                <span className="history-main">{i.title}</span>
                <span className="history-date">{i.list}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
    packages: parcels.length > 0 && (
      <section>
        <h2 className="section-title">
          Packages on the way <span className="muted">{parcels.length}</span>
        </h2>
        <ul className="ticket-history">
          {parcels.slice(0, 5).map((p) => (
            <li key={p.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'packages' })}>
                <span className="history-main">
                  {p.label || p.number}
                  <span className="muted"> · {p.statusText || p.carrierName}</span>
                </span>
                <span className="history-date">{p.expected ? dayLabel(p.expected) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
    money: moneyMonth && (moneyMonth.incomeCents > 0 || moneyMonth.expenseCents > 0) && (
      <section>
        <h2 className="section-title">Money this month</h2>
        <div className="home-money" role="button" tabIndex={0} onClick={() => go({ view: 'money' })}>
          <div>
            <span className="small muted">In</span>
            <b className="money-in">{formatMoney(moneyMonth.incomeCents)}</b>
            {lastMonth && lastMonth.incomeCents > 0 && (
              <span className={`small ${moneyMonth.incomeCents >= lastMonth.incomeCents ? 'money-up' : 'money-down'}`} title="Compared with all of last month">
                {moneyMonth.incomeCents >= lastMonth.incomeCents ? '▲' : '▼'} {Math.abs(Math.round(((moneyMonth.incomeCents - lastMonth.incomeCents) / lastMonth.incomeCents) * 100))}% vs last month
              </span>
            )}
          </div>
          <div>
            <span className="small muted">Out</span>
            <b>{formatMoney(moneyMonth.expenseCents)}</b>
          </div>
          <div>
            <span className="small muted">Left</span>
            <b>{formatMoney(moneyMonth.incomeCents - moneyMonth.expenseCents)}</b>
          </div>
        </div>
        {spent.length > 0 && (
          <ul className="home-spent">
            {spent.map((s) => (
              <li key={s.category}>
                <span>{s.category}</span>
                <span className="home-spent-bar">
                  <span style={{ width: `${Math.round((s.cents / spent[0].cents) * 100)}%` }} />
                </span>
                <span className="small">{formatMoney(s.cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    ),
    deals: deals.length > 0 && (
      <section>
        <h2 className="section-title">Top picks</h2>
        <ul className="ticket-history">
          {deals.map((i) => (
            <li key={i.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'news', page: i.page })}>
                <span className="history-main">
                  {i.title}
                  <span className="muted"> · {news?.pages.find((p) => p.id === i.page)?.name}</span>
                </span>
                {i.discount !== null && <span className="news-discount">−{i.discount}%</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
    live: (liveNow.length > 0 || newVideos.length > 0) && (
      <section>
        <h2 className="section-title">Entertainment</h2>
        <ul className="ticket-history">
          {liveNow.map((l) => (
            <li key={l.channelId}>
              <a className="history-row" href={l.url} target="_blank" rel="noreferrer">
                <span className="ent-live-badge inline">LIVE</span>
                <span className="history-main">
                  {l.name}
                  <span className="muted"> · {l.title}</span>
                </span>
              </a>
            </li>
          ))}
          {newVideos.map((v) => (
            <li key={v.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'entertainment' })}>
                <span className="history-main">
                  {v.title}
                  <span className="muted"> · {v.channelName}</span>
                </span>
                <span className="history-date">{relativeTime(v.publishedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
    news: news && news.sources.some((s) => !s.page) && (newsItems.length > 0 || news.weather) && (
      <section>
        <h2 className="section-title">
          Around {news.prefs.place?.name ?? 'you'}
          {news.weather?.temp != null && (
            <span className="muted">
              {' '}
              · {news.weather.temp}° {news.weather.now}
            </span>
          )}
        </h2>
        <ul className="ticket-history">
          {news.weather?.warnings.map((w) => (
            <li key={w.title}>
              <button type="button" className="history-row" onClick={() => go({ view: 'news' })}>
                <AlertTriangle className="row-lead news-urgent-icon" />
                <span className="history-main">{w.title}</span>
                <span className="history-date">Weather</span>
              </button>
            </li>
          ))}
          {newsItems.map((i) => (
            <li key={i.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'news' })}>
                {i.important ? <AlertTriangle className="row-lead news-urgent-icon" /> : i.when ? <CalendarDays className="row-lead" /> : <Newspaper className="row-lead" />}
                {i.when && <span className="upcoming-day">{dayLabel(i.when.date)}</span>}
                <span className="history-main">
                  {i.title}
                  <span className="muted"> · {i.sourceName}</span>
                </span>
                <span className="history-date">{relativeTime(i.publishedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ),
    tasks: dueTasks.length > 0 && (
      <section>
        <h2 className="section-title">
          Tasks due <span className="muted">{dueTasks.length}</span>
        </h2>
        <ul className="ticket-history">
          {dueTasks.map((t) => (
            <li key={t.id}>
              <div className="history-row task-home-row">
                <button
                  type="button"
                  className="task-check"
                  role="checkbox"
                  aria-checked={false}
                  aria-label={`Done: ${t.title}`}
                  onClick={async () => {
                    await api.tasks.update(t.id, { done: true })
                    setDueTasks((list) => list.filter((x) => x.id !== t.id))
                    void useData.getState().refreshCounts()
                  }}
                />
                <button type="button" className="history-main link-like" onClick={() => go({ view: 'tasks' })}>
                  {t.title}
                </button>
                <span className={`history-date ${t.dueDate! < todayISO() ? 'overdue' : ''}`}>{dueLabel(t.dueDate!)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    ),
    coming: (upcoming.length > 0 || holidays.length > 0 || bills.length > 0) && (
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
                  <span className="muted">
                    {' '}
                    · {b.kind === 'subscription' ? 'renews' : 'due'}
                    {b.autopay ? ' (auto-pay)' : ''}
                  </span>
                </span>
                <span className="history-date">{formatMoney(b.amountCents)}</span>
              </button>
            </li>
          ))}
          {upcoming.map((e) => (
            <li key={e.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'calendar', date: e.date, eventId: e.id })}>
                {e.kind === 'pickup' ? <Wrench className="row-lead" /> : <CalendarDays className="row-lead" />}
                <span className="upcoming-day">
                  {dayLabel(e.date)}
                  {(forecast?.days.find((d) => d.date === e.date)?.rain ?? 0) >= 60 && (
                    <span className="rain-note" title={`${forecast?.days.find((d) => d.date === e.date)?.rain}% chance of rain or snow`}>
                      {' '}
                      ☔
                    </span>
                  )}
                </span>
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
    ),
    tickets: tickets.length > 0 && (
      <section>
        <h2 className="section-title">
          Open {ticketsName.toLowerCase()} <span className="muted">{tickets.length}</span>
        </h2>
        <ul className="ticket-history">
          {tickets.slice(0, 8).map((t) => (
            <li key={t.id}>
              <button type="button" className="history-row" onClick={() => go({ view: 'ticket', id: t.id })}>
                <span className="mono">{formatTicketNumber(t.number)}</span>
                <span className="history-main">
                  {t.customerName || 'No customer'}
                  <span className="muted"> · {t.device || 'Untitled'}</span>
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
    ),
    pinned: pinned.length > 0 && (
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
    ),
    recent: (
      <section>
        <h2 className="section-title">Recent</h2>
        {recent.length === 0 ? (
          <div className="empty-state welcome">
            <p>Welcome to Plannr. Create your first note to get started.</p>
            <p className="muted">
              Tip: press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to search, and type <kbd>/</kbd> inside a note for headings, checklists, toggles and images.
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
    )
  }
  const shown = homeOrder(homeOrderPref).filter((id) => !hiddenList(homeHiddenPref).includes(id))

  return (
    <div className={`page home ${tiles ? 'tiles' : ''}`}>
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

      <form
        className="home-quick-add"
        onSubmit={async (e) => {
          e.preventDefault()
          const text = quick.trim()
          if (!text) return
          // "Call Rosa tomorrow at 3pm" → a task due tomorrow at 15:00 (the date words stay in the title)
          const when = findWhen(text, new Date())
          await api.tasks.create({ title: text, dueDate: when?.date ?? null, dueTime: when?.startTime ?? null })
          setQuick('')
          void useData.getState().refreshCounts()
          void api.tasks.list().then((list) => setDueTasks(list.filter((t) => t.dueDate && t.dueDate <= addDays(todayISO(), 1)).slice(0, 8)))
          showToast(when ? `Task added for ${dayLabel(when.date)}${when.startTime ? ` at ${formatTime(when.startTime)}` : ''}` : 'Task added', { label: 'Open', run: () => go({ view: 'tasks' }) })
        }}
      >
        <Plus />
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Quick add a task… e.g. “Call Rosa tomorrow at 3pm”" aria-label="Quick add a task" />
      </form>

      <div className={tiles ? 'home-grid' : ''}>
        {shown.map((id) => (
          <Fragment key={id}>{blocks[id]}</Fragment>
        ))}
      </div>
    </div>
  )
}

/** A Home section whose content may render nothing (it hides itself then) */
function HomeTile({ title, onOpen, children }: { title: string; onOpen: () => void; children: ReactNode }) {
  return (
    <section className="home-tile-section">
      <h2 className="section-title">
        <button type="button" className="link-like" onClick={onOpen}>
          {title}
        </button>
      </h2>
      {children}
    </section>
  )
}
