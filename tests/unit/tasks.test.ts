import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as tasks from '../../src/main/services/tasks'
import * as notes from '../../src/main/services/notes'
import * as tickets from '../../src/main/services/tickets'
import { markReminderFired } from '../../src/main/services/reminders'
import type { DocJSON } from '../../src/shared/api'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

const todo = (text: string, checked = false): DocJSON => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const docWith = (...items: DocJSON[]): DocJSON => ({ type: 'doc', content: [{ type: 'taskList', content: items }] })

describe('tasks', () => {
  it('open tasks come by due date (no date last); done ones only when asked; due count = overdue + today', () => {
    tasks.createTask(db, { title: 'Call supplier' })
    const b = tasks.createTask(db, { title: 'Order screens', dueDate: '2026-10-07' })
    tasks.createTask(db, { title: 'Pay rent', dueDate: '2026-10-01' })
    expect(tasks.listTasks(db).map((t) => t.title)).toEqual(['Pay rent', 'Order screens', 'Call supplier'])
    tasks.updateTask(db, b.id, { done: true })
    expect(tasks.listTasks(db).map((t) => t.title)).toEqual(['Pay rent', 'Call supplier'])
    expect(tasks.listTasks(db, { done: true }).at(-1)).toMatchObject({ title: 'Order screens', done: true })
    expect(tasks.dueTaskCount(db, '2026-10-05')).toBe(1)
    expect(tasks.tasksInRange(db, '2026-10-01', '2026-10-31')).toHaveLength(2)
  })

  it('checkboxes in notes (and open tickets, if asked) are listed; ticking one updates the note', () => {
    const n = notes.createNote(db, { title: 'Shop' })
    notes.updateNote(db, n.id, { content: docWith(todo('Buy labels'), todo('Clean bench', true), todo('')) })
    const t = tickets.createTicket(db, {}) // the starter ticket template has a checklist
    expect(tasks.checklistItems(db).map((c) => c.text)).toEqual(['Buy labels'])
    expect(tasks.checklistItems(db, { done: true }).map((c) => [c.text, c.checked])).toEqual([
      ['Buy labels', false],
      ['Clean bench', true]
    ])
    void t
    tasks.setChecklistItem(db, 'note', n.id, 0, true)
    expect(JSON.stringify(notes.getNote(db, n.id)!.content)).toContain('"checked":true}')
    expect(tasks.checklistItems(db)).toEqual([])
  })

  it('a task reminder fires once on the due date, at its time or 9 AM', () => {
    const a = tasks.createTask(db, { title: 'Order screens', dueDate: '2026-10-05' })
    tasks.createTask(db, { title: 'No reminder', dueDate: '2026-10-05', remind: false })
    expect(tasks.dueTaskReminders(db, new Date(2026, 9, 5, 8, 0))).toEqual([])
    const due = tasks.dueTaskReminders(db, new Date(2026, 9, 5, 9, 5))
    expect(due.map((r) => r.title)).toEqual(['Order screens'])
    markReminderFired(db, a.id, due[0].key)
    expect(tasks.dueTaskReminders(db, new Date(2026, 9, 5, 9, 30))).toEqual([])
  })
})
