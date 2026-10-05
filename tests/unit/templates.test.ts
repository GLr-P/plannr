import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import * as notes from '../../src/main/services/notes'
import * as templates from '../../src/main/services/templates'
import { ensureStarterNoteTemplates, STARTER_NOTE_TEMPLATES } from '../../src/main/services/note-templates'
import { extractText } from '../../src/main/services/doc'

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('note templates', () => {
  it('starter note templates are created once, separate from ticket templates', () => {
    templates.ensureStarterTemplate(db)
    ensureStarterNoteTemplates(db)
    ensureStarterNoteTemplates(db)
    expect(templates.listTemplates(db, 'note')).toHaveLength(STARTER_NOTE_TEMPLATES.length)
    expect(templates.listTemplates(db).map((t) => t.name)).toEqual(['Repair intake'])
    expect(templates.getDefaultTemplateId(db)).toBe(templates.listTemplates(db)[0].id)
  })

  it('a note made from a template copies its content and icon (and the text is searchable, table cells included)', () => {
    ensureStarterNoteTemplates(db)
    const guide = templates.listTemplates(db, 'note').find((t) => t.name === 'Repair guide')!
    const n = notes.createNote(db, { templateId: guide.id })
    expect(n.icon).toBe('Wrench')
    expect(JSON.stringify(n.content)).toContain('"type":"callout"')
    expect(n.preview).toContain('Disconnect the battery')
    expect(extractText(n.content)).toMatch(/Part\nSupplier\nCost/)
  })

  it('ticket templates can’t be used for notes', () => {
    templates.ensureStarterTemplate(db)
    const ticketTpl = templates.listTemplates(db)[0]
    expect(notes.createNote(db, { templateId: ticketTpl.id }).content).toBeNull()
  })
})
