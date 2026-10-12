import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import type { ListItem } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { HabitsPanel } from '../components/Habits'

/** Check-off lists (shopping and anything else) and your daily habits. */
export function ListsView() {
  const [items, setItems] = useState<ListItem[]>([])
  const [title, setTitle] = useState('')
  const [newList, setNewList] = useState<string | null>(null)
  const current = useUi((s) => s.prefs.currentList) || 'Shopping'
  const setPref = useUi((s) => s.setPref)
  const input = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => setItems(await api.lists.items()), [])
  useEffect(() => {
    void load()
  }, [load])

  const lists = useMemo(() => [...new Set(['Shopping', ...items.map((i) => i.list), current])], [items, current])
  const mine = items.filter((i) => i.list === current)
  const open = mine.filter((i) => !i.done)
  const done = mine.filter((i) => i.done)

  const add = async (): Promise<void> => {
    const lines = title
      .split(/\n|,(?=\s)/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (!lines.length) return
    for (const t of lines) await api.lists.add(current, t)
    setTitle('')
    void load()
    input.current?.focus()
  }
  const toggle = async (i: ListItem): Promise<void> => {
    setItems((l) => l.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))
    await api.lists.update(i.id, { done: !i.done })
  }

  return (
    <div className="page lists-page">
      <div className="list-header">
        <h1>Lists</h1>
      </div>
      <div className="news-tabs" role="tablist" aria-label="Lists">
        {lists.map((l) => (
          <button key={l} type="button" role="tab" aria-selected={l === current} className={`chip-btn ${l === current ? 'active' : ''}`} onClick={() => setPref('currentList', l === 'Shopping' ? '' : l)}>
            {l} {items.some((i) => i.list === l && !i.done) && <span className="muted">· {items.filter((i) => i.list === l && !i.done).length}</span>}
          </button>
        ))}
        {newList === null ? (
          <button type="button" className="chip-btn" onClick={() => setNewList('')}>
            <Plus /> New list
          </button>
        ) : (
          <form
            className="list-new"
            onSubmit={(e) => {
              e.preventDefault()
              if (newList.trim()) setPref('currentList', newList.trim())
              setNewList(null)
            }}
          >
            <input autoFocus value={newList} onChange={(e) => setNewList(e.target.value)} placeholder="List name" aria-label="New list name" onBlur={() => !newList.trim() && setNewList(null)} />
          </form>
        )}
      </div>

      <form
        className="task-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Plus className="task-add-icon" />
        <input ref={input} autoFocus value={title} placeholder={`Add to ${current}… (press Enter; commas add several)`} aria-label="New item" onChange={(e) => setTitle(e.target.value)} />
      </form>

      <ul className="list-items">
        {open.map((i) => (
          <ListRow key={i.id} item={i} onToggle={() => void toggle(i)} onRemove={() => void api.lists.remove(i.id).then(load)} />
        ))}
      </ul>
      {open.length === 0 && <p className="muted small">Nothing on this list.</p>}
      {done.length > 0 && (
        <>
          <div className="task-section-head">
            <h2 className="section-title">Ticked {done.length}</h2>
            <button type="button" className="btn sm" onClick={() => void api.lists.clearDone(current).then(load)}>
              Clear ticked
            </button>
          </div>
          <ul className="list-items done">
            {done.map((i) => (
              <ListRow key={i.id} item={i} onToggle={() => void toggle(i)} onRemove={() => void api.lists.remove(i.id).then(load)} />
            ))}
          </ul>
        </>
      )}
      {current !== 'Shopping' && mine.length > 0 && (
        <button type="button" className="link-btn small muted list-delete" onClick={() => void api.lists.removeList(current).then(() => (setPref('currentList', ''), load()))}>
          Delete the “{current}” list
        </button>
      )}

      <h2 className="section-title habits-title">Daily habits</h2>
      <HabitsPanel />
    </div>
  )
}

function ListRow({ item, onToggle, onRemove }: { item: ListItem; onToggle: () => void; onRemove: () => void }) {
  return (
    <li className={`list-item ${item.done ? 'done' : ''}`}>
      <button type="button" className="habit-check" role="checkbox" aria-checked={item.done} aria-label={`${item.done ? 'Untick' : 'Tick'} ${item.title}`} onClick={onToggle}>
        {item.done && <Check />}
      </button>
      <span className="list-title">{item.title}</span>
      <button type="button" className="icon-btn sm" aria-label={`Remove ${item.title}`} onClick={onRemove}>
        {item.done ? <Trash2 /> : <X />}
      </button>
    </li>
  )
}
