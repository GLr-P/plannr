import type { Db } from '../db'
import { newId, now, tx } from '../db'
import type { DocJSON, Note, NoteListOptions, NoteSummary, NoteUpdate } from '../../shared/api'
import { indexEntity, unindexEntity } from './search'
import { deleteLinksOf, setLinks } from './links'
import { extractMentions, extractText } from './doc'
import { cleanColor, cleanIcon } from './folders'

export { extractMentions, extractText }

interface NoteRow {
  id: string
  title: string
  folder_id: string | null
  pinned: number
  tags: string
  icon: string
  color: string
  preview: string
  created_at: number
  updated_at: number
  deleted_at: number | null
  content_json?: string | null
  content_text?: string
}

const SUMMARY_COLS =
  'id, title, folder_id, pinned, tags, icon, color, substr(content_text, 1, 200) AS preview, created_at, updated_at, deleted_at'

function toSummary(r: NoteRow): NoteSummary {
  return {
    id: r.id,
    title: r.title,
    folderId: r.folder_id,
    pinned: r.pinned === 1,
    tags: JSON.parse(r.tags) as string[],
    icon: r.icon,
    color: r.color,
    preview: r.preview,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>()
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 40)
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag)
  }
  return [...seen.values()]
}

export function reindex(db: Db, id: string): void {
  const row = db.prepare('SELECT title, content_text, tags, updated_at, deleted_at FROM notes WHERE id = ?').get(id) as
    | { title: string; content_text: string; tags: string; updated_at: number; deleted_at: number | null }
    | undefined
  if (!row || row.deleted_at !== null) {
    unindexEntity(db, id)
    return
  }
  const tags = (JSON.parse(row.tags) as string[]).map((t) => `#${t}`).join(' ')
  indexEntity(db, 'note', id, row.title || 'Untitled', row.content_text, row.updated_at, tags)
}

export function listNotes(db: Db, opts: NoteListOptions = {}): NoteSummary[] {
  const where = [opts.trashed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
  const params: string[] = []
  if (opts.folderId === null) where.push('folder_id IS NULL')
  else if (opts.folderId !== undefined) {
    where.push('folder_id = ?')
    params.push(opts.folderId)
  }
  if (opts.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(notes.tags) WHERE lower(value) = lower(?))')
    params.push(opts.tag)
  }
  const order = opts.trashed ? 'deleted_at DESC' : 'pinned DESC, updated_at DESC'
  const rows = db.prepare(`SELECT ${SUMMARY_COLS} FROM notes WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...params)
  return (rows as unknown as NoteRow[]).map(toSummary)
}

export function getNote(db: Db, id: string): Note | null {
  const row = db.prepare(`SELECT ${SUMMARY_COLS}, content_json FROM notes WHERE id = ?`).get(id) as NoteRow | undefined
  if (!row) return null
  return { ...toSummary(row), content: row.content_json ? (JSON.parse(row.content_json) as DocJSON) : null }
}

export function getNoteSummary(db: Db, id: string): NoteSummary {
  const row = db.prepare(`SELECT ${SUMMARY_COLS} FROM notes WHERE id = ?`).get(id) as NoteRow | undefined
  if (!row) throw new Error(`Note not found: ${id}`)
  return toSummary(row)
}

export function createNote(db: Db, input: { title?: string; folderId?: string | null } = {}): Note {
  const id = newId()
  const t = now()
  tx(db, () => {
    db.prepare('INSERT INTO notes (id, title, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      input.title?.trim() ?? '',
      input.folderId ?? null,
      t,
      t
    )
    reindex(db, id)
  })
  return getNote(db, id)!
}

export function updateNote(db: Db, id: string, patch: NoteUpdate): NoteSummary {
  return tx(db, () => {
    const sets: string[] = []
    const params: (string | number | null)[] = []
    if (patch.title !== undefined) {
      sets.push('title = ?')
      params.push(patch.title)
    }
    if (patch.content !== undefined) {
      sets.push('content_json = ?', 'content_text = ?')
      params.push(JSON.stringify(patch.content), extractText(patch.content))
      setLinks(db, 'note', id, extractMentions(patch.content))
    }
    if (patch.folderId !== undefined) {
      sets.push('folder_id = ?')
      params.push(patch.folderId)
    }
    if (patch.pinned !== undefined) {
      sets.push('pinned = ?')
      params.push(patch.pinned ? 1 : 0)
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?')
      params.push(JSON.stringify(normalizeTags(patch.tags)))
    }
    if (patch.icon !== undefined) {
      sets.push('icon = ?')
      params.push(cleanIcon(patch.icon))
    }
    if (patch.color !== undefined) {
      sets.push('color = ?')
      params.push(cleanColor(patch.color))
    }
    // Changing only the look (icon/colour) doesn't count as an edit, so "Recent" order stays put.
    const lookOnly = Object.keys(patch).every((k) => k === 'icon' || k === 'color')
    if (!lookOnly) {
      sets.push('updated_at = ?')
      params.push(now())
    }
    params.push(id)
    const result = db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    if (result.changes === 0) throw new Error(`Note not found: ${id}`)
    reindex(db, id)
    return getNoteSummary(db, id)
  })
}

export function trashNote(db: Db, id: string): void {
  tx(db, () => {
    db.prepare('UPDATE notes SET deleted_at = ?, pinned = 0 WHERE id = ?').run(now(), id)
    reindex(db, id)
  })
}

export function restoreNote(db: Db, id: string): void {
  tx(db, () => {
    db.prepare('UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
    reindex(db, id)
  })
}

export function destroyNote(db: Db, id: string): void {
  tx(db, () => {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    deleteLinksOf(db, id)
    unindexEntity(db, id)
  })
}

export function allTags(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT j.value AS tag FROM notes, json_each(notes.tags) j
       WHERE notes.deleted_at IS NULL ORDER BY lower(j.value)`
    )
    .all() as { tag: string }[]
  return rows.map((r) => r.tag)
}
