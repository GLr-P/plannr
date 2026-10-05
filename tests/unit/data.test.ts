import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import * as folders from '../../src/main/services/folders'
import { buildFtsQuery, search } from '../../src/main/services/search'
import { backlinks } from '../../src/main/services/links'
import { resolveFilePath, saveFile } from '../../src/main/services/files'
import { getSetting, setSetting } from '../../src/main/services/settings'
import type { DocJSON } from '../../src/shared/api'

const doc = (...paragraphs: (string | DocJSON)[]): DocJSON => ({
  type: 'doc',
  content: paragraphs.map((p) =>
    typeof p === 'string' ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph', content: [p] }
  )
})
const mention = (id: string, label: string): DocJSON => ({ type: 'mention', attrs: { id, label, kind: 'note' } })

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
})

describe('migrations', () => {
  it('are idempotent', () => {
    migrate(db)
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(user_version).toBe(16)
  })
})

describe('notes', () => {
  it('creates, updates and reads back content', () => {
    const n = notes.createNote(db, { title: 'Shopping' })
    expect(n.title).toBe('Shopping')
    expect(n.content).toBeNull()
    const s = notes.updateNote(db, n.id, { content: doc('Buy thermal paste', 'Screwdriver set') })
    expect(s.preview).toBe('Buy thermal paste\nScrewdriver set')
    expect(notes.getNote(db, n.id)!.content).toEqual(doc('Buy thermal paste', 'Screwdriver set'))
  })

  it('lists pinned first, then most recently updated', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 5))
    const a = notes.createNote(db, { title: 'A' })
    await tick()
    const b = notes.createNote(db, { title: 'B' })
    await tick()
    const c = notes.createNote(db, { title: 'C' })
    await tick()
    notes.updateNote(db, b.id, { title: 'B2' })
    notes.updateNote(db, a.id, { pinned: true })
    await tick()
    notes.updateNote(db, c.id, { title: 'C2' })
    expect(notes.listNotes(db).map((n) => n.title)).toEqual(['A', 'C2', 'B2'])
  })

  it('filters by folder, unfiled and tag', () => {
    const f = folders.createFolder(db, 'Work')
    const inFolder = notes.createNote(db, { title: 'In', folderId: f.id })
    const loose = notes.createNote(db, { title: 'Loose' })
    notes.updateNote(db, loose.id, { tags: ['Urgent', ' urgent ', '#ideas', ''] })
    expect(notes.listNotes(db, { folderId: f.id }).map((n) => n.id)).toEqual([inFolder.id])
    expect(notes.listNotes(db, { folderId: null }).map((n) => n.id)).toEqual([loose.id])
    expect(notes.getNote(db, loose.id)!.tags).toEqual(['Urgent', 'ideas'])
    expect(notes.listNotes(db, { tag: 'urgent' }).map((n) => n.id)).toEqual([loose.id])
    expect(notes.allTags(db)).toEqual(['ideas', 'Urgent'])
  })

  it('trash hides from list and search; restore brings it back; destroy removes it', () => {
    const n = notes.createNote(db, { title: 'Router reset steps' })
    notes.trashNote(db, n.id)
    expect(notes.listNotes(db)).toHaveLength(0)
    expect(notes.listNotes(db, { trashed: true })).toHaveLength(1)
    expect(search(db, 'router')).toHaveLength(0)
    notes.restoreNote(db, n.id)
    expect(search(db, 'router')).toHaveLength(1)
    notes.destroyNote(db, n.id)
    expect(notes.getNote(db, n.id)).toBeNull()
    expect(search(db, 'router')).toHaveLength(0)
  })

  it('throws when updating a missing note', () => {
    expect(() => notes.updateNote(db, 'nope', { title: 'x' })).toThrow(/not found/)
  })
})

describe('mentions and backlinks', () => {
  it('tracks links from mentions and reports backlinks', () => {
    const target = notes.createNote(db, { title: 'Supplier list' })
    const src = notes.createNote(db, { title: 'Order parts' })
    notes.updateNote(db, src.id, { content: doc('See ', mention(target.id, 'Supplier list')) })
    expect(backlinks(db, target.id)).toEqual([{ type: 'note', id: src.id, title: 'Order parts' }])
    // Removing the mention removes the link
    notes.updateNote(db, src.id, { content: doc('nothing here') })
    expect(backlinks(db, target.id)).toEqual([])
  })

  it('hides backlinks from trashed notes and drops them when destroyed', () => {
    const target = notes.createNote(db, { title: 'T' })
    const src = notes.createNote(db, { title: 'S' })
    notes.updateNote(db, src.id, { content: doc(mention(target.id, 'T')) })
    notes.trashNote(db, src.id)
    expect(backlinks(db, target.id)).toEqual([])
    notes.destroyNote(db, src.id)
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM links').get() as { c: number }
    expect(c).toBe(0)
  })

  it('extracts text including mention labels', () => {
    expect(notes.extractText(doc('Call ', mention('x', 'Jane')))).toBe('Call\n@Jane')
  })
})

