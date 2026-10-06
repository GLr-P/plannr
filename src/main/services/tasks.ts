import type { Db } from '../db'
import { newId, now } from '../db'
import type { ChecklistItem, DocJSON, Task, TaskInput } from '../../shared/api'
import { isDate, localDate } from './doc'
import { LOOKBACK_MS } from './reminders'
import { updateNote } from './notes'
import { updateTicket } from './tickets'
import { formatTicketNumber } from '../../shared/api'


/*
 * Tasks: standalone to-dos with an optional due date (and time) and a reminder, plus the checkboxes inside notes
 * and tickets (read straight from their documents; ticking one here ticks it in the document).
 */

interface TaskRow {
  id: string
  title: string
  notes: string
  due_date: string | null
  due_time: string | null
  remind: number
  done_at: number | null
  link_type: Task['linkType']
  link_id: string | null
  created_at: number
  updated_at: number
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dueDate: r.due_date,
  dueTime: r.due_time,
  remind: r.remind === 1,
  done: r.done_at !== null,
  doneAt: r.done_at,
  linkType: r.link_type,
  linkId: r.link_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/** Open tasks by due date (no date last); with \`done\`, also the 50 most recently finished. */
export function listTasks(db: Db, opts: { done?: boolean } = {}): Task[] {
  const open = db
    .prepare("SELECT * FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL ORDER BY due_date IS NULL, due_date, due_time IS NULL, due_time, created_at")
    .all() as unknown as TaskRow[]
  const done = opts.done
    ? (db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL AND done_at IS NOT NULL ORDER BY done_at DESC LIMIT 50').all() as unknown as TaskRow[])
    : []
  return [...open, ...done].map(toTask)
}

/** Tasks due in [from, to] (for the calendar), done or not. */
export function tasksInRange(db: Db, from: string, to: string): Task[] {
  const rows = db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL AND due_date BETWEEN ? AND ? ORDER BY due_date, due_time').all(from, to) as unknown as TaskRow[]
  return rows.map(toTask)
}

/** Open tasks that are overdue or due today (the menu badge). */
export const dueTaskCount = (db: Db, today = localDate()): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL AND due_date <= ?').get(today) as { n: number }).n

const cleanTime = (t: string | null | undefined): string | null => (t && /^\d{2}:\d{2}$/.test(t) ? t : null)

export function createTask(db: Db, input: TaskInput): Task {
  const id = newId()
  const t = now()
  db.prepare(
    `INSERT INTO tasks (id, title, notes, due_date, due_time, remind, link_type, link_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (input.title ?? '').trim().slice(0, 500),
    (input.notes ?? '').slice(0, 5000),
    isDate(input.dueDate) ? input.dueDate : null,
    cleanTime(input.dueTime),
    input.remind === false ? 0 : 1,
    input.linkType ?? null,
    input.linkId ?? null,
    t,
    t
  )
  return toTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow)
}

export function updateTask(db: Db, id: string, patch: TaskInput & { done?: boolean }): Task {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const set = (col: string, v: string | number | null): void => {
    sets.push(`${col} = ?`)
    params.push(v)
  }
  if (patch.title !== undefined) set('title', patch.title.trim().slice(0, 500))
  if (patch.notes !== undefined) set('notes', patch.notes.slice(0, 5000))
  if (patch.dueDate !== undefined) set('due_date', isDate(patch.dueDate) ? patch.dueDate : null)
  if (patch.dueTime !== undefined) set('due_time', cleanTime(patch.dueTime))
  if (patch.remind !== undefined) set('remind', patch.remind ? 1 : 0)
  if (patch.done !== undefined) set('done_at', patch.done ? now() : null)
  if (patch.linkType !== undefined) set('link_type', patch.linkType)
  if (patch.linkId !== undefined) set('link_id', patch.linkId)
  set('updated_at', now())
  params.push(id)
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return toTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow)
}

export function removeTask(db: Db, id: string): void {
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

export function restoreTask(db: Db, id: string): void {
  db.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
}

// ---------- Checkboxes inside notes and tickets ----------

const textOf = (n: DocJSON): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join(n.type === 'paragraph' ? ' ' : ''))

/** Every taskItem in a document, in order (its index is how it's found again when ticked). */
function taskItems(doc: DocJSON | null): { node: DocJSON; text: string }[] {
  const out: { node: DocJSON; text: string }[] = []
  const walk = (n: DocJSON): void => {
    if (n.type === 'taskItem') {
      // The item's own text, without nested sub-items
      const own = (n.content ?? []).filter((c) => c.type !== 'taskList').map(textOf).join(' ').trim()
      out.push({ node: n, text: own })
    }
    for (const c of n.content ?? []) walk(c)
  }
  if (doc) walk(doc)
  return out
}

/** Checkboxes from notes (and, if asked, from tickets that aren't picked up). Empty ones are skipped. */
export function checklistItems(db: Db, opts: { tickets?: boolean; done?: boolean } = {}): ChecklistItem[] {
  const out: ChecklistItem[] = []
  const notes = db
    .prepare("SELECT id, title, content_json FROM notes WHERE deleted_at IS NULL AND content_json LIKE '%\"taskItem\"%' ORDER BY updated_at DESC")
    .all() as { id: string; title: string; content_json: string }[]
  const tickets = opts.tickets
    ? (db
        .prepare(
          "SELECT id, number, device, content_json FROM tickets WHERE deleted_at IS NULL AND status <> 'picked_up' AND content_json LIKE '%\"taskItem\"%' ORDER BY number DESC"
        )
        .all() as { id: string; number: number; device: string; content_json: string }[])
    : []
  const add = (source: ChecklistItem['source'], sourceId: string, sourceTitle: string, json: string): void => {
    taskItems(JSON.parse(json) as DocJSON).forEach((t, index) => {
      const checked = t.node.attrs?.checked === true
      if (!t.text || (checked && !opts.done)) return
      out.push({ source, sourceId, sourceTitle, index, text: t.text.slice(0, 300), checked })
    })
  }
  for (const n of notes) add('note', n.id, n.title || 'Untitled', n.content_json)
  for (const t of tickets) add('ticket', t.id, [formatTicketNumber(t.number), t.device].filter(Boolean).join(' · '), t.content_json)
  return out
}

/** Ticks or unticks the n-th checkbox in a note or ticket (saved like an edit, so search and links stay right). */
export function setChecklistItem(db: Db, source: ChecklistItem['source'], id: string, index: number, checked: boolean): void {
  const row = db.prepare(`SELECT content_json FROM ${source === 'note' ? 'notes' : 'tickets'} WHERE id = ?`).get(id) as { content_json: string | null } | undefined
  if (!row?.content_json) throw new Error('Not found')
  const doc = JSON.parse(row.content_json) as DocJSON
  const item = taskItems(doc)[index]
  if (!item) throw new Error('That checkbox has moved; open the note to tick it')
  item.node.attrs = { ...(item.node.attrs ?? {}), checked }
  if (source === 'note') updateNote(db, id, { content: doc })
  else updateTicket(db, id, { content: doc })
}

// ---------- Reminders ----------

export interface DueTaskReminder {
  taskId: string
  key: string
  title: string
  body: string
}

/** Tasks with a reminder: on the due date at their time, or 9 AM if they have none. Each fires once. */
export function dueTaskReminders(db: Db, nowDate = new Date(), lookbackMs = LOOKBACK_MS): DueTaskReminder[] {
  const today = localDate(nowDate)
  const yesterday = localDate(new Date(nowDate.getTime() - 86_400_000))
  const rows = db
    .prepare('SELECT * FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL AND remind = 1 AND due_date BETWEEN ? AND ?')
    .all(yesterday, today) as unknown as TaskRow[]
  const logged = db.prepare('SELECT 1 FROM reminder_log WHERE event_id = ? AND reminder_key = ?')
  const out: DueTaskReminder[] = []
  for (const r of rows) {
    const [y, m, d] = r.due_date!.split('-').map(Number)
    const [hh, mm] = (r.due_time ?? '09:00').split(':').map(Number)
    const at = new Date(y, m - 1, d, hh, mm).getTime()
    if (at > nowDate.getTime() || nowDate.getTime() - at > lookbackMs) continue
    const key = `task@${r.due_date}${r.due_time ?? ''}`
    if (logged.get(r.id, key)) continue
    out.push({ taskId: r.id, key, title: r.title || 'Task', body: r.due_time ? `Due today at ${r.due_time}` : 'Due today' })
  }
  return out
}
