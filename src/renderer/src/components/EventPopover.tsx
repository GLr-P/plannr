import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, ExternalLink, X } from 'lucide-react'
import { REMINDER_SCHEDULE, type CalendarEvent, type EventUpdate, type ReminderKind } from '../../../shared/api'
import { api } from '../api'
import { openEntity } from '../actions'
import { useAutosave } from '../lib/useAutosave'
import { ConfirmButton } from './common'
import { EntityIcon } from './EntityIcon'

export interface PopoverAnchor {
  x: number
  y: number
}

/** Keeps a floating panel inside the window, preferring the right side of the anchor. */
function usePlacement(anchor: PopoverAnchor) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 12
    let left = anchor.x + 8
    if (left + width > window.innerWidth - margin) left = Math.max(margin, anchor.x - width - 8)
    const top = Math.min(Math.max(margin + 44, anchor.y - 20), window.innerHeight - height - margin)
    setPos({ left, top })
  }, [anchor.x, anchor.y])
  return { ref, pos }
}

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Defer so the click that opened the popover doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, onClose])
}

/** Edit an existing event in place. Text saves as you type; everything else saves immediately. */
export function EventPopover({
  event,
  anchor,
  onChanged,
  onClose
}: {
  event: CalendarEvent
  anchor: PopoverAnchor
  onChanged: () => void
  onClose: () => void
}) {
  const [ev, setEv] = useState(event)
  const { ref, pos } = usePlacement(anchor)
  useDismiss(ref, onClose)

  const saver = useAutosave<EventUpdate>(async (patch) => {
    setEv(await api.calendar.update(event.id, patch))
    onChanged()
  }, 300)

  const change = (patch: EventUpdate, immediate = false): void => {
    setEv((cur) => ({ ...cur, ...patch }))
    saver.queue(patch)
    if (immediate) void saver.flush()
  }

  const toggleReminder = (kind: ReminderKind, on: boolean): void => {
    const next = on ? [...ev.reminders, kind] : ev.reminders.filter((k) => k !== kind)
    change({ reminders: next }, true)
  }

  return (
    <div className="popover event-popover" ref={ref} style={pos} role="dialog" aria-label="Event">
      <div className="popover-head">
        <input
          className="popover-title"
          value={ev.title}
          placeholder="What’s happening?"
          autoFocus
          onChange={(e) => change({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void saver.flush()
              onClose()
            }
          }}
          aria-label="Event title"
        />
        <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </div>

      {ev.linkId && ev.linkType && (
        <button
          type="button"
          className="popover-link"
          disabled={ev.linkDeleted}
          onClick={() => {
            void saver.flush()
            openEntity(ev.linkType!, ev.linkId!)
          }}
          title={ev.linkDeleted ? 'This item was deleted' : 'Open'}
        >
          <EntityIcon type={ev.linkType} />
          <span className="popover-link-title">
            {ev.linkTitle}
            {ev.linkDeleted && ' (deleted)'}
          </span>
          {!ev.linkDeleted && <ExternalLink className="popover-link-go" />}
        </button>
      )}

      <div className="popover-row">
        <input type="date" value={ev.date} onChange={(e) => e.target.value && change({ date: e.target.value }, true)} aria-label="Date" />
        <label className="check">
          <input
            type="checkbox"
            checked={ev.startTime === null}
            onChange={(e) => change(e.target.checked ? { startTime: null, endTime: null } : { startTime: '09:00', endTime: '10:00' }, true)}
          />
          All day
        </label>
      </div>
      {ev.startTime !== null && (
        <div className="popover-row">
          <input type="time" value={ev.startTime} onChange={(e) => e.target.value && change({ startTime: e.target.value }, true)} aria-label="Start time" />
          <span className="muted">to</span>
          <input type="time" value={ev.endTime ?? ''} onChange={(e) => change({ endTime: e.target.value || null }, true)} aria-label="End time" />
        </div>
      )}

      {ev.linkType === 'ticket' && (
        <label className="check">
          <input type="checkbox" checked={ev.kind === 'pickup'} onChange={(e) => change({ kind: e.target.checked ? 'pickup' : 'event' }, true)} />
          This is the ticket’s pickup date
        </label>
      )}

      <div className="popover-section">
        <div className="popover-label">
          <Bell /> Remind me
        </div>
        {(Object.keys(REMINDER_SCHEDULE) as ReminderKind[]).map((kind) => (
          <label key={kind} className="check">
            <input type="checkbox" checked={ev.reminders.includes(kind)} onChange={(e) => toggleReminder(kind, e.target.checked)} />
            {REMINDER_SCHEDULE[kind].label}
          </label>
        ))}
        {ev.linkDone && <div className="muted small">Ticket is picked up, so reminders are off.</div>}
      </div>

      <textarea className="popover-notes" value={ev.notes} placeholder="Notes" onChange={(e) => change({ notes: e.target.value })} aria-label="Event notes" />

      <div className="popover-foot">
        <ConfirmButton
          title="Delete event"
          label="Delete"
          onConfirm={async () => {
            await api.calendar.remove(event.id)
            onChanged()
            onClose()
          }}
        />
        <span className="muted small">{saver.status === 'saved' ? 'Saved' : 'Saving…'}</span>
      </div>
    </div>
  )
}

/** Quick-add: type a title, Enter to create. */
export function NewEventPopover({
  date,
  startTime,
  anchor,
  onCreated,
  onClose
}: {
  date: string
  startTime: string | null
  anchor: PopoverAnchor
  onCreated: (event: CalendarEvent) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const { ref, pos } = usePlacement(anchor)
  useDismiss(ref, onClose)

  const create = async (): Promise<void> => {
    if (!title.trim()) return onClose()
    const endTime = startTime ? `${String(Math.min(Number(startTime.slice(0, 2)) + 1, 23)).padStart(2, '0')}${startTime.slice(2)}` : null
    onCreated(await api.calendar.create({ title: title.trim(), date, startTime, endTime }))
  }

  const [y, m, d] = date.split('-').map(Number)
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="popover event-popover" ref={ref} style={pos} role="dialog" aria-label="New event">
      <div className="popover-label">
        New event · {label}
        {startTime && ` · ${startTime}`}
      </div>
      <input
        className="popover-title"
        autoFocus
        value={title}
        placeholder="What’s happening?"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
        aria-label="New event title"
      />
      <div className="popover-foot">
        <span className="muted small">Enter to add · Esc to cancel</span>
        <button type="button" className="btn sm primary" onClick={() => void create()}>
          Add
        </button>
      </div>
    </div>
  )
}
