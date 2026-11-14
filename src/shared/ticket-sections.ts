import type { DocJSON, TicketPart } from './api'

/**
 * Ticket sections and presets. A new ticket holds the minimum (customer, what it is, what they need, the quote);
 * everything else is added when it's needed:
 * - a **section** is a block of fill-in fields, text or a checklist (`ticketSection` node, attrs `preset` and `title`),
 *   or one of the ticket page's built-in **parts** (pickup date, photos, quote lines, warranty, emails);
 * - a **preset** is a bundle of sections for a kind of job (shop repair, remote support, house call…).
 * Designed from real repair tickets (mostly remote and house calls; passcode, accessories and parts often blank)
 * and kept general enough for orders, deliveries and appointments. Pure, so the phone and tests use it.
 */

export type SectionGroup = 'device' | 'work' | 'visit' | 'order' | 'other'

export const SECTION_GROUPS: { id: SectionGroup; label: string }[] = [
  { id: 'device', label: 'Device' },
  { id: 'work', label: 'Work' },
  { id: 'visit', label: 'Visit' },
  { id: 'order', label: 'Order' },
  { id: 'other', label: 'Other' }
]

export interface SectionPreset {
  id: string
  title: string
  /** An icon name from the app's icon set (lib/icons.tsx) */
  icon: string
  group: SectionGroup
  /** One line in the + Add menu */
  hint: string
  /** Search words for the + Add menu and the / menu */
  keywords: string
  /** A built-in part of the ticket page instead of text in the ticket */
  part?: TicketPart
  /** What goes inside the section (document sections only) */
  content?: () => DocJSON[]
}

const text = (t: string): DocJSON => ({ type: 'text', text: t })
export const p = (t?: string): DocJSON => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })
interface FieldOpts {
  options?: string[]
  placeholder?: string
  rows?: number
  formula?: string
  format?: string
  link?: string
}
/** A fill-in field on its own line */
export const field = (label: string, kind: string, o: FieldOpts = {}): DocJSON => ({
  type: 'paragraph',
  content: [{ type: 'formField', attrs: { label, kind, value: '', options: o.options ?? [], ...(o.placeholder ? { placeholder: o.placeholder } : {}), ...(o.rows ? { rows: o.rows } : {}), ...(o.formula ? { formula: o.formula, format: o.format ?? 'money' } : {}), ...(o.link ? { link: o.link } : {}) } }]
})
export const long = (label: string, placeholder?: string, rows = 4): DocJSON => field(label, 'textarea', { placeholder, rows })
export const checklist = (items: string[]): DocJSON => ({
  type: 'taskList',
  content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(t)] }))
})

