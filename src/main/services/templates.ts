import type { Db } from '../db'
import { newId, now } from '../db'
import { LEGACY_LAYOUT_NAMES, REPAIR_TICKET_LAYOUT, ticketLayout, type DocJSON, type Template, type TemplateKind, type TemplateSummary, type TicketLayout } from '../../shared/api'
import { cleanIcon } from './folders'
import { NOTE_LIBRARY } from '../../shared/note-library'
import { getSetting, setSetting } from './settings'
import { presetDoc, presetLayout, presetLayout10, TICKET_PRESETS, untouched10, type TicketPreset } from '../../shared/ticket-sections'

interface TemplateRow {
  id: string
  name: string
  kind: TemplateKind
  icon: string
  content_json: string | null
  layout?: string | null
  updated_at: number
}

const toSummary = (r: TemplateRow): TemplateSummary => ({ id: r.id, name: r.name, kind: r.kind, icon: r.icon, updatedAt: r.updated_at })

const DEFAULT_KEY = 'defaultTemplateId'

export function listTemplates(db: Db, kind: TemplateKind = 'ticket'): TemplateSummary[] {
  const rows = db
    .prepare('SELECT id, name, kind, icon, updated_at FROM templates WHERE deleted_at IS NULL AND kind = ? ORDER BY name COLLATE NOCASE')
    .all(kind) as unknown as TemplateRow[]
  return rows.map(toSummary)
}

export function getTemplate(db: Db, id: string): Template | null {
  const r = db.prepare('SELECT id, name, kind, icon, content_json, layout, updated_at FROM templates WHERE id = ? AND deleted_at IS NULL').get(id) as
    | TemplateRow
    | undefined
  if (!r) return null
  return { ...toSummary(r), content: r.content_json ? (JSON.parse(r.content_json) as DocJSON) : null, layout: parseLayout(r.layout) }
}

const parseLayout = (raw: string | null | undefined): Partial<TicketLayout> | null => {
  try {
    return raw ? (JSON.parse(raw) as Partial<TicketLayout>) : null
  } catch {
    return null
  }
}

/** Only the parts that differ from the defaults are kept, so later changes to the defaults still apply. */
function storeLayout(layout: Partial<TicketLayout> | null | undefined): string | null {
  if (!layout) return null
  const full = ticketLayout(layout)
  const base = ticketLayout(null)
  const diff = Object.fromEntries(Object.entries(full).filter(([k, v]) => JSON.stringify(base[k as keyof TicketLayout]) !== JSON.stringify(v)))
  return Object.keys(diff).length ? JSON.stringify(diff) : null
}

/** The layout of a ticket's template (or the defaults for a blank ticket). */
export function layoutForTicket(db: Db, ticketId: string): TicketLayout {
  const r = db.prepare('SELECT tp.layout, t.layout AS own FROM tickets t LEFT JOIN templates tp ON tp.id = t.template_id WHERE t.id = ?').get(ticketId) as
    | { layout: string | null; own: string | null }
    | undefined
  // The template's layout, then this ticket's own changes on top (a renamed or removed box)
  return ticketLayout({ ...parseLayout(r?.layout), ...parseLayout(r?.own) })
}

export function createTemplate(
  db: Db,
  input: { name?: string; content?: DocJSON | null; kind?: TemplateKind; icon?: string; layout?: Partial<TicketLayout> | null } = {}
): Template {
  const id = newId()
  const t = now()
  db.prepare('INSERT INTO templates (id, name, kind, icon, content_json, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    input.name?.trim() || 'New template',
    input.kind === 'note' ? 'note' : 'ticket',
    cleanIcon(input.icon ?? ''),
    input.content ? JSON.stringify(input.content) : null,
    input.kind === 'note' ? null : storeLayout(input.layout),
    t,
    t
  )
  return getTemplate(db, id)!
}

