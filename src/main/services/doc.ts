import type { DocJSON, EntityType } from '../../shared/api'
import type { LinkTarget } from './links'

const BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary', 'tableCell', 'tableHeader', 'fileAttachment', 'canvasText', 'formField'])
const ENTITY_TYPES = new Set<EntityType>(['note', 'customer', 'ticket'])

/** Plain text of a document, one line per block; used for search and previews. */
export function extractText(doc: DocJSON | null | undefined): string {
  if (!doc) return ''
  const lines: string[] = []
  let line = ''
  const walk = (node: DocJSON): void => {
    if (node.type === 'text') line += node.text ?? ''
    else if (node.type === 'mention') line += `@${String(node.attrs?.label ?? '')}`
    else if (node.type === 'formField') {
      const label = String(node.attrs?.label ?? '')
      const raw = String(node.attrs?.value ?? '')
      const value = fieldText(String(node.attrs?.kind ?? ''), raw)
      line += `${line ? ' ' : ''}${label}: ${value}`
    } else if (node.type === 'hardBreak') line += ' '
    else if (node.type === 'fileAttachment') line += String(node.attrs?.name ?? '')
    else if (node.type === 'canvasText') line += String(node.attrs?.text ?? '').replace(/\s+/g, ' ')
    node.content?.forEach(walk)
    if (BLOCKS.has(node.type)) {
      if (line.trim()) lines.push(line.trim())
      line = ''
    }
  }
  walk(doc)
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n')
}

export function extractMentions(doc: DocJSON | null | undefined): LinkTarget[] {
  const found = new Map<string, LinkTarget>()
  const walk = (node: DocJSON): void => {
    if (node.type === 'mention' && typeof node.attrs?.id === 'string') {
      const kind = node.attrs.kind as EntityType | undefined
      found.set(node.attrs.id, { type: kind && ENTITY_TYPES.has(kind) ? kind : 'note', id: node.attrs.id })
    }
    node.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return [...found.values()]
}

/** Escapes a user term for a LIKE '%term%' pattern (use with ESCAPE '\'). */
export const likeTerm = (term: string): string => `%${term.replace(/[\%_]/g, '\$&')}%`

export const digitsOnly = (s: string): string => s.replace(/\D/g, '')

/** Today's date as YYYY-MM-DD in local time. */
export function localDate(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** A fill-in field's value as text: checkboxes are Yes/No, "pick several" lists are joined. */
export function fieldText(kind: string, raw: string): string {
  if (kind === 'checkbox') return raw === 'true' ? 'Yes' : 'No'
  if (kind === 'multi') {
    try {
      const list = JSON.parse(raw) as unknown
      if (Array.isArray(list)) return list.filter((x) => typeof x === 'string').join(', ')
    } catch {
      // stored as plain text
    }
  }
  return raw
}