export const TICKET_SECTIONS: SectionPreset[] = [
  // Device
  {
    id: 'passcode',
    title: 'Passcode & logins',
    icon: 'Key',
    group: 'device',
    hint: 'Device passcode, PIN or pattern, account logins',
    keywords: 'passcode password pin pattern login account apple id microsoft unlock',
    content: () => [field('Passcode / PIN', 'text', { placeholder: 'Left off printouts' }), field('Account login', 'text', { placeholder: 'Apple ID, Microsoft or Google account' })]
  },
  {
    id: 'device',
    title: 'Device details',
    icon: 'Laptop',
    group: 'device',
    hint: 'Make and model, serial number, operating system',
    keywords: 'device make model serial number os operating system brand year',
    content: () => [field('Make & model', 'text'), field('Serial number', 'text'), field('Operating system', 'text', { placeholder: 'Windows 11, macOS 15…' })]
  },
  {
    id: 'specs',
    title: 'Specs',
    icon: 'Cpu',
    group: 'device',
    hint: 'Processor, memory, storage, graphics',
    keywords: 'specs specifications cpu processor ram memory storage ssd hdd drive gpu graphics',
    content: () => [field('Processor', 'text'), field('Memory (RAM)', 'text'), field('Storage', 'text', { placeholder: 'e.g. 512 GB SSD, 2 TB HDD' }), field('Graphics', 'text')]
  },
  {
    id: 'condition',
    title: 'Condition & accessories',
    icon: 'ClipboardList',
    group: 'device',
    hint: 'How it came in and what was left with it',
    keywords: 'condition arrival damage scratches accessories charger cable case left',
    content: () => [long('Condition on arrival', 'Scratches, cracks, what works and what doesn’t', 2), field('Accessories left', 'text', { placeholder: 'Charger, case, cables…' })]
  },
  {
    id: 'backup',
    title: 'Data backup',
    icon: 'HardDrive',
    group: 'device',
    hint: 'Whether their files need saving first, and where they went',
    keywords: 'data backup files photos save transfer',
    content: () => [field('Data backup', 'select', { options: ['Not needed', 'Needed', 'Done', 'Customer declined'] }), field('Backed up to', 'text')]
  },
  // Work
  {
    id: 'diagnosis',
    title: 'Diagnosis',
    icon: 'Zap',
    group: 'work',
    hint: 'What you found',
    keywords: 'diagnosis diagnose found findings cause problem test',
    content: () => [long('What I found')]
  },
  {
    id: 'work',
    title: 'Work done',
    icon: 'Wrench',
    group: 'work',
    hint: 'What was done to fix it',
    keywords: 'work done performed repair fixed steps',
    content: () => [long('Work performed')]
  },
  {
    id: 'parts',
    title: 'Parts used',
    icon: 'Package',
    group: 'work',
    hint: 'Parts that went in (for prices, add Quote lines)',
    keywords: 'parts used replaced components installed',
    content: () => [long('Parts used', 'e.g. 1 TB SSD, battery', 2)]
  },
  {
    id: 'checklist',
    title: 'Repair checklist',
    icon: 'ListChecks',
    group: 'work',
    hint: 'Diagnosed, approved, repaired, tested, customer told',
    keywords: 'checklist steps progress diagnosed approved repaired tested notified',
    content: () => [checklist(['Diagnosed', 'Customer approved quote', 'Repaired', 'Tested', 'Customer notified'])]
  },
  {
    id: 'software',
    title: 'Software installed',
    icon: 'Code',
    group: 'work',
    hint: 'Programs installed, removed or updated',
    keywords: 'software programs installed removed updated apps antivirus drivers windows updates',
    content: () => [long('Installed or updated', undefined, 2), long('Removed', undefined, 2)]
  },
  {
    id: 'accounts',
    title: 'Accounts & email',
    icon: 'Mail',
    group: 'work',
    hint: 'Email, accounts and passwords changed, two-step sign-in',
    keywords: 'accounts email outlook gmail password reset security two step 2fa recovery compromised hacked',
    content: () => [field('Email provider', 'text', { placeholder: 'Outlook, Gmail, Telus…' }), long('Accounts changed', 'Password resets, sessions signed out', 2), field('Two-step sign-in', 'select', { options: ['Not set up', 'Set up', 'Already on', 'Customer declined'] })]
  },
  {
    id: 'network',
    title: 'Network & Wi-Fi',
    icon: 'Wifi',
    group: 'work',
    hint: 'Internet provider, router, network name',
    keywords: 'network wifi wi-fi internet router modem isp provider',
    content: () => [field('Internet provider', 'text'), field('Router / modem', 'text'), field('Network name', 'text')]
  },
  {
    id: 'recommendations',
    title: 'Recommendations',
    icon: 'Lightbulb',
    group: 'work',
    hint: 'What they should do next',
    keywords: 'recommendations advice next steps suggest upgrade',
    content: () => [long('Recommendations', 'Upgrades, password changes, things to watch for', 2)]
  },
  // Visit
  {
    id: 'remote',
    title: 'Remote session',
    icon: 'Monitor',
    group: 'visit',
    hint: 'Remote tool, session ID, time connected',
    keywords: 'remote support session rustdesk teamviewer anydesk quick assist phone call online',
    content: () => [field('Connected with', 'select', { options: ['Phone call', 'RustDesk', 'Quick Assist', 'TeamViewer', 'AnyDesk', 'Other'] }), field('Session ID', 'text'), field('Time connected', 'text', { placeholder: 'e.g. 45 min' })]
  },
  {
    id: 'housecall',
    title: 'House call',
    icon: 'Home',
    group: 'visit',
    hint: 'Where and when you visit',
    keywords: 'house call on site visit home address appointment travel',
    content: () => [field('Address', 'text', { link: 'customer.address' }), field('Visit date', 'date'), field('Arrival time', 'time'), field('Travel', 'text', { placeholder: 'Distance or travel time' })]
  },
  {
    id: 'time',
    title: 'Time spent',
    icon: 'Clock',
    group: 'visit',
    hint: 'Hours and rate, worked out for you',
    keywords: 'time spent hours labour labor rate billing',
    content: () => [field('Hours', 'number'), field('Hourly rate', 'money'), field('Labour', 'calc', { formula: '{Hours} * {Hourly rate}' })]
  },
  // Order
  {
    id: 'delivery',
    title: 'Delivery',
    icon: 'Truck',
    group: 'order',
    hint: 'Recipient, address, phone and card message',
    keywords: 'delivery deliver recipient address card message ship order',
    content: () => [field('Recipient', 'text'), field('Delivery address', 'text'), field('Recipient phone', 'phone'), long('Card message', undefined, 2)]
  },
  {
    id: 'appointment',
    title: 'Event or appointment',
    icon: 'Calendar',
    group: 'order',
    hint: 'Date, time and place',
    keywords: 'event appointment booking date time place location meeting',
    content: () => [field('Date', 'date'), field('Time', 'time'), field('Place', 'text')]
  },
  {
    id: 'payment',
    title: 'Payment notes',
    icon: 'DollarSign',
    group: 'order',
    hint: 'Deposit, how they’re paying',
    keywords: 'payment deposit paid method cash card e-transfer invoice',
    content: () => [field('Deposit', 'money'), field('Paying by', 'select', { options: ['Cash', 'Card', 'E-transfer', 'Cheque', 'Invoice'] })]
  },
  // Other
  {
    id: 'approval',
    title: 'Customer approval',
    icon: 'Flag',
    group: 'other',
    hint: 'Who approved the quote, when and for how much',
    keywords: 'approval approved quote agreed consent go ahead',
    content: () => [field('Approved', 'select', { options: ['Waiting', 'Approved', 'Declined'] }), field('Approved on', 'date'), field('Approved amount', 'money')]
  },
  {
    id: 'followup',
    title: 'Follow-up',
    icon: 'Bell',
    group: 'other',
    hint: 'When to check in and what about',
    keywords: 'follow up follow-up check in call back reminder later',
    content: () => [field('Follow up on', 'date'), field('About', 'text')]
  },
  {
    id: 'internal',
    title: 'Internal notes',
    icon: 'Lock',
    group: 'other',
    hint: 'Notes for yourself',
    keywords: 'internal private notes memo',
    content: () => [p()]
  },
  {
    id: 'notes',
    title: 'Notes',
    icon: 'FileText',
    group: 'other',
    hint: 'A blank section to write anything',
    keywords: 'notes text blank custom anything',
    content: () => [p()]
  },
  // Built-in parts of the ticket page
  { id: 'part:pickup', title: 'Pickup / due date', icon: 'Calendar', group: 'order', hint: 'A date that goes on the calendar', keywords: 'pickup due date delivery calendar deadline', part: 'pickup' },
  { id: 'part:photos', title: 'Photos', icon: 'Camera', group: 'device', hint: 'Before and after photos', keywords: 'photos pictures images before after camera', part: 'photos' },
  { id: 'part:lines', title: 'Quote lines', icon: 'Receipt', group: 'order', hint: 'Labour, parts and discounts that add up to the price', keywords: 'quote invoice lines items parts labour price estimate', part: 'lines' },
  { id: 'part:warranty', title: 'Warranty', icon: 'Shield', group: 'work', hint: 'How long the work is covered', keywords: 'warranty guarantee covered days', part: 'warranty' },
  { id: 'part:emails', title: 'Emails', icon: 'Mail', group: 'other', hint: 'Emails with this customer', keywords: 'emails mail messages inbox', part: 'emails' }
]

