import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { statusLabel, TICKET_STATUSES, type TicketStatus } from '../../../shared/api'
import type { SaveStatus } from '../lib/useAutosave'
import { relativeTime } from '../lib/format'

/** Click once to arm, click again within 3 seconds to confirm. */
export function ConfirmButton({ title, onConfirm, label }: { title: string; onConfirm: () => void | Promise<void>; label?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`${label ? 'btn' : 'icon-btn sm'} ${armed ? 'danger armed' : ''}`}
      title={armed ? 'Click again to confirm' : title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        if (armed) void onConfirm()
        else setArmed(true)
      }}
    >
      <Trash2 />
      {label && <span>{armed ? 'Click again to confirm' : label}</span>}
    </button>
  )
}

export function StatusPill({ status }: { status: TicketStatus }) {
  return <span className={`status status-${status}`}>{statusLabel(status)}</span>
}

export function StatusSelect({ value, onChange }: { value: TicketStatus; onChange: (s: TicketStatus) => void }) {
  return (
    <select className={`status status-select status-${value}`} value={value} onChange={(e) => onChange(e.target.value as TicketStatus)} aria-label="Status">
      {TICKET_STATUSES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

export function SaveIndicator({ status, updatedAt }: { status: SaveStatus; updatedAt: number }) {
  return (
    <span className="save-status" data-status={status}>
      {status === 'saved' ? `Saved · ${relativeTime(updatedAt)}` : 'Saving…'}
    </span>
  )
}
