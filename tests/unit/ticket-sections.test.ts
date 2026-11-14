import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import { ensureStarterTemplate, ensureTicketLayouts, getDefaultTemplateId, getTemplate, listTemplates } from '../../src/main/services/templates'
import * as tickets from '../../src/main/services/tickets'
import { extractText } from '../../src/main/services/doc'
import { copyText } from '../../src/shared/rich-copy'
import { TICKET_PARTS } from '../../src/shared/api'
import { presetDoc, presetParts, sectionNode, sectionPreset, sectionsIn, TICKET_PRESETS, TICKET_SECTIONS } from '../../src/shared/ticket-sections'

describe('section and preset library', () => {
  it('every preset names real sections, and ids are unique', () => {
    const ids = TICKET_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TICKET_PRESETS) for (const id of p.sections) expect(sectionPreset(id), `${p.id} → ${id}`).toBeTruthy()
    for (const s of TICKET_SECTIONS) {
      if (s.part) expect(TICKET_PARTS).toContain(s.part)
      else expect(s.content?.().length).toBeGreaterThan(0)
    }
  })

  it('a preset becomes a document of sections plus its parts', () => {
    const shop = TICKET_PRESETS.find((p) => p.id === 'shop')!
    const doc = presetDoc(shop)
    expect([...sectionsIn(doc)]).toEqual(['passcode', 'condition', 'backup', 'diagnosis', 'work', 'parts', 'checklist'])
    expect(presetParts(shop)).toEqual(['photos', 'warranty', 'pickup'])
  })

  it('section names show in search text and in copied text', () => {
    const doc = { type: 'doc', content: [sectionNode(sectionPreset('work')!)] }
    expect(extractText(doc).split('\n')[0]).toBe('Work done')
    expect(copyText({ content: doc.content })).toContain('Work done')
  })
})

describe('built-in presets in a profile', () => {
  it('are made once as ticket templates, and new tickets start from Quick ticket', () => {
    const db = new DatabaseSync(':memory:') as unknown as Db
    migrate(db)
    ensureStarterTemplate(db)
    ensureTicketLayouts(db)
    ensureTicketLayouts(db) // a second start doesn't add them again
    const names = listTemplates(db).filter((t) => t.kind === 'ticket').map((t) => t.name)
    expect(names).toContain('Repair intake') // the old starter stays
    for (const p of TICKET_PRESETS) expect(names.filter((n) => n === p.name)).toHaveLength(1)
    expect(getTemplate(db, getDefaultTemplateId(db)!)!.name).toBe('Quick ticket')

    const quick = tickets.createTicket(db)
    expect(quick.parts).toEqual([])
    expect(quick.layout.showPickup).toBe(false)
    expect(quick.layout.summaryLabel).toBe('What they need')
    const shop = listTemplates(db).find((t) => t.name === 'Shop repair (drop-off)')!
    const t = tickets.createTicket(db, { templateId: shop.id })
    expect(t.parts).toEqual(['photos', 'warranty', 'pickup']) // the preset's parts, removable on the ticket
    expect([...sectionsIn(t.content)]).toContain('passcode')
  })
})