export const sectionPreset = (id: string): SectionPreset | undefined => TICKET_SECTIONS.find((s) => s.id === id)

/** A section you saved (or your version of a built-in one, under the same id). Synced setting 'tickets.sections'. */
export interface SectionDef {
  id: string
  title: string
  icon: string
  group: SectionGroup
  hint: string
  content: DocJSON[]
}
/** Your sections, and built-in ones you hid from + Add */
export interface SectionLibrary {
  custom: SectionDef[]
  hidden: string[]
}
export const SECTIONS_KEY = 'tickets.sections'

export function sectionLibrary(raw: unknown): SectionLibrary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SectionLibrary>
  const groups = new Set(SECTION_GROUPS.map((g) => g.id))
  return {
    custom: Array.isArray(r.custom)
      ? r.custom
          .filter((c) => c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.content))
          .map((c) => ({ id: c.id, title: c.title.slice(0, 80), icon: typeof c.icon === 'string' ? c.icon : 'FileText', group: groups.has(c.group) ? c.group : 'other', hint: typeof c.hint === 'string' ? c.hint : '', content: c.content }))
      : [],
    hidden: Array.isArray(r.hidden) ? r.hidden.filter((h): h is string => typeof h === 'string') : []
  }
}

/** A saved section as something + Add can insert */
const fromDef = (d: SectionDef): SectionPreset => ({
  id: d.id,
  title: d.title,
  icon: d.icon,
  group: d.group,
  hint: d.hint || 'Your section',
  keywords: d.title.toLowerCase(),
  content: () => JSON.parse(JSON.stringify(d.content)) as DocJSON[]
})

