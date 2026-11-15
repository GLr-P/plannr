import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { STATUS_COLORS, ticketStatuses, type StatusDef } from '../../../shared/api'
import { api } from '../api'
import { saveDisplay, useDisplay, useNavName } from '../store/display'
import { singular } from '../lib/navOrder'
import { useData } from '../store/data'

/**
 * Your ticket statuses: rename, recolour, reorder, add and remove them, and say which ones mean the ticket is
 * finished or waiting on the customer. Opened from the status menu on a ticket, the tickets list and Settings.
 */
export function StatusEditor() {
  useDisplay((s) => s.version) // re-render when they change (here or on another device)
  const many = useNavName('tickets', 'Tickets').toLowerCase()
  const one = singular(many)
  const statuses = ticketStatuses()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [removing, setRemoving] = useState<{ id: string; to: string } | null>(null)
  useEffect(() => void api.tickets.statusCounts().then(setCounts), [])

  const save = async (next: StatusDef[]): Promise<void> => {
    await saveDisplay({ statuses: next })
    void useData.getState().refreshCounts()
  }
  const patch = (id: string, p: Partial<StatusDef>): Promise<void> =>
    save(statuses.map((s) => (s.id === id ? { ...s, ...p, ...(p.done ? { ready: false } : {}), ...(p.ready ? { done: false } : {}) } : s)))
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= statuses.length) return
    const next = [...statuses]
    ;[next[i], next[j]] = [next[j], next[i]]
    void save(next)
  }
  const add = async (): Promise<void> => {
    const id = `s_${Date.now().toString(36)}`
    await save([...statuses, { id, label: 'New status', color: 'blue', done: false, ready: false }])
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`.status-editor [data-status="${id}"] input.status-name`)
      input?.focus()
      input?.select()
    })
  }
  const remove = async (id: string, to: string | null): Promise<void> => {
    if (to) await api.tickets.moveStatus(id, to)
    setRemoving(null)
    await save(statuses.filter((s) => s.id !== id))
    setCounts(await api.tickets.statusCounts())
  }

  return (
    <div className="status-editor">
      <p className="muted small">
        The steps a {one} goes through. New {many} start in the first one.
      </p>
      <ul>
        {statuses.map((s, i) => (
          <li key={s.id} data-status={s.id}>
            <div className="status-edit-row">
              <button
                type="button"
                className={`status-swatch tone-${s.color}`}
                title="Change colour"
                aria-label={`Colour of ${s.label}`}
                onClick={() => void patch(s.id, { color: STATUS_COLORS[(STATUS_COLORS.indexOf(s.color as (typeof STATUS_COLORS)[number]) + 1) % STATUS_COLORS.length] })}
              />
              <StatusName value={s.label} onSave={(label) => void patch(s.id, { label })} />
              <span className="muted small status-count">{counts[s.id] ? `${counts[s.id]}` : ''}</span>
              <button type="button" className="icon-btn sm" aria-label={`Move ${s.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ChevronUp />
              </button>
              <button type="button" className="icon-btn sm" aria-label={`Move ${s.label} down`} disabled={i === statuses.length - 1} onClick={() => move(i, 1)}>
                <ChevronDown />
              </button>
              <button
                type="button"
                className="icon-btn sm"
                aria-label={`Remove ${s.label}`}
                disabled={statuses.length < 2}
                onClick={() => (counts[s.id] ? setRemoving({ id: s.id, to: statuses.find((x) => x.id !== s.id)!.id }) : void remove(s.id, null))}
              >
                <Trash2 />
              </button>
            </div>
            <div className="status-flags">
              <label>
                <input type="checkbox" checked={s.done} onChange={(e) => void patch(s.id, { done: e.target.checked })} /> Finished
              </label>
              <label>
                <input type="checkbox" checked={s.ready} onChange={(e) => void patch(s.id, { ready: e.target.checked })} /> Waiting on someone
              </label>
            </div>
            {removing?.id === s.id && (
              <div className="status-remove">
                Move its {counts[s.id]} ticket{counts[s.id] === 1 ? '' : 's'} to
                <select value={removing.to} aria-label="Move its tickets to" onChange={(e) => setRemoving({ id: s.id, to: e.target.value })}>
                  {statuses
                    .filter((x) => x.id !== s.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                </select>
                <button type="button" className="btn sm danger" onClick={() => void remove(s.id, removing.to)}>
                  Move and remove
                </button>
                <button type="button" className="btn sm" onClick={() => setRemoving(null)}>
                  Keep
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn sm" onClick={() => void add()}>
        <Plus /> New status
      </button>
    </div>
  )
}

function StatusName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className="status-name"
      value={text}
      aria-label="Status name"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text.trim() !== value && onSave(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
