import { useCallback, useEffect, useState } from 'react'
import { Check, Flame, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Habit } from '../../../shared/api'
import { api } from '../api'
import { todayISO } from '../lib/format'

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Today's routine: tick habits off, see streaks and the last week. `compact` (Home) hides adding and editing. */
export function HabitsPanel({ compact = false }: { compact?: boolean }) {
  const [habits, setHabits] = useState<Habit[] | null>(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const today = todayISO()
  const load = useCallback(async () => setHabits(await api.habits.list(today)), [today])
  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (h: Habit): Promise<void> => {
    setHabits((l) => l?.map((x) => (x.id === h.id ? { ...x, doneToday: !h.doneToday, streak: h.doneToday ? Math.max(0, x.streak - 1) : x.streak + 1 } : x)) ?? null)
    await api.habits.toggle(h.id, today, !h.doneToday)
    void load()
  }
  if (!habits) return null
  const due = habits.filter((h) => h.days.includes(new Date().getDay()))
  const list = compact ? due : habits
  if (compact && list.length === 0) return null

  return (
    <div className={`habits ${compact ? 'compact' : ''}`}>
      {!compact && list.length === 0 && <p className="muted small">Add things you want to do every day (or on some days): gym, water, vitamins, reading…</p>}
      <ul className="habit-list">
        {list.map((h) =>
          editing === h.id ? (
            <HabitEditor
              key={h.id}
              habit={h}
              onDone={() => {
                setEditing(null)
                void load()
              }}
            />
          ) : (
            <li key={h.id} className={`habit ${h.doneToday ? 'done' : ''} ${h.days.includes(new Date().getDay()) ? '' : 'rest'}`}>
              <button type="button" className="habit-check" role="checkbox" aria-checked={h.doneToday} aria-label={`Done today: ${h.name}`} onClick={() => void toggle(h)}>
                {h.doneToday && <Check />}
              </button>
              <span className="habit-name">{h.name}</span>
              {h.streak > 0 && (
                <span className="habit-streak" title={`${h.streak} in a row · best ${h.best} · done ${h.rate30}% of the last 30 days`}>
                  <Flame /> {h.streak}
                </span>
              )}
              {!compact && <span className="habit-rate small muted" title="Done on this share of its days in the last 30 days">{h.rate30}%</span>}
              {!compact && (
                <span className="habit-week" aria-hidden>
                  {h.week.map((d) => (
                    <span key={d.date} className={`habit-dot ${d.done ? 'on' : ''} ${d.scheduled ? '' : 'off'}`} />
                  ))}
                </span>
              )}
              {!compact && (
                <button type="button" className="icon-btn sm" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h.id)}>
                  <Pencil />
                </button>
              )}
            </li>
          )
        )}
      </ul>
      {!compact && (
        <form
          className="habit-add"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            await api.habits.create({ name })
            setName('')
            void load()
          }}
        >
          <Plus />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a habit… (press Enter)" aria-label="New habit" />
        </form>
      )}
    </div>
  )
}

function HabitEditor({ habit, onDone }: { habit: Habit; onDone: () => void }) {
  const [name, setName] = useState(habit.name)
  const [days, setDays] = useState(habit.days)
  return (
    <li className="habit editing">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Habit name" autoFocus />
      <span className="habit-days" role="group" aria-label="Days">
        {DAY_LETTERS.map((l, i) => (
          <button key={i} type="button" className={`habit-day ${days.includes(i) ? 'on' : ''}`} aria-pressed={days.includes(i)} onClick={() => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}>
            {l}
          </button>
        ))}
      </span>
      <button type="button" className="btn sm primary" onClick={() => void api.habits.update(habit.id, { name, days }).then(onDone)}>
        Save
      </button>
      <button type="button" className="icon-btn sm" aria-label="Delete habit" onClick={() => void api.habits.remove(habit.id).then(onDone)}>
        <Trash2 />
      </button>
      <button type="button" className="icon-btn sm" aria-label="Cancel" onClick={onDone}>
        <X />
      </button>
    </li>
  )
}
