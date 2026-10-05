import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventContentArg, EventInput as FcEventInput } from '@fullcalendar/core'
import { ChevronLeft, ChevronRight, Flag, PanelLeft, Plus, Search, Wrench } from 'lucide-react'
import { formatTicketNumber, type CalendarEvent, type Holiday, type TicketSummary } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { DRAG_MIME, openEntity, readDrag } from '../actions'
import { formatDay, todayISO } from '../lib/format'
import { EntityIcon } from '../components/EntityIcon'
import { EventPopover, NewEventPopover, type PopoverAnchor } from '../components/EventPopover'

type ViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'
const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'dayGridMonth', label: 'Month' },
  { id: 'timeGridWeek', label: 'Week' },
  { id: 'timeGridDay', label: 'Day' }
]

const pad = (n: number): string => String(n).padStart(2, '0')
const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** The date being viewed, so leaving the calendar and coming back keeps your place. */
let lastViewed: string | undefined

type Popover =
  | { kind: 'edit'; event: CalendarEvent; anchor: PopoverAnchor }
  | { kind: 'new'; date: string; startTime: string | null; anchor: PopoverAnchor }

export function CalendarView({ date, eventId }: { date?: string; eventId?: string }) {
  const calRef = useRef<FullCalendar>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const view = (useUi((s) => s.prefs.calendarView) as ViewName | undefined) ?? 'dayGridMonth'
  const setPref = useUi((s) => s.setPref)
  const trayOpen = useUi((s) => s.collapsed['calendar:tray'] === false) // closed unless opened
  const setCollapsed = useUi((s) => s.setCollapsed)
  const [title, setTitle] = useState('')
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [version, setVersion] = useState(0) // bumps on every reload so the ticket tray refreshes too
  const [popover, setPopover] = useState<Popover | null>(null)
  const dropCell = useRef<HTMLElement | null>(null)

  const reload = useCallback(async () => {
    if (!range) return
    const [evs, hols] = await Promise.all([api.calendar.range(range.from, range.to), api.holidays.range(range.from, range.to)])
    setEvents(evs)
    setHolidays(hols)
    setVersion((v) => v + 1)
  }, [range])
  useEffect(() => {
    void reload()
  }, [reload])

  // Arriving from a link ("On the calendar", Home): jump to the date and open the event.
  useEffect(() => {
    if (date) calRef.current?.getApi().gotoDate(date)
    if (!eventId) return
    void api.calendar.get(eventId).then((ev) => {
      if (ev) setPopover({ kind: 'edit', event: ev, anchor: { x: window.innerWidth / 2 - 160, y: 160 } })
    })
  }, [date, eventId])

  const fcEvents: FcEventInput[] = useMemo(
    () => [
      // Holidays (from Google's public holiday calendar): read-only, listed first in each day
      ...holidays.map((h) => ({
        id: h.id,
        title: h.title,
        start: h.date,
        allDay: true,
        editable: false,
        order: 0,
        classNames: ['ev-holiday', h.observance ? 'ev-observance' : ''],
        extendedProps: { holiday: h }
      })),
      ...events.map((e) => ({
        order: 1,
        id: e.id,
        title: e.title || '(untitled)',
        start: e.startTime ? `${e.date}T${e.startTime}` : e.date,
        end: e.startTime && e.endTime ? `${e.date}T${e.endTime}` : undefined,
        allDay: !e.startTime,
        classNames: [`ev-${e.kind}`, e.linkDone ? 'ev-done' : ''],
        extendedProps: { ev: e }
      }))
    ],
    [events, holidays]
  )

  const api_ = () => calRef.current?.getApi()

  /** Date (and time, in week/day view) of the calendar cell under the pointer. */
  const cellAt = (x: number, y: number): { el: HTMLElement; date: string; time: string | null } | null => {
    const stack = document.elementsFromPoint(x, y) as HTMLElement[]
    const dayEl = stack.find((el) => el.matches?.('[data-date]') && wrapRef.current?.contains(el))
    if (!dayEl) return null
    const timeEl = stack.find((el) => el.matches?.('.fc-timegrid-slot[data-time]'))
    const date = dayEl.dataset.date!.slice(0, 10)
    return { el: dayEl, date, time: timeEl?.dataset.time ? timeEl.dataset.time.slice(0, 5) : null }
  }

  const highlight = (el: HTMLElement | null): void => {
    if (dropCell.current === el) return
    dropCell.current?.classList.remove('drop-target')
    el?.classList.add('drop-target')
    dropCell.current = el
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    highlight(null)
    const item = readDrag(e)
    const cell = cellAt(e.clientX, e.clientY)
    if (!item || !cell) return
    const ev = await api.calendar.drop(item, cell.date, cell.time)
    await reload()
    setPopover({ kind: 'edit', event: ev, anchor: { x: e.clientX, y: e.clientY } }) // edit the text right away
  }

  const renderEvent = (arg: EventContentArg) => {
    const holiday = arg.event.extendedProps.holiday as Holiday | undefined
    if (holiday)
      return (
        <div className="ev-chip" title={`${holiday.title}${holiday.observance ? ' (observance)' : ' (holiday)'}`}>
          <Flag className="ev-icon" />
          <span className="ev-title">{holiday.title}</span>
        </div>
      )
    const ev = arg.event.extendedProps.ev as CalendarEvent
    return (
      <div className="ev-chip" title={ev.linkTitle ? `${ev.title}\n${ev.linkTitle}` : ev.title}>
        {ev.kind === 'pickup' ? <Wrench className="ev-icon" /> : ev.linkType ? <EntityIcon type={ev.linkType} className="ev-icon" /> : null}
        {arg.timeText && <span className="ev-time">{arg.timeText}</span>}
        <span className="ev-title">{arg.event.title}</span>
      </div>
    )
  }

  return (
    <div className="calendar-page">
      <div className="cal-toolbar">
        <button type="button" className="btn sm" onClick={() => api_()?.today()}>
          Today
        </button>
        <button type="button" className="icon-btn" aria-label="Previous" onClick={() => api_()?.prev()}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" aria-label="Next" onClick={() => api_()?.next()}>
          <ChevronRight />
        </button>
        <h1 className="cal-title">{title}</h1>
        <span className="cal-spacer" />
        <div className="segmented" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'active' : ''}
              onClick={() => {
                setPref('calendarView', v.id)
                api_()?.changeView(v.id)
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn sm ${trayOpen ? 'active-btn' : ''}`}
          onClick={() => setCollapsed('calendar:tray', trayOpen)}
          title="Show open tickets to drag onto the calendar"
        >
          <PanelLeft /> Tickets
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={(e) => setPopover({ kind: 'new', date: todayISO(), startTime: null, anchor: { x: e.clientX - 300, y: e.clientY + 20 } })}
        >
          <Plus /> Event
        </button>
      </div>

      <div className="cal-body">
        {trayOpen && <TicketTray refreshKey={version} />}
        <div
          className="cal-wrap"
          ref={wrapRef}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return
            e.preventDefault() // no dropEffect: sources differ (sidebar notes 'move', tickets 'link'); a mismatch would block the drop
            highlight(cellAt(e.clientX, e.clientY)?.el ?? null)
          }}
          onDragLeave={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node)) highlight(null)
          }}
          onDrop={(e) => void onDrop(e)}
        >
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={view}
            initialDate={date ?? lastViewed}
            headerToolbar={false}
            height="100%"
            editable
            dayMaxEvents={4}
            nowIndicator
            fixedWeekCount={false}
            slotMinTime="06:00:00"
            slotMaxTime="22:00:00"
            scrollTime="08:00:00"
            allDayText="All day"
            events={fcEvents}
            eventContent={renderEvent}
            datesSet={(arg) => {
              setTitle(arg.view.title)
              lastViewed = isoDate(arg.view.calendar.getDate()) // today, unless you navigated elsewhere
              const last = new Date(arg.end)
              last.setDate(last.getDate() - 1)
              setRange({ from: isoDate(arg.start), to: isoDate(last) })
            }}
            eventOrder="order,start,title"
            eventClick={(info) => {
              info.jsEvent.preventDefault()
              if (info.event.extendedProps.holiday) return // holidays are read-only
              const r = info.el.getBoundingClientRect()
              setPopover({ kind: 'edit', event: info.event.extendedProps.ev as CalendarEvent, anchor: { x: r.right, y: r.top } })
            }}
            eventDidMount={(info) => {
              // Double-click opens the linked ticket/customer/note directly.
              const ev = info.event.extendedProps.ev as CalendarEvent | undefined
              if (ev?.linkType && ev.linkId && !ev.linkDeleted) info.el.addEventListener('dblclick', () => openEntity(ev.linkType!, ev.linkId!))
            }}
            dateClick={(info) => {
              const timed = !info.allDay
              setPopover({
                kind: 'new',
                date: isoDate(info.date),
                startTime: timed ? hhmm(info.date) : null,
                anchor: { x: info.jsEvent.clientX, y: info.jsEvent.clientY }
              })
            }}
            eventDrop={async (info) => {
              const start = info.event.start!
              const allDay = info.event.allDay
              await api.calendar.update(info.event.id, {
                date: isoDate(start),
                startTime: allDay ? null : hhmm(start),
                endTime: allDay || !info.event.end ? null : hhmm(info.event.end)
              })
              await reload()
            }}
            eventResize={async (info) => {
              if (info.event.end && !info.event.allDay) await api.calendar.update(info.event.id, { endTime: hhmm(info.event.end) })
              await reload()
            }}
          />
        </div>
      </div>

      {popover?.kind === 'edit' && (
        <EventPopover key={popover.event.id} event={popover.event} anchor={popover.anchor} onChanged={() => void reload()} onClose={() => setPopover(null)} />
      )}
      {popover?.kind === 'new' && (
        <NewEventPopover
          date={popover.date}
          startTime={popover.startTime}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onCreated={async () => {
            setPopover(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

/** Open tickets to drag onto a day (= schedule that ticket's pickup). */
function TicketTray({ refreshKey }: { refreshKey: number }) {
  const [query, setQuery] = useState('')
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  useEffect(() => {
    const t = setTimeout(() => void api.tickets.list({ status: 'open', query }).then(setTickets), 60)
    return () => clearTimeout(t)
  }, [query, refreshKey])

  return (
    <aside className="ticket-tray" aria-label="Open tickets">
      <div className="tray-hint">Drag a ticket onto a day to set its pickup.</div>
      <div className="filter-field tray-search">
        <Search />
        <input value={query} placeholder="Find a ticket…" onChange={(e) => setQuery(e.target.value)} aria-label="Find a ticket" />
      </div>
      <div className="tray-list">
        {tickets.length === 0 && <div className="muted small tray-empty">No open tickets.</div>}
        {tickets.map((t) => (
          <div
            key={t.id}
            className="tray-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: 'ticket', id: t.id }))
              e.dataTransfer.effectAllowed = 'link'
            }}
            onDoubleClick={() => openEntity('ticket', t.id)}
            title="Drag onto a day · double-click to open"
          >
            <div className="tray-item-top">
              <span className="mono">{formatTicketNumber(t.number)}</span>
              {t.pickupOn && <span className="tray-pickup">Pickup {formatDay(t.pickupOn)}</span>}
            </div>
            <div className="tray-item-main">{t.customerName || 'No customer'}</div>
            <div className="tray-item-sub">{t.device || 'No device'}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}
