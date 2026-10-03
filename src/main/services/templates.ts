import type { Db } from '../db'
import { newId, now } from '../db'
import type { DocJSON, Template, TemplateSummary } from '../../shared/api'
import { getSetting, setSetting } from './settings'

interface TemplateRow {
  id: string
  name: string
  content_json: string | null
  updated_at: number
}

const DEFAULT_KEY = 'defaultTemplateId'

export function listTemplates(db: Db): TemplateSummary[] {
  const rows = db.prepare('SELECT id, name, updated_at FROM templates WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE').all() as unknown as TemplateRow[]
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }))
}

export function getTemplate(db: Db, id: string): Template | null {
  const r = db.prepare('SELECT id, name, content_json, updated_at FROM templates WHERE id = ? AND deleted_at IS NULL').get(id) as
    | TemplateRow
    | undefined
  if (!r) return null
  return { id: r.id, name: r.name, updatedAt: r.updated_at, content: r.content_json ? (JSON.parse(r.content_json) as DocJSON) : null }
}

export function createTemplate(db: Db, input: { name?: string; content?: DocJSON | null } = {}): Template {
  const id = newId()
  const t = now()
  db.prepare('INSERT INTO templates (id, name, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    input.name?.trim() || 'New template',
    input.content ? JSON.stringify(input.content) : null,
    t,
    t
  )
  return getTemplate(db, id)!
}

export function updateTemplate(db: Db, id: string, patch: { name?: string; content?: DocJSON }): void {
  const sets: string[] = []
  const params: (string | number)[] = []
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
  const template = createTemplate(db, { name: 'Repair intake', content: REPAIR_INTAKE })
  setSetting(db, DEFAULT_KEY, template.id)
  setSetting(db, 'starterTemplateCreated', true)
}
