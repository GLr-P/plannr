import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { Habit, HabitInput } from '../../shared/api'
import { localDate } from './doc'

/**
 * Habits: a daily routine (gym, water, meds…) that resets each morning, with streaks. A tick is a row in
 * `habit_log` (id = habit|date), soft-deleted when unticked so the change syncs.
 */

interface HabitRow {
  id: string
  name: string
  icon: string
  days: string
  sort: number
}

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + n))
}
const weekday = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}
const cleanDays = (days: number[] | undefined): string =>
  [...new Set((days ?? [0, 1, 2, 3, 4, 5, 6]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort().join('') || '0123456'

export function listHabits(db: Db, today = localDate()): Habit[] {
  const rows = db.prepare('SELECT id, name, icon, days, sort FROM habits WHERE deleted_at IS NULL ORDER BY sort, created_at').all() as unknown as HabitRow[]
  const since = addDays(today, -400)
  const done = new Set(
    (db.prepare('SELECT habit_id, date FROM habit_log WHERE deleted_at IS NULL AND date >= ?').all(since) as { habit_id: string; date: string }[]).map((r) => `${r.habit_id}|${r.date}`)
  )
  return rows.map((r) => {
    const days = r.days.split('').map(Number)
    const on = (date: string): boolean => days.includes(weekday(date))
    const ticked = (date: string): boolean => done.has(`${r.id}|${date}`)
    // Streak: scheduled days in a row that were done, counting back from today (today only once it's ticked)
    let streak = 0
    let date = ticked(today) || !on(today) ? today : addDays(today, -1)
    for (let i = 0; i < 400; i++) {
      if (on(date)) {
        if (!ticked(date)) break
        streak++
      }
      date = addDays(date, -1)
    }
    return {
      id: r.id,
      name: r.name,
      icon: r.icon,
      days,
      doneToday: ticked(today),
      streak,
      week: Array.from({ length: 7 }, (_, i) => {
        const d = addDays(today, i - 6)
        return { date: d, scheduled: on(d), done: ticked(d) }
      })
    }
  })
}

export function createHabit(db: Db, input: HabitInput, today = localDate()): Habit {
  const id = newId()
  const t = now()
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM habits WHERE deleted_at IS NULL').get() as { m: number }).m
  db.prepare('INSERT INTO habits (id, name, icon, days, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    (input.name ?? '').trim().slice(0, 100) || 'New habit',
    input.icon ?? '',
    cleanDays(input.days),
    max + 1,
    t,
    t
  )
  return listHabits(db, today).find((h) => h.id === id)!
}

export function updateHabit(db: Db, id: string, input: HabitInput): void {
  const h = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as HabitRow | undefined
  if (!h) throw new Error('Habit not found')
  db.prepare('UPDATE habits SET name = ?, icon = ?, days = ?, updated_at = ? WHERE id = ?').run(
    input.name !== undefined ? input.name.trim().slice(0, 100) || h.name : h.name,
    input.icon ?? h.icon,
    input.days ? cleanDays(input.days) : h.days,
    now(),
    id
  )
}

export function removeHabit(db: Db, id: string): void {
  db.prepare('UPDATE habits SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

export function toggleHabit(db: Db, id: string, date: string, done: boolean): void {
  const logId = `${id}|${date}`
  const t = now()
  db.prepare(
    `INSERT INTO habit_log (id, habit_id, date, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`
  ).run(logId, id, date, t, t, done ? null : t)
}

export function reorderHabits(db: Db, ids: string[]): void {
  tx(db, () => ids.forEach((id, i) => db.prepare('UPDATE habits SET sort = ?, updated_at = ? WHERE id = ?').run(i, now(), id)))
}