export function updateTemplate(db: Db, id: string, patch: { name?: string; content?: DocJSON; icon?: string; layout?: Partial<TicketLayout> | null }): void {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (patch.layout !== undefined) {
    sets.push('layout = ?')
    params.push(storeLayout(patch.layout))
  }
  if (patch.icon !== undefined) {
    sets.push('icon = ?')
    params.push(cleanIcon(patch.icon))
  }
  if (patch.name !== undefined) {
    sets.push('name = ?')
    params.push(patch.name.slice(0, 200))
  }
  if (patch.content !== undefined) {
    sets.push('content_json = ?')
    params.push(JSON.stringify(patch.content))
  }
  sets.push('updated_at = ?')
  params.push(now(), id)
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function removeTemplate(db: Db, id: string): void {
  db.prepare('UPDATE templates SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
  if (getSetting(db, DEFAULT_KEY) === id) setSetting(db, DEFAULT_KEY, listTemplates(db)[0]?.id ?? null)
}

/** The template new tickets start from: the saved choice if it still exists, else the first one. */
export function getDefaultTemplateId(db: Db): string | null {
  const saved = getSetting(db, DEFAULT_KEY)
  if (typeof saved === 'string' && getTemplate(db, saved)) return saved
  return listTemplates(db)[0]?.id ?? null
}

// ---------- Built-in starter template ----------

const text = (t: string): DocJSON => ({ type: 'text', text: t })
const heading = (t: string): DocJSON => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] })
const field = (label: string, kind: string, options: string[] = []): DocJSON => ({
  type: 'paragraph',
  content: [{ type: 'formField', attrs: { label, kind, options, value: '' } }]
})
const task = (t: string): DocJSON => ({
  type: 'taskItem',
  attrs: { checked: false },
  content: [{ type: 'paragraph', content: [text(t)] }]
})

export const REPAIR_INTAKE: DocJSON = {
  type: 'doc',
  content: [
    heading('Check-in'),
    field('Passcode', 'text'),
    field('Condition on arrival', 'textarea'),
    field('Accessories left', 'text'),
    field('Data backup', 'select', ['Not needed', 'Needed', 'Customer declined']),
    field('Problem (customer’s words)', 'textarea'),
    heading('Work'),
    { type: 'taskList', content: [task('Diagnosed'), task('Customer approved quote'), task('Repaired'), task('Tested'), task('Customer notified')] },
    field('Work performed', 'textarea'),
    field('Parts used', 'text'),
    field('Warranty (days)', 'number'),
    { type: 'paragraph' }
  ]
}

/**
 * Before 1.1 the first run made a "Repair intake" template. Since then a fresh install starts with the presets for
 * everyone only (repair ones come with the repair setup); the flag still marks "this install has run before".
 */
export function ensureStarterTemplate(db: Db): void {
  if (getSetting(db, 'starterTemplateCreated')) return
  setSetting(db, 'starterTemplateCreated', true)
}

/** The repair starter (made by the repair setup if it isn't there) */
export const REPAIR_INTAKE_TEMPLATE = { name: 'Repair intake', icon: 'Wrench', content: REPAIR_INTAKE, layout: REPAIR_TICKET_LAYOUT }

const LEGACY_KEYS = ['titleLabel', 'titlePlaceholder', 'summaryLabel', 'summaryPlaceholder', 'receivedLabel', 'pickupLabel'] as const

/**
 * Once, on installs from before 1.1 (when the standard wording became general): templates keep the box names they
 * showed (anything they took from the old defaults is saved on them), and an install whose setup didn't include
 * repair gets the general wording on built-in presets it never changed (the 1.0 Quick ticket said "Dell laptop,
 * iPhone 13"). `existing` = the install ran before this version.
 */
export function pinLegacyTemplateWording(db: Db, existing: boolean, uses: string[] | null): void {
  if (!existing) return
  const rows = db.prepare("SELECT id, name, layout FROM templates WHERE kind = 'ticket' AND deleted_at IS NULL").all() as unknown as { id: string; name: string; layout: string | null }[]
  const general = uses !== null && uses.length > 0 && !uses.includes('repair')
  for (const r of rows) {
    const saved = parseLayout(r.layout) ?? {}
    const preset = TICKET_PRESETS.find((p) => p.name === r.name && !p.uses)
    if (general && preset && untouched10(saved)) {
      updateTemplate(db, r.id, { layout: { ...saved, ...presetLayout(preset) } })
      continue
    }
    const missing = LEGACY_KEYS.filter((k) => saved[k] === undefined)
    if (missing.length) updateTemplate(db, r.id, { layout: { ...saved, ...Object.fromEntries(missing.map((k) => [k, LEGACY_LAYOUT_NAMES[k]])) } })
  }
}

