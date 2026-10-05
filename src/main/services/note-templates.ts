import type { Db } from '../db'
import type { DocJSON } from '../../shared/api'
import { getSetting, setSetting } from './settings'
import { createTemplate } from './templates'

/* Starter note templates ("types" of note), created once. They're ordinary templates: edit or delete them freely. */

const text = (t: string, marks?: DocJSON['marks']): DocJSON => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const p = (t = ''): DocJSON => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })
const h = (t: string, level = 2): DocJSON => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const bullets = (...items: string[]): DocJSON => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const numbered = (...items: string[]): DocJSON => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const todos = (...items: string[]): DocJSON => ({
  type: 'taskList',
  content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] }))
})
const field = (label: string, kind = 'text', options: string[] = []): DocJSON => ({
  type: 'paragraph',
  content: [{ type: 'formField', attrs: { label, kind, options, value: '' } }]
})
const callout = (tone: string, t: string): DocJSON => ({ type: 'callout', attrs: { tone }, content: [p(t)] })
const table = (head: string[], rows = 3): DocJSON => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...Array.from({ length: rows }, () => ({ type: 'tableRow', content: head.map(() => ({ type: 'tableCell', content: [p()] })) }))
  ]
})
const doc = (...content: DocJSON[]): DocJSON => ({ type: 'doc', content: [...content, p()] })

export const STARTER_NOTE_TEMPLATES: { name: string; icon: string; content: DocJSON }[] = [
  {
    name: 'Meeting notes',
    icon: 'Users',
    content: doc(field('Date', 'date'), field('With', 'text'), h('Agenda'), bullets(''), h('Notes'), p(), h('Action items'), todos(''))
  },
  {
    name: 'Checklist',
    icon: 'ListChecks',
    content: doc(callout('tip', 'Tick items off as you go. Untick them all to reuse the list.'), todos('', '', ''))
  },
  {
    name: 'Repair guide',
    icon: 'Wrench',
    content: doc(
      field('Device', 'text'),
      field('Difficulty', 'select', ['Easy', 'Moderate', 'Hard']),
      field('Time', 'text'),
      callout('warning', 'Disconnect the battery before working on the board.'),
      h('Tools'),
      bullets(''),
      h('Parts'),
      table(['Part', 'Supplier', 'Cost'], 2),
      h('Steps'),
      numbered('', ''),
      h('Notes & gotchas'),
      p()
    )
  },
  {
    name: 'Supplier',
    icon: 'Truck',
    content: doc(
      field('Company', 'text'),
      field('Contact', 'text'),
      field('Phone', 'text'),
      field('Email', 'text'),
      field('Website', 'text'),
      field('Account #', 'text'),
      h('Prices'),
      table(['Item', 'Price', 'Lead time']),
      h('Notes'),
      p()
    )
  },
  {
    name: 'Inventory',
    icon: 'Package',
    content: doc(callout('info', 'One row per item. Update the quantity when you use or order parts.'), table(['Item', 'Qty', 'Cost', 'Supplier', 'Reorder at'], 5))
  },
  {
    name: 'Weekly plan',
    icon: 'Calendar',
    content: doc(
      field('Week of', 'date'),
      h('Goals'),
      todos(''),
      ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].flatMap((d) => [h(d, 3), todos('')])
    )
  },
  {
    name: 'Daily log',
    icon: 'Book',
    content: doc(field('Date', 'date'), h('What happened'), p(), h('Wins'), bullets(''), h('Problems'), bullets(''), h('Tomorrow'), todos(''))
  }
]

/** Creates the starter note templates the first time this version runs. */
export function ensureStarterNoteTemplates(db: Db): void {
  if (getSetting(db, 'starterNoteTemplatesCreated')) return
  for (const t of STARTER_NOTE_TEMPLATES) createTemplate(db, { ...t, kind: 'note' })
  setSetting(db, 'starterNoteTemplatesCreated', true)
}
