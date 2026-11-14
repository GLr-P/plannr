import type { CustomerFieldDef, DocJSON, StatusDef, TicketLayout } from './api'
import { checklist, field, long, type SectionDef } from './ticket-sections'

/**
 * What people use Plannr for, picked on first launch (requested 2026-11-14: "ask them what they will be using it for
 * and help them customize all the features towards that"). Each one tailors the menu, what tickets and customers
 * are called, the statuses, the sections and a starting preset, and customer fields. All of it stays editable.
 * Pure, so tests check every profile.
 */
export interface UseCase {
  id: string
  title: string
  icon: string
  blurb: string
  /** Menu items this use needs (the union over everything picked stays in the menu) */
  menu: string[]
  /** Uses tickets and customers: the business setup applies */
  business: boolean
  /** What tickets and customers are called in the menu */
  names?: { tickets: string; customers: string }
  statuses?: StatusDef[]
  /** Built-in sections that don't fit this work, hidden from + Add (still there to unhide) */
  hideSections?: string[]
  /** Sections made for this work */
  sections?: SectionDef[]
  /** A starting preset (a ticket template), made the default for new tickets */
  preset?: { name: string; icon: string; sections: string[]; layout: Partial<TicketLayout> }
  customerFields?: CustomerFieldDef[]
}

/** Every menu item that can be shown or hidden */
export const MENU_ITEMS = ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'mail', 'notes', 'lists', 'packages', 'news', 'entertainment', 'assistant', 'vault', 'templates']

/** Built-in sections only a computer or phone repair needs */
const TECH_SECTIONS = ['passcode', 'device', 'specs', 'condition', 'backup', 'diagnosis', 'parts', 'checklist', 'software', 'accounts', 'network', 'remote', 'housecall']

const status = (id: string, label: string, color: string, flags: { done?: boolean; ready?: boolean } = {}): StatusDef => ({ id, label, color, done: Boolean(flags.done), ready: Boolean(flags.ready) })
const section = (id: string, title: string, icon: string, hint: string, content: () => DocJSON[], group: SectionDef['group'] = 'other'): SectionDef => ({ id, title, icon, group, hint, content: content() })
const layoutOf = (l: Partial<TicketLayout> & { parts?: TicketLayout['parts'] }): Partial<TicketLayout> => ({
  showPickup: false,
  showLines: false,
  showPhotos: false,
  showEmails: false,
  showWarranty: false,
  ...l
})

