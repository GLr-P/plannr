import type { Db } from '../db'
import { newId, now } from '../db'
import { REPAIR_TICKET_LAYOUT, ticketLayout, type DocJSON, type Template, type TemplateKind, type TemplateSummary, type TicketLayout } from '../../shared/api'
import { cleanIcon } from './folders'
import { getSetting, setSetting } from './settings'

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
  const diff = Object.fromEntries(Object.entries(full).filter(([k, v]) => base[k as keyof TicketLayout] !== v))
  return Object.keys(diff).length ? JSON.stringify(diff) : null
}

/** The layout of a ticket's template (or the defaults for a blank ticket). */
export function layoutForTicket(db: Db, ticketId: string): TicketLayout {
  const r = db.prepare('SELECT tp.layout FROM tickets t LEFT JOIN templates tp ON tp.id = t.template_id WHERE t.id = ?').get(ticketId) as
    | { layout: string | null }
    | undefined
  return ticketLayout(parseLayout(r?.layout))
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

/** Creates the starter "Repair intake" template the first time the app runs. */
export function ensureStarterTemplate(db: Db): void {
  if (getSetting(db, 'starterTemplateCreated')) return
  const template = createTemplate(db, { name: 'Repair intake', content: REPAIR_INTAKE, layout: REPAIR_TICKET_LAYOUT })
  setSetting(db, DEFAULT_KEY, template.id)
  setSetting(db, 'starterTemplateCreated', true)
}

/**
 * Once, when ticket layouts arrive: the starter "Repair intake" template gets the repair wording it always had,
 * and tickets without a template follow the default template, so existing tickets look the same as before.
 */
export function ensureTicketLayouts(db: Db): void {
  if (getSetting(db, 'ticketLayoutsSet')) return
  db.prepare("UPDATE templates SET layout = ? WHERE kind = 'ticket' AND name = 'Repair intake' AND layout IS NULL").run(storeLayout(REPAIR_TICKET_LAYOUT))
  const def = getSetting(db, DEFAULT_KEY)
  if (typeof def === 'string' && getTemplate(db, def)) db.prepare('UPDATE tickets SET template_id = ? WHERE template_id IS NULL').run(def)
  setSetting(db, 'ticketLayoutsSet', true)
}
