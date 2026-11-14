import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from '../../src/main/db'
import { getSetting, setSetting } from '../../src/main/services/settings'
import { createTemplate, ensureStarterTemplate, ensureTicketLayouts, getTemplate, listTemplates } from '../../src/main/services/templates'
import { loadDisplayPrefs } from '../../src/main/display'
import { pinLegacyWording } from '../../src/main/legacy-wording'
import { DEFAULT_DISPLAY, DEFAULT_TICKET_LAYOUT, setDisplayPrefs, statusLabel, ticketLayout } from '../../src/shared/api'
import { allSections, sectionPreset, TICKET_PRESETS, TICKET_SECTIONS, presetLayout10 } from '../../src/shared/ticket-sections'
import { NOTE_LIBRARY } from '../../src/shared/note-library'
import { planFor, USE_CASES } from '../../src/shared/use-cases'

const fresh = (): Db => {
  const db = new DatabaseSync(':memory:') as unknown as Db
  migrate(db)
  setDisplayPrefs({ ...DEFAULT_DISPLAY })
  return db
}
const start = (db: Db): void => {
  loadDisplayPrefs(db)
  pinLegacyWording(db)
  ensureStarterTemplate(db)
  ensureTicketLayouts(db)
}
const REPAIR_WORDS = /iphone|dell|laptop|device|repair|what’s wrong/i

describe('Plannr for everyone (1.1)', () => {
  it('a fresh install has general wording: no repair words on new tickets or statuses', () => {
    const db = fresh()
    start(db)
    const names = listTemplates(db).map((t) => t.name)
    expect(names).toEqual(['Appointment', 'Project', 'Quick ticket', 'Request'])
    for (const t of listTemplates(db)) expect(JSON.stringify(ticketLayout(getTemplate(db, t.id)!.layout))).not.toMatch(REPAIR_WORDS)
    expect(DEFAULT_TICKET_LAYOUT.titleLabel).toBe('Name')
    expect(statusLabel('intake')).toBe('New')
    expect(getSetting(db, 'messageTemplates')).toBeNull()
  })

  it('an install from before keeps what it showed: repair statuses, messages and box names', () => {
    const db = fresh()
    setSetting(db, 'starterTemplateCreated', true)
    const old = createTemplate(db, { name: 'My form', kind: 'ticket', layout: { titleLabel: 'Device' } })
    // stored before 1.1: the old defaults weren't saved on the template
    db.prepare('UPDATE templates SET layout = ? WHERE id = ?').run(JSON.stringify({ titleLabel: 'Device' }), old.id)
    start(db)
    expect(statusLabel('intake')).toBe('Intake')
    expect(statusLabel('ready')).toBe('Ready for pickup')
    expect((getSetting(db, 'messageTemplates') as { name: string }[])[0].name).toBe('Ready for pickup')
    const l = ticketLayout(getTemplate(db, old.id)!.layout)
    expect(l).toMatchObject({ titleLabel: 'Device', summaryPlaceholder: 'A short description', pickupLabel: 'Pickup', receivedLabel: 'Received' })
    start(db) // only once
    expect(listTemplates(db).filter((t) => t.name === 'Quick ticket')).toHaveLength(1)
  })

  it('a 1.0 profile set up for something else loses the "Dell laptop, iPhone 13" wording on Quick ticket', () => {
    const db = fresh()
    setSetting(db, 'starterTemplateCreated', true)
    setSetting(db, 'ticketPresetsCreated', true)
    setSetting(db, 'useCases', ['art'])
    const old = presetLayout10({ sections: [] })
    const q = createTemplate(db, { name: 'Quick ticket', kind: 'ticket' })
    db.prepare('UPDATE templates SET layout = ? WHERE id = ?').run(JSON.stringify({ titlePlaceholder: old.titlePlaceholder, summaryLabel: old.summaryLabel, summaryPlaceholder: old.summaryPlaceholder }), q.id)
    start(db)
    expect(ticketLayout(getTemplate(db, q.id)!.layout).titlePlaceholder).toBe('Give it a name')
  })

  it('every use case is complete: its presets, sections and note templates exist', () => {
    const ids = new Set<string>()
    for (const p of TICKET_PRESETS) {
      expect(ids.has(p.id), p.id).toBe(false)
      ids.add(p.id)
      for (const s of p.sections) expect(sectionPreset(s), `${p.id} → ${s}`).toBeTruthy()
    }
    expect(new Set(TICKET_PRESETS.map((p) => p.name)).size).toBe(TICKET_PRESETS.length)
    expect(new Set(TICKET_SECTIONS.map((s) => s.id)).size).toBe(TICKET_SECTIONS.length)
    expect(new Set(NOTE_LIBRARY.map((s) => s.name)).size).toBe(NOTE_LIBRARY.length)
    const useIds = new Set(USE_CASES.map((u) => u.id))
    for (const x of [...TICKET_PRESETS, ...TICKET_SECTIONS, ...NOTE_LIBRARY]) for (const u of x.uses ?? []) expect(useIds.has(u), u).toBe(true)
    for (const u of USE_CASES) {
      const plan = planFor([u.id])
      if (u.startPreset) expect(plan.presets.map((p) => p.id)).toContain(u.startPreset)
      if (u.id !== 'other' && u.id !== 'personal') expect(plan.presets.some((p) => p.uses?.includes(u.id)), u.id).toBe(true)
    }
  })

  it('picking a use hides sections that only fit other work, and repair words stay with repair', () => {
    const design = planFor(['design'])
    expect(design.hideSections).toContain('passcode')
    expect(design.hideSections).not.toContain('design-notes')
    expect(design.hideSections).not.toContain('part:pickup')
    const shown = allSections({ custom: [], hidden: design.hideSections }).map((s) => s.title)
    expect(shown).toContain('Design notes')
    expect(shown).toContain('Due date')
    for (const p of planFor(['school', 'design', 'shop']).presets) expect(JSON.stringify(p), p.id).not.toMatch(/iphone|dell laptop/i)
    expect(planFor(['other']).hideSections).toEqual([])
    expect(planFor(['school']).primary?.names?.tickets).toBe('Assignments')
  })
})
