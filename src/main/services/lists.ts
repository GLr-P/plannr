import type { Db } from '../db'
import { newId, now } from '../db'
import type { ListItem } from '../../shared/api'

/** Check-off lists (shopping, hardware store, packing…): items with a list name, synced to the phone. */

interface Row {
  id: string
  list: string
  title: string
  done: number
  sort: number
}

const toItem = (r: Row): ListItem => ({ id: r.id, list: r.list, title: r.title, done: r.done === 1, sort: r.sort })
const cleanList = (list: string): string => list.trim().slice(0, 60) || 'Shopping'

export function listItems(db: Db): ListItem[] {
  return (db.prepare('SELECT id, list, title, done, sort FROM list_items WHERE deleted_at IS NULL ORDER BY list COLLATE NOCASE, done, sort').all() as unknown as Row[]).map(toItem)
}

export function addItem(db: Db, list: string, title: string): ListItem {
  const id = newId()
  const t = now()
  const name = cleanList(list)
  const max = (db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM list_items WHERE list = ? AND deleted_at IS NULL').get(name) as { m: number }).m
  db.prepare('INSERT INTO list_items (id, list, title, done, sort, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, title.trim().slice(0, 200), max + 1, t, t)
  return toItem(db.prepare('SELECT id, list, title, done, sort FROM list_items WHERE id = ?').get(id) as unknown as Row)
}

export function updateItem(db: Db, id: string, patch: { title?: string; done?: boolean; list?: string }): void {
  const r = db.prepare('SELECT id, list, title, done, sort FROM list_items WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Item not found')
  db.prepare('UPDATE list_items SET title = ?, done = ?, list = ?, updated_at = ? WHERE id = ?').run(
    patch.title !== undefined ? patch.title.trim().slice(0, 200) : r.title,
    patch.done !== undefined ? (patch.done ? 1 : 0) : r.done,
    patch.list !== undefined ? cleanList(patch.list) : r.list,
    now(),
    id
  )
}

export function removeItem(db: Db, id: string): void {
  db.prepare('UPDATE list_items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
}

export function clearDone(db: Db, list: string): void {
  db.prepare('UPDATE list_items SET deleted_at = ?, updated_at = ? WHERE list = ? AND done = 1 AND deleted_at IS NULL').run(now(), now(), list)
}

export function renameList(db: Db, from: string, to: string): void {
  db.prepare('UPDATE list_items SET list = ?, updated_at = ? WHERE list = ? AND deleted_at IS NULL').run(cleanList(to), now(), from)
}

export function removeList(db: Db, list: string): void {
  db.prepare('UPDATE list_items SET deleted_at = ?, updated_at = ? WHERE list = ? AND deleted_at IS NULL').run(now(), now(), list)
}
