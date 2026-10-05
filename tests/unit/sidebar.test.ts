import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import * as folders from '../../src/main/services/folders'
import * as sidebar from '../../src/main/services/sidebar'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
})

const note = (id: string) => notes.getNoteSummary(db, id)
const folder = (id: string) => folders.listFolders(db).find((f) => f.id === id)!

describe('sidebar organisation', () => {
  it('starts with Pinned and Folders; sections can be added, renamed, reordered and removed', () => {
    expect(sidebar.listSections(db).map((s) => s.name)).toEqual(['Pinned', 'Folders'])
    const s = sidebar.createSection(db, ' Clients ')
    sidebar.renameSection(db, s.id, 'Customers')
    sidebar.reorderSections(db, [s.id, 'pinned', 'folders'])
    expect(sidebar.listSections(db).map((x) => [x.name, x.builtin])).toEqual([
      ['Customers', false],
      ['Pinned', true],
      ['Folders', true]
    ])
    expect(() => sidebar.removeSection(db, 'pinned')).toThrow(/not removed/)
  })

  it('pinning puts a note in Pinned; unpinning and trashing take it out', () => {
    const n = notes.createNote(db, { title: 'Prices' })
    expect(notes.updateNote(db, n.id, { pinned: true })).toMatchObject({ pinned: true, sectionId: 'pinned' })
    expect(notes.updateNote(db, n.id, { pinned: false })).toMatchObject({ pinned: false, sectionId: null })
    notes.updateNote(db, n.id, { pinned: true })
    notes.trashNote(db, n.id)
    notes.restoreNote(db, n.id)
    expect(note(n.id)).toMatchObject({ pinned: false, sectionId: null })
  })

  it('moves notes and folders between sections and folders, keeping the order given', () => {
    const s = sidebar.createSection(db, 'Work')
    const a = notes.createNote(db, { title: 'A' })
    const b = notes.createNote(db, { title: 'B' })
    const f = folders.createFolder(db, 'Suppliers')
    sidebar.moveInSidebar(db, { type: 'note', id: a.id }, { sectionId: s.id }, [{ type: 'note', id: a.id }])
    sidebar.moveInSidebar(db, { type: 'folder', id: f.id }, { sectionId: s.id }, [
      { type: 'folder', id: f.id },
      { type: 'note', id: a.id }
    ])
    expect(note(a.id)).toMatchObject({ sectionId: s.id, pinned: true, sort: 2 })
    expect(folder(f.id)).toMatchObject({ sectionId: s.id, parentId: null, sort: 1 })

    // into a folder: leaves the section
    sidebar.moveInSidebar(db, { type: 'note', id: a.id }, { folderId: f.id }, [
      { type: 'note', id: b.id },
      { type: 'note', id: a.id }
    ])
    expect(note(a.id)).toMatchObject({ folderId: f.id, sectionId: null, pinned: false, sort: 2 })
    expect(note(b.id).sort).toBe(1)
  })

  it('folders go inside folders, but never inside themselves', () => {
    const outer = folders.createFolder(db, 'Outer')
    const inner = folders.createFolder(db, 'Inner')
    sidebar.moveInSidebar(db, { type: 'folder', id: inner.id }, { folderId: outer.id }, [{ type: 'folder', id: inner.id }])
    expect(folder(inner.id).parentId).toBe(outer.id)
    expect(() => sidebar.moveInSidebar(db, { type: 'folder', id: outer.id }, { folderId: inner.id }, [])).toThrow(/inside itself/)
    expect(() => sidebar.moveInSidebar(db, { type: 'folder', id: outer.id }, { folderId: outer.id }, [])).toThrow(/inside itself/)
  })

  it('removing a section or folder keeps what was in it', () => {
    const s = sidebar.createSection(db, 'Temp')
    const n = notes.createNote(db, { title: 'N' })
    const f = folders.createFolder(db, 'F', { sectionId: s.id })
    const sub = folders.createFolder(db, 'Sub', { parentId: f.id })
    const inSub = notes.createNote(db, { title: 'In sub', folderId: sub.id })
    sidebar.moveInSidebar(db, { type: 'note', id: n.id }, { sectionId: s.id }, [{ type: 'note', id: n.id }])

    folders.removeFolder(db, sub.id) // its note moves up into F
    expect(note(inSub.id).folderId).toBe(f.id)
    sidebar.removeSection(db, s.id) // folder → Folders, note → Pinned
    expect(folder(f.id).sectionId).toBe('folders')
    expect(note(n.id).sectionId).toBe('pinned')
  })

  it('an emoji icon keeps only the first emoji, so it never spills over the name', () => {
    expect(folders.cleanIcon('🔧🔨abc')).toBe('🔧')
    expect(folders.cleanIcon('👨‍💻')).toBe('👨‍💻')
    expect(folders.cleanIcon('Truck')).toBe('Truck')
  })
})
