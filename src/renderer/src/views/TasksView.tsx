import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff, CalendarDays, Check, ChevronDown, ChevronRight, FileText, Plus, Wrench, X } from 'lucide-react'
import type { ChecklistItem, Task } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { useUi } from '../store/ui'
import { useData } from '../store/data'
import { formatDay, todayISO } from '../lib/format'
import { addDays } from '../lib/time'
import { undoToast } from '../lib/toast'

type Group = 'overdue' | 'today' | 'upcoming' | 'later' | 'none'
const GROUPS: { id: Group; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' }
]

function groupOf(t: Task, today: string): Group {
  if (!t.dueDate) return 'none'
  if (t.dueDate < today) return 'overdue'
  if (t.dueDate === today) return 'today'
  if (t.dueDate <= addDays(today, 7)) return 'upcoming'
  return 'later'
}

export const dueLabel = (date: string, today = todayISO()): string =>
  date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : date === addDays(today, -1) ? 'Yesterday' : formatDay(date)

/** Tasks: your own to-dos with due dates, plus the checkboxes inside notes (and tickets, if you like). */
export function TasksView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [checklists, setChecklists] = useState<ChecklistItem[]>([])
  const showTickets = useUi((s) => s.prefs.tasksTickets === '1')
  const showDone = useUi((s) => s.prefs.tasksDone === '1')
  const setPref = useUi((s) => s.setPref)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const today = todayISO()

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([api.tasks.list({ done: showDone }), api.tasks.checklists({ tickets: showTickets })])
    setTasks(t)
    setChecklists(c)
    void useData.getState().refreshCounts()
  }, [showDone, showTickets])
  const remote = useData((s) => s.remote) // changed on another device
  useEffect(() => {
    void load()
  }, [load, remote])

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    await api.tasks.create({ title, dueDate: due || null })
    setTitle('')
    setDue('') // each new task starts without a date
    await load()
    input.current?.focus()
  }

  /** Quick date chips toggle, then put you back in the box so Enter adds the task. */
  const pickDue = (date: string): void => {
    setDue(due === date ? '' : date)
    input.current?.focus()
  }

  const open = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)
  const bySource = new Map<string, ChecklistItem[]>()
  for (const c of checklists) bySource.set(`${c.source}:${c.sourceId}`, [...(bySource.get(`${c.source}:${c.sourceId}`) ?? []), c])

  return (
    <div className="page tasks-page">
      <div className="list-header">
        <h1>Tasks</h1>
      </div>
      <form
        className="task-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Plus className="task-add-icon" />
        <input ref={input} autoFocus value={title} placeholder="Add a task… (press Enter)" aria-label="New task" onChange={(e) => setTitle(e.target.value)} />
        <input type="date" value={due} aria-label="Due date" title="Due date (optional)" onChange={(e) => setDue(e.target.value)} />
        <div className="task-quick-dates">
          <button type="button" className={`chip-btn ${due === today ? 'active' : ''}`} onClick={() => pickDue(today)}>
            Today
          </button>
          <button type="button" className={`chip-btn ${due === addDays(today, 1) ? 'active' : ''}`} onClick={() => pickDue(addDays(today, 1))}>
            Tomorrow
          </button>
        </div>
      </form>

      {open.length === 0 && checklists.length === 0 && <div className="empty-state">Nothing to do. Add a task above, or tick boxes in your notes.</div>}

      {GROUPS.map((g) => {
        const list = open.filter((t) => groupOf(t, today) === g.id)
        if (!list.length) return null
        return (
          <section key={g.id} className={`task-group task-group-${g.id}`}>
            <h2 className="section-title">
              {g.label} <span className="muted">{list.length}</span>
            </h2>
            <ul className="task-list">
              {list.map((t) => (
                <TaskRow key={t.id} task={t} today={today} onChanged={load} />
              ))}
            </ul>
          </section>
        )
      })}

      <section className="task-group">
        <div className="task-section-head">
          <h2 className="section-title">From your notes{showTickets ? ' and tickets' : ''}</h2>
          <label className="check-row small">
            <input type="checkbox" checked={showTickets} onChange={(e) => setPref('tasksTickets', e.target.checked ? '1' : '0')} />
            Include ticket checklists
          </label>
        </div>
        {bySource.size === 0 ? (
          <p className="small muted">Checkboxes you add in notes (type /to-do) show up here.</p>
        ) : (
          [...bySource.values()].map((items) => (
            <div key={`${items[0].source}:${items[0].sourceId}`} className="checklist-source">
              <button type="button" className="link-btn checklist-title" onClick={() => go(items[0].source === 'note' ? { view: 'note', id: items[0].sourceId } : { view: 'ticket', id: items[0].sourceId })}>
                {items[0].source === 'note' ? <FileText /> : <Wrench />} {items[0].sourceTitle}
              </button>
              <ul className="task-list">
                {items.map((c) => (
                  <li key={c.index} className={`task-row ${c.checked ? 'done' : ''}`}>
                    <button
                      type="button"
                      className={`task-check ${c.checked ? 'on' : ''}`}
                      role="checkbox"
                      aria-checked={c.checked}
                      aria-label={c.text}
                      onClick={async () => {
                        await api.tasks.setChecklist(c.source, c.sourceId, c.index, !c.checked)
                        await load()
                      }}
                    >
                      {c.checked && <Check />}
                    </button>
                    <span className="task-title-text">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="task-group">
        <button type="button" className="section-toggle task-done-toggle" onClick={() => setPref('tasksDone', showDone ? '0' : '1')}>
          {showDone ? <ChevronDown /> : <ChevronRight />} Completed
        </button>
        {showDone && (
          <ul className="task-list">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onChanged={load} />
            ))}
            {!done.length && <li className="small muted">Nothing completed yet.</li>}
          </ul>
        )}
      </section>
    </div>
  )
}

function TaskRow({ task, today, onChanged }: { task: Task; today: string; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(task.title)
  const [editingDate, setEditingDate] = useState(false)
  useEffect(() => setTitle(task.title), [task.title])
  const save = async (patch: Parameters<typeof api.tasks.update>[1]): Promise<void> => {
    await api.tasks.update(task.id, patch)
    await onChanged()
  }
  const overdue = !task.done && task.dueDate !== null && task.dueDate < today
  return (
    <li className={`task-row ${task.done ? 'done' : ''}`}>
      <button
        type="button"
        className={`task-check ${task.done ? 'on' : ''}`}
        role="checkbox"
        aria-checked={task.done}
        aria-label={`Done: ${task.title}`}
        onClick={() => void save({ done: !task.done })}
      >
        {task.done && <Check />}
      </button>
      <input
        className="task-title"
        value={title}
        aria-label="Task"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== task.title && void save({ title })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {editingDate ? (
        <input
          type="date"
          autoFocus
          className="task-date-input"
          defaultValue={task.dueDate ?? ''}
          aria-label="Change due date"
          onBlur={(e) => {
            setEditingDate(false)
            if ((e.target.value || null) !== task.dueDate) void save({ dueDate: e.target.value || null })
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button type="button" className={`task-due ${overdue ? 'overdue' : ''} ${task.dueDate ? '' : 'empty'}`} onClick={() => setEditingDate(true)} title="Change the due date">
          <CalendarDays /> {task.dueDate ? dueLabel(task.dueDate, today) : 'Add date'}
          {task.dueTime ? ` ${task.dueTime}` : ''}
        </button>
      )}
      {task.dueDate && !task.done && (
        <button
          type="button"
          className="icon-btn sm task-remind"
          title={task.remind ? 'Reminder on (click to turn off)' : 'No reminder (click to turn on)'}
          aria-label={task.remind ? 'Turn reminder off' : 'Turn reminder on'}
          onClick={() => void save({ remind: !task.remind })}
        >
          {task.remind ? <Bell /> : <BellOff />}
        </button>
      )}
      <button
        type="button"
        className="icon-btn sm task-delete"
        aria-label="Delete task"
        title="Delete"
        onClick={async () => {
          await api.tasks.remove(task.id)
          await onChanged()
          undoToast('Task deleted', async () => {
            await api.tasks.restore(task.id)
            await onChanged()
          })
        }}
      >
        <X />
      </button>
    </li>
  )
}
