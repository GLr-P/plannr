import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { statusDef, statusLabel, ticketStatuses, type TicketStatus } from '../../../shared/api'
import { useDisplay } from '../store/display'
import { openPanel } from './ContextMenu'
import { StatusEditor } from './StatusEditor'
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

/** A status's colour class (your colour for it; grey for a status that was removed) */
export const statusTone = (status: TicketStatus): string => `tone-${statusDef(status)?.color ?? 'gray'}`

export function StatusPill({ status }: { status: TicketStatus }) {
  useDisplay((s) => s.version) // your statuses' names and colours
  return <span className={`status ${statusTone(status)}`}>{statusLabel(status)}</span>
}

/** Opens the status editor under an element */
export const editStatuses = (anchor: HTMLElement): void => openPanel(anchor, 'Statuses', () => <StatusEditor />)

/** The status of a ticket, with "Edit statuses…" at the bottom to change the list right there */
export function StatusSelect({ value, onChange }: { value: TicketStatus; onChange: (s: TicketStatus) => void }) {
  useDisplay((s) => s.version)
  const statuses = ticketStatuses()
  return (
    <select
      className={`status status-select ${statusTone(value)}`}
      value={value}
      onChange={(e) => {
        if (e.target.value === '__edit') return editStatuses(e.currentTarget)
        onChange(e.target.value as TicketStatus)
      }}
      aria-label="Status"
    >
      {statuses.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
      {!statuses.some((s) => s.id === value) && <option value={value}>{statusLabel(value)}</option>}
      <option disabled>──────────</option>
      <option value="__edit">Edit statuses…</option>
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
