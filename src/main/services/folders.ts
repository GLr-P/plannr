import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { Folder } from '../../shared/api'

interface FolderRow {
  id: string
  name: string
  icon: string
  color: string
  section_id: string
  parent_id: string | null
  sort: number
  created_at: number
  updated_at: number
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  color: r.color,
  sectionId: r.section_id,
  parentId: r.parent_id,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listFolders(db: Db): Folder[] {
  const rows = db.prepare('SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY sort, lower(name)').all()
  return (rows as unknown as FolderRow[]).map(toFolder)
}

export function createFolder(db: Db, name: string, place: { sectionId?: string; parentId?: string | null } = {}): Folder {
  const id = newId()
  const t = now()
  const { next } = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM folders').get() as { next: number }
  db.prepare('INSERT INTO folders (id, name, sort, section_id, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    name.trim() || 'New folder',
    next,
    place.sectionId ?? 'folders',
    place.parentId ?? null,
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

/** Icon: a picker name (letters/digits) or a single emoji (one grapheme, so it never spills over the text). */
export function cleanIcon(icon: string): string {
  const s = icon.trim()
  if (/^[A-Za-z0-9]+$/.test(s)) return s.slice(0, 40)
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next().value
  return first?.segment ?? ''
}
export const cleanColor = (color: string): string => (/^[a-z]{0,12}$/.test(color) ? color : '')

/** Deletes the folder. What was inside moves up to where the folder was (its parent folder, or unfiled). */
export function removeFolder(db: Db, id: string): void {
  tx(db, () => {
    const t = now()
    const f = db.prepare('SELECT parent_id, section_id FROM folders WHERE id = ?').get(id) as { parent_id: string | null; section_id: string } | undefined
    db.prepare('UPDATE notes SET folder_id = ?, updated_at = ? WHERE folder_id = ?').run(f?.parent_id ?? null, t, id)
    db.prepare('UPDATE folders SET parent_id = ?, section_id = ? WHERE parent_id = ?').run(f?.parent_id ?? null, f?.section_id ?? 'folders', id)
    db.prepare('UPDATE folders SET deleted_at = ?, updated_at = ? WHERE id = ?').run(t, t, id)
  })
}