describe('search', () => {
  it('builds safe FTS queries', () => {
    expect(buildFtsQuery('')).toBeNull()
    expect(buildFtsQuery('  " * - ')).toBeNull()
    expect(buildFtsQuery('john smith')).toBe('"john"* "smith"*')
    expect(buildFtsQuery('say "hi"')).toBe('"say"* "hi"*')
    expect(buildFtsQuery('a OR b')).toBe('"a"* "OR"* "b"*')
  })

  it('finds by prefix in title and body, ranks title matches first, marks snippets', () => {
    const body = notes.createNote(db, { title: 'Misc' })
    notes.updateNote(db, body.id, { content: doc('Replaced the laptop battery for Jane') })
    const title = notes.createNote(db, { title: 'Laptop repair checklist' })
    const results = search(db, 'lapt')
    expect(results.map((r) => r.id)).toEqual([title.id, body.id])
    expect(results[1].snippet).toContain('\u0001laptop\u0002')
  })

  it('handles emails, accents and multiple words', () => {
    const n = notes.createNote(db, { title: 'Café customer' })
    notes.updateNote(db, n.id, { content: doc('Email jane.doe@gmail.com about the screen') })
    expect(search(db, 'jane.doe@gmail.com')).toHaveLength(1)
    expect(search(db, 'cafe')).toHaveLength(1)
    expect(search(db, 'screen jane')).toHaveLength(1)
    expect(search(db, 'screen bob')).toHaveLength(0)
  })

  it('finds notes by tag', () => {
    const n = notes.createNote(db, { title: 'X' })
    notes.updateNote(db, n.id, { tags: ['invoices'] })
    expect(search(db, 'invoic').map((r) => r.id)).toEqual([n.id])
  })
})

describe('folders', () => {
  it('removing a folder keeps its notes as unfiled', () => {
    const f = folders.createFolder(db, '  Clients ')
    expect(f.name).toBe('Clients')
    const n = notes.createNote(db, { folderId: f.id })
    folders.removeFolder(db, f.id)
    expect(folders.listFolders(db)).toHaveLength(0)
    expect(notes.getNote(db, n.id)!.folderId).toBeNull()
  })

  it('renames and orders folders by creation', () => {
    const a = folders.createFolder(db, 'B first')
    folders.createFolder(db, 'A second')
    folders.renameFolder(db, a.id, 'Renamed')
    folders.renameFolder(db, a.id, '   ')
    expect(folders.listFolders(db).map((f) => f.name)).toEqual(['Renamed', 'A second'])
  })

  it('folders and notes keep a custom icon and colour; changing only the look is not an edit', async () => {
    const f = folders.createFolder(db, 'Suppliers')
    folders.styleFolder(db, f.id, { icon: 'Truck', color: 'orange' })
    folders.styleFolder(db, f.id, { color: 'Bad Colour!' })
    expect(folders.listFolders(db)[0]).toMatchObject({ icon: 'Truck', color: '' })

    const n = notes.createNote(db, { title: 'Prices' })
    await new Promise((r) => setTimeout(r, 3))
    const styled = notes.updateNote(db, n.id, { icon: '🔧', color: 'blue' })
    expect(styled).toMatchObject({ icon: '🔧', color: 'blue', updatedAt: n.updatedAt })
    expect(notes.updateNote(db, n.id, { title: 'Prices 2026' }).updatedAt).toBeGreaterThan(n.updatedAt)
  })
})

describe('files and settings', () => {
  it('stores files in the data dir and resolves them by id only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plannr-test-'))
    const f = saveFile(db, dir, { name: 'Photo 1.PNG', mime: 'image/png', data: new Uint8Array([1, 2, 3]) })
    expect(f.url).toBe(`plannr://file/${f.id}`)
    const resolved = resolveFilePath(db, dir, f.id)!
    expect(resolved.path.endsWith('.png')).toBe(true)
    expect([...readFileSync(resolved.path)]).toEqual([1, 2, 3])
    expect(resolveFilePath(db, dir, '../plannr.db')).toBeNull()
    expect(resolveFilePath(db, dir, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('round-trips settings as JSON', () => {
    expect(getSetting(db, 'theme')).toBeNull()
    setSetting(db, 'theme', 'dark')
    setSetting(db, 'theme', 'light')
    expect(getSetting(db, 'theme')).toBe('light')
  })
})
