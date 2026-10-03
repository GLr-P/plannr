import type { DocJSON, EntityType } from '../../shared/api'
import type { LinkTarget } from './links'

const BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
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
      const value = node.attrs?.kind === 'checkbox' ? (raw === 'true' ? 'Yes' : 'No') : raw
      line += `${line ? ' ' : ''}${label}: ${value}`
    } else if (node.type === 'hardBreak') line += ' '
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