/**
 * Once, when ticket layouts arrive: the starter "Repair intake" template gets the repair wording it always had,
 * and tickets without a template follow the default template, so existing tickets look the same as before.
 */
export function ensureTicketLayouts(db: Db): void {
  if (!getSetting(db, 'ticketLayoutsSet')) setTicketLayouts(db)
  ensureTicketPresets(db)
}

function setTicketLayouts(db: Db): void {
  db.prepare("UPDATE templates SET layout = ? WHERE kind = 'ticket' AND name = 'Repair intake' AND layout IS NULL").run(storeLayout(REPAIR_TICKET_LAYOUT))
  const def = getSetting(db, DEFAULT_KEY)
  if (typeof def === 'string' && getTemplate(db, def)) db.prepare('UPDATE tickets SET template_id = ? WHERE template_id IS NULL').run(def)
  setSetting(db, 'ticketLayoutsSet', true)
}

/**
 * Once: the presets for everyone become ticket templates (they can be edited, renamed or deleted like any other),
 * and new tickets start from "Quick ticket", the minimum (requested 2026-11-14: "I don't want this to be a static
 * ticket"). The setup adds the presets for what you do (use-cases.ts).
 */
export function ensureTicketPresets(db: Db): void {
  if (getSetting(db, 'ticketPresetsCreated')) return
  let quick: string | null = null
  for (const preset of TICKET_PRESETS.filter((p) => !p.uses)) {
    const t = createTemplate(db, { name: preset.name, kind: 'ticket', icon: preset.icon, content: presetDoc(preset), layout: presetLayout(preset) })
    if (preset.id === 'quick') quick = t.id
  }
  if (quick) setSetting(db, DEFAULT_KEY, quick)
  setSetting(db, 'ticketPresetsCreated', true)
}


/** The template new tickets start from */
export function setDefaultTemplateId(db: Db, id: string): void {
  setSetting(db, DEFAULT_KEY, id)
}

/**
 * Tests only (PLANNR_SEED_LEGACY): a fresh data folder set up the way 1.0 left a new install (repair starter, the
 * 1.0 presets with their wording), so older end-to-end tests keep testing what they were written for. The legacy
 * pinning then treats it as an install from before 1.1.
 */
export function seedLegacyInstall(db: Db): void {
  if (getSetting(db, 'starterTemplateCreated')) return
  createTemplate(db, { name: REPAIR_INTAKE_TEMPLATE.name, content: REPAIR_INTAKE, layout: REPAIR_TICKET_LAYOUT })
  const own10: Record<string, Partial<TicketPreset>> = {
    build: { titlePlaceholder: 'What’s being built or ordered' },
    delivery: { titleLabel: 'Order', titlePlaceholder: 'What they ordered', summaryLabel: 'Notes', summaryPlaceholder: 'Anything special about it', pickupLabel: 'Delivery' }
  }
  let quick = ''
  for (const id of ['quick', 'shop', 'remote', 'housecall', 'tuneup', 'security', 'setup', 'build', 'delivery', 'appointment']) {
    const p = TICKET_PRESETS.find((x) => x.id === id)!
    const t = createTemplate(db, { name: p.name, kind: 'ticket', icon: p.icon, content: presetDoc(p), layout: { ...presetLayout(p), receivedLabel: 'Received', ...presetLayout10({ sections: [], ...own10[id] }) } })
    if (id === 'quick') quick = t.id
  }
  setSetting(db, DEFAULT_KEY, quick)
  setSetting(db, 'starterTemplateCreated', true)
  setSetting(db, 'ticketPresetsCreated', true)
  setSetting(db, 'ticketLayoutsSet', true)
  for (const name of ['Meeting notes', 'Checklist', 'Repair guide', 'Supplier', 'Inventory', 'Weekly plan', 'Daily log']) {
    const n = NOTE_LIBRARY.find((x) => x.name === name)!
    createTemplate(db, { name, icon: n.icon, content: n.content, kind: 'note' })
  }
  setSetting(db, 'starterNoteTemplatesCreated', true)
}
