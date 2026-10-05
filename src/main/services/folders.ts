import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { Folder } from '../../shared/api'

interface FolderRow {
  id: string
  name: string
  icon: string
  color: string
  sort: number
  created_at: number
  updated_at: number
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  color: r.color,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listFolders(db: Db): Folder[] {
  const rows = db.prepare('SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY sort, lower(name)').all()
  return (rows as unknown as FolderRow[]).map(toFolder)
}

export function createFolder(db: Db, name: string): Folder {
  const id = newId()
  const t = now()
  const { next } = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM folders').get() as { next: number }
  db.prepare('INSERT INTO folders (id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name.trim() || 'New folder',
    next,
    t,
    t
  )
  return toFolder(db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as FolderRow)
}

export function renameFolder(db: Db, id: string, name: string): void {
  if (!name.trim()) return
  db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), now(), id)
}

export function styleFolder(db: Db, id: string, style: { icon?: string; color?: string }): void {
  if (style.icon !== undefined) db.prepare('UPDATE folders SET icon = ? WHERE id = ?').run(cleanIcon(style.icon), id)
  if (style.color !== undefined) db.prepare('UPDATE folders SET color = ? WHERE id = ?').run(cleanColor(style.color), id)
}

/** Icon: a picker name (letters/digits) or a short emoji. Colour: a palette id. */
export const cleanIcon = (icon: string): string => [...icon.trim()].slice(0, 8).join('')
export const cleanColor = (color: string): string => (/^[a-z]{0,12}$/.test(color) ? color : '')

/** Deletes the folder; its notes are kept and become unfiled. */
export function removeFolder(db: Db, id: string): void {
  tx(db, () => {
    const t = now()
    db.prepare('UPDATE notes SET folder_id = NULL, updated_at = ? WHERE folder_id = ?').run(t, id)
    db.prepare('UPDATE folders SET deleted_at = ?, updated_at = ? WHERE id = ?').run(t, t, id)
  })
}