/** Every section + Add offers: built-in ones (your version where you changed one), then yours; hidden ones left out */
export function allSections(lib: SectionLibrary, includeHidden = false): (SectionPreset & { mine: boolean; changed: boolean; hidden: boolean })[] {
  const byId = new Map(lib.custom.map((d) => [d.id, d]))
  const builtIn = TICKET_SECTIONS.map((s) => {
    const mineVersion = byId.get(s.id)
    return { ...(mineVersion ? { ...fromDef(mineVersion), keywords: s.keywords } : s), mine: false, changed: Boolean(mineVersion), hidden: lib.hidden.includes(s.id) }
  })
  const own = lib.custom.filter((d) => !sectionPreset(d.id)).map((d) => ({ ...fromDef(d), mine: true, changed: false, hidden: lib.hidden.includes(d.id) }))
  return [...builtIn, ...own].filter((s) => includeHidden || !s.hidden)
}

/** One section by id, from your library or the built-in ones */
export function findSection(id: string, lib: SectionLibrary): SectionPreset | undefined {
  return allSections(lib, true).find((s) => s.id === id)
}

/** A section block ready to insert into a ticket */
export function sectionNode(preset: SectionPreset): DocJSON {
  return { type: 'ticketSection', attrs: { preset: preset.id, title: preset.title }, content: preset.content?.() ?? [p()] }
}

/** A preset: a bundle of sections for one kind of job */
export interface TicketPreset {
  id: string
  name: string
  icon: string
  hint: string
  /** Section ids (document sections and parts), in order */
  sections: string[]
  /** Names for the boxes at the top (what the title and the line under it are called) */
  titleLabel?: string
  titlePlaceholder?: string
  summaryLabel?: string
  summaryPlaceholder?: string
  pickupLabel?: string
}