export const USE_CASES: UseCase[] = [
  {
    id: 'personal',
    title: 'Personal & home',
    icon: 'Home',
    blurb: 'To-dos, your calendar, notes, lists and habits, bills, packages',
    business: false,
    menu: ['tasks', 'calendar', 'notes', 'lists', 'money', 'packages', 'vault', 'news', 'entertainment', 'assistant']
  },
  {
    id: 'school',
    title: 'School & studying',
    icon: 'GraduationCap',
    blurb: 'Assignments and due dates, class notes, study lists',
    business: false,
    menu: ['tasks', 'calendar', 'notes', 'lists', 'templates', 'assistant']
  },
  {
    id: 'repair',
    title: 'Repair & tech services',
    icon: 'Wrench',
    blurb: 'Devices in for repair, remote help, house calls, parts and invoices',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'mail', 'notes', 'templates', 'vault', 'assistant']
  },
  {
    id: 'art',
    title: 'Art & commissions',
    icon: 'Star',
    blurb: 'Commissions from first message to delivery: brief, sizes, revisions, deposits',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'notes', 'lists', 'templates', 'assistant'],
    names: { tickets: 'Commissions', customers: 'Clients' },
    statuses: [
      status('inquiry', 'Inquiry', 'blue'),
      status('sketching', 'Sketching', 'purple'),
      status('in_progress', 'In progress', 'orange'),
      status('revisions', 'Revisions', 'yellow'),
      status('ready', 'Ready to deliver', 'green', { ready: true }),
      status('delivered', 'Delivered', 'gray', { done: true })
    ],
    hideSections: TECH_SECTIONS,
    sections: [
      section('art:brief', 'Brief', 'Lightbulb', 'What they want, the style, references', () => [long('What they want'), field('Style', 'text', { placeholder: 'e.g. watercolour, loose, warm colours' }), long('References', 'Links or notes about reference photos', 2)], 'work'),
      section('art:size', 'Size & medium', 'Tag', 'Size, medium and framing', () => [field('Size', 'text', { placeholder: 'e.g. 12 × 16 in' }), field('Medium', 'select', { options: ['Digital', 'Acrylic', 'Oil', 'Watercolour', 'Pencil', 'Mixed', 'Other'] }), field('Framing', 'select', { options: ['None', 'Framed', 'Mat only', 'Canvas wrap'] })], 'work'),
      section('art:revisions', 'Revisions', 'ListChecks', 'How many are included, and what changed', () => [field('Revisions included', 'number'), long('Revision notes', undefined, 3)], 'work'),
      section('art:usage', 'Usage & rights', 'Shield', 'Personal or commercial use, credit', () => [field('Use', 'select', { options: ['Personal', 'Commercial', 'Print run'] }), field('Credit or tag', 'text')], 'other')
    ],
    preset: {
      name: 'Commission',
      icon: 'Star',
      sections: ['art:brief', 'art:size', 'art:revisions', 'payment', 'part:photos', 'part:pickup'],
      layout: layoutOf({ titleLabel: 'Piece', titlePlaceholder: 'What is it? (e.g. Pet portrait, 12 × 16)', summaryLabel: 'Notes', summaryPlaceholder: 'Anything to remember about it', pickupLabel: 'Due', receivedLabel: 'Started', parts: ['photos', 'pickup'] })
    },
    customerFields: [
      { id: 'f_handle', label: 'Social handle', kind: 'text' },
      { id: 'f_contact', label: 'Prefers to be contacted by', kind: 'text' }
    ]
  },
  {
    id: 'shop',
    title: 'Shop & orders',
    icon: 'ShoppingCart',
    blurb: 'Orders for a florist, bakery or craft shop: items, delivery, payment',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Orders', customers: 'Customers' },
    statuses: [
      status('new', 'New order', 'blue'),
      status('preparing', 'Preparing', 'purple'),
      status('ready', 'Ready', 'green', { ready: true }),
      status('out', 'Out for delivery', 'orange'),
      status('completed', 'Completed', 'gray', { done: true })
    ],
    hideSections: TECH_SECTIONS,
    sections: [
      section('shop:items', 'What’s in it', 'Package', 'Items, colours and anything special', () => [long('Items'), field('Colours or style', 'text'), long('Special requests', undefined, 2)], 'order')
    ],
    preset: {
      name: 'Order',
      icon: 'ShoppingCart',
      sections: ['shop:items', 'delivery', 'payment', 'part:lines', 'part:pickup'],
      layout: layoutOf({ titleLabel: 'Order', titlePlaceholder: 'What they ordered', summaryLabel: 'Notes', summaryPlaceholder: 'Occasion or anything to remember', pickupLabel: 'Due', parts: ['lines', 'pickup'] })
    },
    customerFields: [{ id: 'f_usual', label: 'Usual order', kind: 'long' }]
  },
  {
    id: 'freelance',
    title: 'Freelance & services',
    icon: 'Briefcase',
    blurb: 'Client jobs and projects: quotes, time, invoices, follow-ups',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'mail', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Jobs', customers: 'Clients' },
    statuses: [
      status('lead', 'Lead', 'blue'),
      status('quoted', 'Quoted', 'purple'),
      status('in_progress', 'In progress', 'orange'),
      status('waiting', 'Waiting on client', 'yellow', { ready: true }),
      status('invoiced', 'Invoiced', 'teal'),
      status('paid', 'Paid', 'gray', { done: true })
    ],
    hideSections: TECH_SECTIONS.filter((s) => s !== 'checklist'),
    sections: [
      section('job:scope', 'Scope', 'ClipboardList', 'What’s included and what isn’t', () => [long('Included'), long('Not included', undefined, 2)], 'work'),
      section('job:milestones', 'Milestones', 'ListChecks', 'Steps to tick off', () => [checklist(['Kickoff', 'First draft', 'Feedback', 'Final delivery'])], 'work')
    ],
    preset: {
      name: 'Job',
      icon: 'Briefcase',
      sections: ['job:scope', 'job:milestones', 'approval', 'time', 'followup', 'part:lines', 'part:pickup'],
      layout: layoutOf({ titleLabel: 'Job', titlePlaceholder: 'What’s the job?', summaryLabel: 'Notes', summaryPlaceholder: 'The short version', pickupLabel: 'Due', parts: ['lines', 'pickup'] })
    },
    customerFields: [{ id: 'f_billing', label: 'Billing contact', kind: 'text' }]
  },
  {
    id: 'other',
    title: 'Something else',
    icon: 'Sparkles',
    blurb: 'Keep everything on and shape it yourself',
    business: true,
    menu: MENU_ITEMS
  }
]

export const useCase = (id: string): UseCase | undefined => USE_CASES.find((u) => u.id === id)

/** What picking these does, put together: the first business use decides names, statuses and the preset */
export function planFor(ids: string[]): {
  menuHidden: string[]
  business: UseCase | undefined
  sections: SectionDef[]
  hideSections: string[]
  customerFields: CustomerFieldDef[]
} {
  const picked = ids.map(useCase).filter((u): u is UseCase => Boolean(u))
  const shown = new Set(picked.flatMap((u) => u.menu))
  const business = picked.find((u) => u.business)
  return {
    menuHidden: picked.length ? MENU_ITEMS.filter((m) => !shown.has(m)) : [],
    business,
    sections: business?.sections ?? [],
    hideSections: business?.hideSections ?? [],
    customerFields: picked.flatMap((u) => u.customerFields ?? [])
  }
}

