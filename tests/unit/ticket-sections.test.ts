import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import { createTemplate, ensureStarterTemplate, ensureTicketLayouts, getDefaultTemplateId, getTemplate, listTemplates, updateTemplate } from '../../src/main/services/templates'
import * as tickets from '../../src/main/services/tickets'
import { extractText } from '../../src/main/services/doc'
import { copyText } from '../../src/shared/rich-copy'
import { TICKET_PARTS, type DocJSON } from '../../src/shared/api'
import { presetDoc, presetLayout, presetParts, sectionNode, sectionPreset, sectionsIn, templateBody, TICKET_PRESETS, TICKET_SECTIONS } from '../../src/shared/ticket-sections'

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
    expect(names).not.toContain('Repair intake') // repair presets come with the repair setup now
    for (const p of TICKET_PRESETS.filter((x) => !x.uses)) expect(names.filter((n) => n === p.name)).toHaveLength(1)
    expect(getTemplate(db, getDefaultTemplateId(db)!)!.name).toBe('Quick ticket')

    const quick = tickets.createTicket(db)
    expect(quick.parts).toEqual([])
    expect(quick.layout.showPickup).toBe(false)
    expect(quick.layout.summaryLabel).toBe('Details')
    const sp = TICKET_PRESETS.find((p) => p.id === 'shop')! // made by the repair setup
    const shop = createTemplate(db, { name: sp.name, kind: 'ticket', content: presetDoc(sp), layout: presetLayout(sp) })
    const t = tickets.createTicket(db, { templateId: shop.id })
    expect(t.parts).toEqual(['photos', 'warranty', 'pickup']) // the preset's parts, removable on the ticket
    expect([...sectionsIn(t.content)]).toContain('passcode')
  })
})

describe('a ticket used for new Quick tickets', () => {
  it('keeps every section in the template, with the answers left out', () => {
    const db = new DatabaseSync(':memory:') as unknown as Db
    migrate(db)
    ensureStarterTemplate(db)
    ensureTicketLayouts(db)
    const quickId = getDefaultTemplateId(db)!
    const ticket = tickets.createTicket(db)
    expect(ticket.content?.content?.some((b) => b.type === 'ticketSection')).toBe(false) // Quick ticket starts empty
    // Sections added with + Add, one filled in, plus one of your own with a note typed in it
    const passcode = sectionNode(sectionPreset('passcode')!)
    const filled = JSON.parse(JSON.stringify(passcode).replace('"value":""', '"value":"4540"')) as DocJSON
    const mine: DocJSON = { type: 'ticketSection', attrs: { preset: 'mine-1', title: 'Cables' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left the charger' }] }] }
    const body: DocJSON = { type: 'doc', content: [filled, sectionNode(sectionPreset('work')!), sectionNode(sectionPreset('requirements')!), mine] }
    tickets.updateTicket(db, ticket.id, { content: body })
    updateTemplate(db, quickId, { content: templateBody(tickets.getTicket(db, ticket.id)!.content) })

    const next = tickets.createTicket(db)
    expect([...sectionsIn(next.content)]).toEqual(['passcode', 'work', 'requirements', 'mine-1'])
    expect(JSON.stringify(next.content)).not.toContain('4540')
    expect(JSON.stringify(next.content)).not.toContain('Left the charger')
    expect(next.content!.content!.at(-1)).toEqual({ type: 'paragraph' }) // a line to type on at the end
    expect(tickets.getTicket(db, ticket.id)!.content).toEqual(body) // the ticket itself is untouched
  })
})

describe('templateBody', () => {
  const line = (t: string): DocJSON => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
  it('keeps lines of text the template already had (e.g. terms) and empties that customer’s notes', () => {
    const template: DocJSON = { type: 'doc', content: [line('All repairs carry a 30-day warranty.'), { type: 'paragraph' }] }
    const ticket: DocJSON = { type: 'doc', content: [line('All repairs carry a 30-day warranty.'), line('Customer said it fell in water'), sectionNode(sectionPreset('work')!)] }
    const out = templateBody(ticket, template)
    expect(out.content).toEqual([line('All repairs carry a 30-day warranty.'), { type: 'paragraph' }, sectionNode(sectionPreset('work')!), { type: 'paragraph' }])
  })
  it('an empty body is one line to type on', () => {
    expect(templateBody(undefined)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})