export const TICKET_PRESETS: TicketPreset[] = [
  { id: 'quick', name: 'Quick ticket', icon: 'Zap', hint: 'Just the basics; add sections as you go', sections: [] },
  {
    id: 'shop',
    name: 'Shop repair (drop-off)',
    icon: 'Wrench',
    hint: 'A device left with you to fix',
    sections: ['passcode', 'condition', 'backup', 'diagnosis', 'work', 'parts', 'checklist', 'part:photos', 'part:warranty', 'part:pickup']
  },
  { id: 'remote', name: 'Remote support', icon: 'Monitor', hint: 'Fixed over a remote session or the phone', sections: ['remote', 'work', 'recommendations', 'part:warranty'] },
  { id: 'housecall', name: 'House call', icon: 'Home', hint: 'A visit to their home or business', sections: ['housecall', 'diagnosis', 'work', 'time', 'recommendations'] },
  { id: 'tuneup', name: 'Tune-up & cleanup', icon: 'Zap', hint: 'Slow computer: clean, optimize, update', sections: ['specs', 'backup', 'work', 'software', 'recommendations', 'part:warranty'] },
  { id: 'security', name: 'Virus, scam or hacked email', icon: 'Shield', hint: 'Malware, scams, compromised accounts', sections: ['accounts', 'diagnosis', 'work', 'software', 'recommendations', 'followup'] },
  { id: 'setup', name: 'New computer setup', icon: 'Laptop', hint: 'Set up a new device and move their files', sections: ['device', 'backup', 'accounts', 'software', 'checklist', 'part:pickup'] },
  { id: 'build', name: 'Custom build / parts order', icon: 'Cpu', hint: 'Order parts, build or upgrade', sections: ['specs', 'part:lines', 'parts', 'payment', 'part:pickup'], titlePlaceholder: 'What’s being built or ordered' },
  {
    id: 'delivery',
    name: 'Delivery order',
    icon: 'Truck',
    hint: 'An order delivered to someone',
    sections: ['delivery', 'part:lines', 'payment', 'part:pickup'],
    titleLabel: 'Order',
    titlePlaceholder: 'What they ordered',
    summaryLabel: 'Notes',
    summaryPlaceholder: 'Anything special about it',
    pickupLabel: 'Delivery'
  },
  { id: 'appointment', name: 'Appointment', icon: 'Calendar', hint: 'A booking at a date and time', sections: ['appointment', 'payment', 'followup'] }
]

export const ticketPreset = (id: string): TicketPreset | undefined => TICKET_PRESETS.find((p) => p.id === id)

/** A preset's document: its sections in order (parts aren't text) */
export function presetDoc(preset: TicketPreset): DocJSON {
  const blocks = preset.sections.map(sectionPreset).filter((s): s is SectionPreset => Boolean(s && !s.part)).map(sectionNode)
  return { type: 'doc', content: [...blocks, p()] }
}

/** The built-in parts a preset turns on */
export const presetParts = (preset: TicketPreset): TicketPart[] =>
  preset.sections.map((id) => sectionPreset(id)?.part).filter((x): x is TicketPart => Boolean(x))

/**
 * A reusable copy of ticket content (for your own sections and presets): fill-in answers emptied, checklists
 * unticked, pictures, files and @-links left out, so nothing about one customer ends up in the next ticket.
 */
export function blankCopy(nodes: DocJSON[]): DocJSON[] {
  const drop = new Set(['image', 'fileAttachment', 'mention'])
  const hasField = (n: DocJSON): boolean => n.type === 'formField' || Boolean(n.content?.some(hasField))
  const walk = (n: DocJSON, parent: string): DocJSON | null => {
    if (drop.has(n.type)) return null
    // A line of notes in the ticket or a section is about that customer: emptied (fill-in boxes, headings, checklists stay)
    if (n.type === 'paragraph' && (parent === 'doc' || parent === 'ticketSection') && !hasField(n)) return { type: 'paragraph' }
    const attrs = n.type === 'formField' ? { ...n.attrs, value: '' } : n.type === 'taskItem' ? { ...n.attrs, checked: false } : n.attrs
    const content = n.content?.map((c) => walk(c, n.type)).filter((c): c is DocJSON => c !== null)
    // A block that held only a picture is now empty: keep it valid
    if (content && content.length === 0 && n.type !== 'paragraph' && n.type !== 'heading') return { type: 'paragraph' }
    return { ...n, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
  }
  // Emptied lines in a row become one
  const tidy = (list: DocJSON[]): DocJSON[] =>
    list
      .map((n) => (n.content && n.type !== 'paragraph' ? { ...n, content: tidy(n.content) } : n))
      .filter((n, i, all) => !(n.type === 'paragraph' && !n.content?.length && all[i - 1]?.type === 'paragraph' && !all[i - 1].content?.length))
  return tidy(nodes.map((n) => walk(n, 'doc')).filter((c): c is DocJSON => c !== null))
}

/** Which sections a ticket's document already has (by preset id) */
export function sectionsIn(doc: DocJSON | null | undefined): Set<string> {
  const found = new Set<string>()
  const walk = (n: DocJSON): void => {
    if (n.type === 'ticketSection' && typeof n.attrs?.preset === 'string') found.add(n.attrs.preset)
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return found
}
