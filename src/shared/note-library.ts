import type { DocJSON } from './api'

/**
 * Note templates ("types" of note) for every kind of use. Every install gets the ones for everyone; the setup adds the
 * ones for what you do (`uses`, ids from use-cases.ts), never twice. They're ordinary templates: edit or delete freely.
 */

const text = (t: string): DocJSON => ({ type: 'text', text: t })
const p = (t = ''): DocJSON => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })
const h = (t: string, level = 2): DocJSON => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const bullets = (...items: string[]): DocJSON => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const numbered = (...items: string[]): DocJSON => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const todos = (...items: string[]): DocJSON => ({ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] })) })
const field = (label: string, kind = 'text', options: string[] = []): DocJSON => ({ type: 'paragraph', content: [{ type: 'formField', attrs: { label, kind, options, value: '' } }] })
const callout = (tone: string, t: string): DocJSON => ({ type: 'callout', attrs: { tone }, content: [p(t)] })
const table = (head: string[], rows = 3): DocJSON => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...Array.from({ length: rows }, () => ({ type: 'tableRow', content: head.map(() => ({ type: 'tableCell', content: [p()] })) }))
  ]
})
const doc = (...content: DocJSON[]): DocJSON => ({ type: 'doc', content: [...content, p()] })

export interface NoteTemplateDef {
  name: string
  icon: string
  /** Who it's for (use-cases.ts ids); none = everyone */
  uses?: string[]
  content: DocJSON
}

