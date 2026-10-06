import { readFileSync } from 'node:fs'
import type { Db } from '../db'
import type { DocJSON } from '../../shared/api'
import { createNote, getNote, trashNote, updateNote } from './notes'
import { resolveFilePath, saveFile } from './files'

/** One profile's storage: its database and data folder. */
export interface Store {
  db: Db
  dir: string
}

const FILE_URL = /^plannr:\/\/file\/([0-9a-f-]{36})$/

/**
 * Copies a note into another profile: its pictures and files are copied into that profile's own storage,
 * and @-links become plain text (the customer or ticket they point at doesn't exist over there).
 * Folder, section and pin stay behind. Returns the new note's id.
 */
export function copyNoteTo(from: Store, to: Store, noteId: string): string {
  const note = getNote(from.db, noteId)
  if (!note || note.deletedAt !== null) throw new Error('That note no longer exists')
  const copied = new Map<string, string>()

  const copyFile = (url: string): string => {
    const id = FILE_URL.exec(url)?.[1]
    if (!id) return url
    const known = copied.get(id)
    if (known) return known
    const file = resolveFilePath(from.db, from.dir, id)
    const row = from.db.prepare('SELECT name FROM files WHERE id = ?').get(id) as { name: string } | undefined
    let next = url
    try {
      if (file && row) next = saveFile(to.db, to.dir, { name: row.name, mime: file.mime, data: readFileSync(file.path) }).url
    } catch {
      // not on this PC (e.g. not downloaded from another device yet): keep the old link rather than fail the copy
    }
    copied.set(id, next)
    return next
  }

  const convert = (node: DocJSON): DocJSON => {
    if (node.type === 'mention') return { type: 'text', text: `@${String(node.attrs?.label ?? '')}` }
    const out: DocJSON = { ...node }
    if (node.attrs) {
      out.attrs = Object.fromEntries(Object.entries(node.attrs).map(([k, v]) => [k, typeof v === 'string' ? copyFile(v) : v]))
    }
    if (node.content) out.content = node.content.map(convert)
    return out
  }

  const created = createNote(to.db, { title: note.title })
  updateNote(to.db, created.id, {
    ...(note.content ? { content: convert(note.content) } : {}),
    tags: note.tags,
    icon: note.icon,
    color: note.color
  })
  return created.id
}

/** Moves a note: copies it, then puts the original in this profile's trash (so it can still be restored). */
export function moveNoteTo(from: Store, to: Store, noteId: string): string {
  const id = copyNoteTo(from, to, noteId)
  trashNote(from.db, noteId)
  return id
}
