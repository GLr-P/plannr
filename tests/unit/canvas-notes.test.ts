import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../../src/main/db'
import { createNote, getNote, updateNote } from '../../src/main/services/notes'
import { search } from '../../src/main/services/search'
import { docToMarkdown } from '../../src/main/services/portability'
import type { DocJSON } from '../../src/shared/api'

// Free-form pages (canvases) as notes: created blank, searchable by their text and fields, exported to Markdown.
const page: DocJSON = {
  type: 'canvas',
  attrs: { height: 600 },
  content: [
    { type: 'formField', attrs: { id: 'f1', label: 'Budget', kind: 'money', value: '1250', box: { x: 400, y: 100, w: 300, h: 60 } } },
    { type: 'canvasText', attrs: { id: 't1', text: 'Garden plan', box: { x: 24, y: 20, w: 400, h: 40 } } },
    { type: 'formField', attrs: { id: 'f2', label: 'Plants', kind: 'textarea', value: 'Lavender', box: { x: 24, y: 100, w: 300, h: 60 } } }
  ]
}

describe('free-form pages in notes', () => {
  it('a new free-form page is an empty canvas; its text and fields are searchable', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const note = createNote(db, { canvas: true })
    expect(note.content).toMatchObject({ type: 'canvas', content: [] })
    updateNote(db, note.id, { title: 'Yard', content: page })
    expect(getNote(db, note.id)?.content?.type).toBe('canvas')
    expect(search(db, 'lavender').map((r) => r.id)).toContain(note.id)
    expect(search(db, 'garden').map((r) => r.id)).toContain(note.id)
  })

  it('exports to Markdown top to bottom, left to right', () => {
    expect(docToMarkdown(page)).toBe('Garden plan\n\n**Plants:** Lavender\n\n**Budget:** 1250\n')
  })
})
