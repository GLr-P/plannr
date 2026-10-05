import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { SidebarDest, SidebarRef, SidebarSection } from '../../shared/api'

/*
 * Sidebar organisation. Sections (Pinned, Folders and any the user adds) hold notes and folders; folders hold
 * notes and other folders. A note shown in a section has section_id set (and pinned = 1, so "pinned" still means
 * "in the sidebar"). Order within a section or folder is the `sort` column; dragging rewrites it for the siblings.
 */

export const BUILTIN_SECTIONS = ['pinned', 'folders']

interface SectionRow {
  id: string
  name: string
  sort: number
}

export function listSections(db: Db): SidebarSection[] {
  const rows = db.prepare('SELECT id, name, sort FROM sidebar_sections ORDER BY sort, created_at').all() as unknown as SectionRow[]
  return rows.map((r) => ({ id: r.id, name: r.name, builtin: BUILTIN_SECTIONS.includes(r.id) }))
}

export function createSection(db: Db, name: string): SidebarSection {
  const id = newId()
  const t = now()
  const { next } = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM sidebar_sections').get() as { next: number }
  db.prepare('INSERT INTO sidebar_sections (id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name.trim() || 'New section', next, t, t)
  return { id, name: name.trim() || 'New section', builtin: false }
}

export function renameSection(db: Db, id: string, name: string): void {
  if (!name.trim()) return
  db.prepare('UPDATE sidebar_sections SET name = ?, updated_at = ? WHERE id = ?').run(name.trim().slice(0, 60), now(), id)
}

/** Removes a section you added. Its folders go back to Folders and its notes to Pinned, so nothing disappears. */
export function removeSection(db: Db, id: string): void {
  if (BUILTIN_SECTIONS.includes(id)) throw new Error('Pinned and Folders can be renamed but not removed')
  tx(db, () => {
    db.prepare("UPDATE folders SET section_id = 'folders' WHERE section_id = ?").run(id)
    db.prepare("UPDATE notes SET section_id = 'pinned' WHERE section_id = ?").run(id)
    db.prepare('DELETE FROM sidebar_sections WHERE id = ?').run(id)
  })
}

export function reorderSections(db: Db, ids: string[]): void {
  tx(db, () => ids.forEach((id, i) => db.prepare('UPDATE sidebar_sections SET sort = ? WHERE id = ?').run(i + 1, id)))
}

/** True when `folderId` is `ancestorId` or somewhere inside it. */
function isInside(db: Db, folderId: string, ancestorId: string): boolean {
  let cur: string | null = folderId
  for (let guard = 0; cur && guard < 100; guard++) {
    if (cur === ancestorId) return true
    cur = (db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null
  }
  return false
}

/**
 * Moves a note or folder into a section or folder, and sets the order of everything there.
 * `order` is the complete new list of that section's/folder's items, top to bottom, including the moved one.
 */
export function moveInSidebar(db: Db, item: SidebarRef, dest: SidebarDest, order: SidebarRef[]): void {
  tx(db, () => {
    if ('folderId' in dest) {
      if (!db.prepare('SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NULL').get(dest.folderId)) throw new Error('Folder not found')
      if (item.type === 'folder' && isInside(db, dest.folderId, item.id)) throw new Error('A folder can’t go inside itself')
      if (item.type === 'note') db.prepare('UPDATE notes SET folder_id = ?, section_id = NULL, pinned = 0 WHERE id = ?').run(dest.folderId, item.id)
      else db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(dest.folderId, item.id)
    } else {
      if (!db.prepare('SELECT 1 FROM sidebar_sections WHERE id = ?').get(dest.sectionId)) throw new Error('Section not found')
      if (item.type === 'note') db.prepare('UPDATE notes SET section_id = ?, pinned = 1, folder_id = NULL WHERE id = ?').run(dest.sectionId, item.id)
      else db.prepare('UPDATE folders SET section_id = ?, parent_id = NULL WHERE id = ?').run(dest.sectionId, item.id)
    }
    order.forEach((ref, i) => db.prepare(`UPDATE ${ref.type === 'note' ? 'notes' : 'folders'} SET sort = ? WHERE id = ?`).run(i + 1, ref.id))
  })
}
