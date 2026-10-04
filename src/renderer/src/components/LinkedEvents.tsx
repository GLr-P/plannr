import { useEffect, useState } from 'react'
import { CalendarDays, Wrench } from 'lucide-react'
import type { CalendarEvent } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { formatDay } from '../lib/format'
import { formatTime } from '../lib/time'

/** "On the calendar": events linked to this ticket/customer/note; click to see it on the calendar. */
export function LinkedEvents({ id, refreshKey }: { id: string; refreshKey?: unknown }) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  useEffect(() => {
    void api.calendar.forLink(id).then(setEvents)
  }, [id, refreshKey])
  if (!events.length) return null
  return (
    <section className="backlinks">
      <h3>On the calendar</h3>
      {events.map((e) => (
        <button key={e.id} type="button" className="backlink" onClick={() => go({ view: 'calendar', date: e.date, eventId: e.id })}>
          {e.kind === 'pickup' ? <Wrench /> : <CalendarDays />}
          <span className="backlink-date">{formatDay(e.date)}</span>
          {e.startTime && <span className="muted">{formatTime(e.startTime)}</span>}
          <span>{e.title}</span>
        </button>
      ))}
    </section>
  )
}