export const NOTE_LIBRARY: NoteTemplateDef[] = [
  // Everyone
  { name: 'Meeting notes', icon: 'Users', content: doc(field('Date', 'date'), field('With', 'text'), h('Agenda'), bullets(''), h('Notes'), p(), h('Action items'), todos('')) },
  { name: 'Checklist', icon: 'ListChecks', content: doc(callout('tip', 'Tick items off as you go. Untick them all to reuse the list.'), todos('', '', '')) },
  { name: 'Weekly plan', icon: 'Calendar', content: doc(field('Week of', 'date'), h('Goals'), todos(''), ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].flatMap((d) => [h(d, 3), todos('')])) },
  { name: 'Daily log', icon: 'Book', content: doc(field('Date', 'date'), h('What happened'), p(), h('Wins'), bullets(''), h('Problems'), bullets(''), h('Tomorrow'), todos('')) },
  // Personal & home
  { name: 'Recipe', icon: 'Coffee', uses: ['personal'], content: doc(field('Serves', 'number'), field('Time', 'text'), h('Ingredients'), todos('', '', ''), h('Steps'), numbered('', ''), h('Notes'), p()) },
  { name: 'Journal', icon: 'Book', uses: ['personal'], content: doc(field('Date', 'date'), field('Mood', 'select', ['Great', 'Good', 'Okay', 'Rough']), h('Today'), p(), h('Grateful for'), bullets('')) },
  { name: 'Trip plan', icon: 'MapPin', uses: ['personal'], content: doc(field('Leaving', 'date'), field('Back', 'date'), h('Where we’re staying'), p(), h('Plan'), table(['Day', 'What', 'Notes'], 3), h('To pack'), todos('', '', '')) },
  // School
  { name: 'Class notes', icon: 'GraduationCap', uses: ['school'], content: doc(field('Class', 'text'), field('Date', 'date'), h('Topic'), p(), h('Notes'), bullets(''), h('Questions to ask'), bullets(''), h('Homework'), todos('')) },
  { name: 'Study guide', icon: 'BookOpen', uses: ['school'], content: doc(field('Class', 'text'), field('Test date', 'date'), h('Topics'), todos('', '', ''), h('Key terms'), table(['Term', 'Meaning'], 4), h('Practice questions'), numbered('', '')) },
  { name: 'Essay outline', icon: 'FileText', uses: ['school'], content: doc(field('Due', 'date'), h('Thesis'), p(), h('Points'), numbered('', '', ''), h('Sources'), bullets('')) },
  // Work & projects
  { name: 'Project plan', icon: 'Briefcase', uses: ['work', 'freelance'], content: doc(field('Owner', 'text'), field('Due', 'date'), h('Goal'), p(), h('Steps'), todos('', '', ''), h('Risks'), bullets(''), h('Decisions'), bullets('')) },
  { name: 'One-on-one', icon: 'User', uses: ['work'], content: doc(field('With', 'text'), field('Date', 'date'), h('Wins'), bullets(''), h('Blockers'), bullets(''), h('Next steps'), todos('')) },
  // Repair & tech
  {
    name: 'Repair guide',
    icon: 'Wrench',
    uses: ['repair'],
    content: doc(field('Device', 'text'), field('Difficulty', 'select', ['Easy', 'Moderate', 'Hard']), field('Time', 'text'), callout('warning', 'Disconnect the battery before working on the board.'), h('Tools'), bullets(''), h('Parts'), table(['Part', 'Supplier', 'Cost'], 2), h('Steps'), numbered('', ''), h('Notes & gotchas'), p())
  },
  {
    name: 'Supplier',
    icon: 'Truck',
    uses: ['repair', 'shop', 'trades', 'events'],
    content: doc(field('Company', 'text'), field('Contact', 'text'), field('Phone', 'text'), field('Email', 'text'), field('Website', 'text'), field('Account #', 'text'), h('Prices'), table(['Item', 'Price', 'Lead time']), h('Notes'), p())
  },
  { name: 'Inventory', icon: 'Package', uses: ['repair', 'shop'], content: doc(callout('info', 'One row per item. Update the quantity when you use or order more.'), table(['Item', 'Qty', 'Cost', 'Supplier', 'Reorder at'], 5)) },
  // Trades
  { name: 'Job site notes', icon: 'Home', uses: ['trades'], content: doc(field('Address', 'text'), field('Date', 'date'), h('What we found'), p(), h('Measurements'), table(['Where', 'Size'], 3), h('To bring next time'), todos('')) },
  // Design & art
  { name: 'Design notes', icon: 'Palette', uses: ['design', 'art'], content: doc(field('Project', 'text'), h('Colours'), p(), h('Fonts'), p(), h('Style'), p(), h('Ideas'), bullets(''), h('Don’t'), bullets('')) },
  { name: 'Client brief', icon: 'Lightbulb', uses: ['design', 'art', 'freelance'], content: doc(field('Client', 'text'), field('Due', 'date'), field('Budget', 'money'), h('What they want'), p(), h('Who it’s for'), p(), h('Must have'), todos(''), h('References'), bullets('')) },
  { name: 'Idea list', icon: 'Sparkles', uses: ['design', 'art', 'shop'], content: doc(callout('tip', 'Jot ideas down as they come; tick the ones you made.'), todos('', '', '')) },
  // Shop
  { name: 'Product', icon: 'Tag', uses: ['shop'], content: doc(field('Price', 'money'), field('Cost', 'money'), field('In stock', 'number'), h('Description'), p(), h('Made with'), bullets('')) },
  // Bookings
  { name: 'Lesson plan', icon: 'BookOpen', uses: ['bookings', 'school'], content: doc(field('Who', 'text'), field('Date', 'date'), h('Goal'), p(), h('Plan'), numbered('', ''), h('Homework'), todos('')) },
  { name: 'Client profile', icon: 'User', uses: ['bookings'], content: doc(field('Name', 'text'), field('Since', 'date'), h('Preferences'), bullets(''), h('Notes'), p()) },
  // Events
  { name: 'Event plan', icon: 'Calendar', uses: ['events'], content: doc(field('Date', 'date'), field('Venue', 'text'), field('Guests', 'number'), h('Schedule'), table(['Time', 'What', 'Who'], 4), h('To book'), todos('Venue', 'Food', 'Music', 'Decor'), h('Notes'), p()) },
  // Freelance
  { name: 'Invoice log', icon: 'Receipt', uses: ['freelance'], content: doc(table(['Client', 'Sent', 'Amount', 'Paid'], 5)) }
]

/** The note templates for these uses (and the ones for everyone) */
export const noteTemplatesFor = (uses: string[]): NoteTemplateDef[] => {
  const all = uses.includes('other')
  return NOTE_LIBRARY.filter((t) => !t.uses || all || t.uses.some((u) => uses.includes(u)))
}
