import { REPAIR_STATUSES, type CustomerFieldDef, type StatusDef } from './api'
import { noteTemplatesFor, type NoteTemplateDef } from './note-library'
import { presetsFor, sectionsNotFor, type TicketPreset } from './ticket-sections'

/**
 * What people use Plannr for, picked on first launch (2026-11-14: "ask them what they will be using it for and help
 * them customize all the features towards that"; then "it should be marketed towards all users… assume you could be
 * anything"). Each one tailors the menu, what tickets and customers are called, the statuses, which sections + Add
 * shows, the presets and note templates made, customer fields, and suggested folders and lists. Everything stays
 * editable. Pure, so tests check every one.
 */
export interface UseCase {
  id: string
  title: string
  icon: string
  blurb: string
  /** Menu items this use needs (the union over everything picked stays in the menu) */
  menu: string[]
  /** A business: asks for its name and details for printouts, invoices and money */
  business: boolean
  /** What tickets and customers are called in the menu (customers: '' = not used) */
  names?: { tickets: string; customers: string }
  statuses?: StatusDef[]
  /** The preset new tickets start from (an id in TICKET_PRESETS; default: Quick ticket) */
  startPreset?: string
  customerFields?: CustomerFieldDef[]
  /** Folders worth starting with in Notes (offered in the setup) */
  folders?: string[]
  /** Lists worth starting with (offered in the setup) */
  lists?: string[]
}

/** Every menu item that can be shown or hidden */
export const MENU_ITEMS = ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'mail', 'notes', 'lists', 'packages', 'news', 'entertainment', 'assistant', 'vault', 'templates']

const status = (id: string, label: string, color: string, flags: { done?: boolean; ready?: boolean } = {}): StatusDef => ({ id, label, color, done: Boolean(flags.done), ready: Boolean(flags.ready) })

export const USE_CASES: UseCase[] = [
  {
    id: 'personal',
    title: 'Personal & home',
    icon: 'Home',
    blurb: 'To-dos, calendar, notes, lists, habits, bills, home projects and trips',
    business: false,
    menu: ['tasks', 'calendar', 'notes', 'lists', 'money', 'packages', 'vault', 'news', 'entertainment', 'assistant'],
    folders: ['Home', 'Recipes', 'Ideas'],
    lists: ['Groceries', 'To buy']
  },
  {
    id: 'school',
    title: 'School & studying',
    icon: 'GraduationCap',
    blurb: 'Assignments and due dates, tests, class notes and study plans',
    business: false,
    menu: ['tasks', 'calendar', 'tickets', 'notes', 'lists', 'templates', 'assistant'],
    names: { tickets: 'Assignments', customers: '' },
    statuses: [status('todo', 'To do', 'blue'), status('working', 'Working on it', 'purple'), status('review', 'Checking it over', 'yellow'), status('handed_in', 'Handed in', 'green', { done: true })],
    startPreset: 'assignment',
    folders: ['Classes', 'Study guides'],
    lists: ['School supplies']
  },
  {
    id: 'work',
    title: 'Work & projects',
    icon: 'Briefcase',
    blurb: 'Projects, tasks with priorities, issues and meeting notes',
    business: false,
    menu: ['tasks', 'calendar', 'tickets', 'notes', 'lists', 'mail', 'templates', 'assistant'],
    names: { tickets: 'Projects', customers: '' },
    statuses: [status('planned', 'Planned', 'blue'), status('in_progress', 'In progress', 'purple'), status('blocked', 'Blocked', 'red'), status('review', 'In review', 'yellow'), status('done', 'Done', 'gray', { done: true })],
    startPreset: 'project',
    folders: ['Meetings', 'Projects', 'Reference']
  },
  {
    id: 'repair',
    title: 'Repair & tech services',
    icon: 'Wrench',
    blurb: 'Devices in for repair, remote help, house calls, parts and invoices',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'mail', 'notes', 'templates', 'vault', 'assistant'],
    names: { tickets: 'Tickets', customers: 'Customers' },
    statuses: REPAIR_STATUSES,
    startPreset: 'repair-quick',
    folders: ['Repair guides', 'Suppliers']
  },
  {
    id: 'trades',
    title: 'Trades & home services',
    icon: 'Hammer',
    blurb: 'Plumbing, electrical, cleaning, landscaping: site visits, quotes, materials',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Jobs', customers: 'Customers' },
    statuses: [status('requested', 'Quote requested', 'blue'), status('quoted', 'Quoted', 'purple'), status('booked', 'Booked', 'teal'), status('in_progress', 'In progress', 'orange'), status('invoiced', 'Invoiced', 'yellow', { ready: true }), status('paid', 'Paid', 'gray', { done: true })],
    startPreset: 'site-visit',
    customerFields: [{ id: 'f_access', label: 'Access notes', kind: 'long' }],
    folders: ['Job sites', 'Suppliers']
  },
  {
    id: 'design',
    title: 'Design & creative work',
    icon: 'Palette',
    blurb: 'Graphic, web, photo and video projects: briefs, design notes, revisions',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'mail', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Projects', customers: 'Clients' },
    statuses: [status('brief', 'Brief', 'blue'), status('concepts', 'Concepts', 'purple'), status('in_progress', 'In progress', 'orange'), status('review', 'Client review', 'yellow', { ready: true }), status('revisions', 'Revisions', 'pink'), status('delivered', 'Delivered', 'gray', { done: true })],
    startPreset: 'design-project',
    customerFields: [{ id: 'f_brand', label: 'Brand colours & fonts', kind: 'long' }],
    folders: ['Clients', 'Inspiration']
  },
  {
    id: 'art',
    title: 'Art & commissions',
    icon: 'Star',
    blurb: 'Commissions from first message to delivery: brief, sizes, revisions, deposits',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'notes', 'lists', 'templates', 'assistant'],
    names: { tickets: 'Commissions', customers: 'Clients' },
    statuses: [status('inquiry', 'Inquiry', 'blue'), status('sketching', 'Sketching', 'purple'), status('in_progress', 'In progress', 'orange'), status('revisions', 'Revisions', 'yellow'), status('ready', 'Ready to deliver', 'green', { ready: true }), status('delivered', 'Delivered', 'gray', { done: true })],
    startPreset: 'commission',
    customerFields: [
      { id: 'f_handle', label: 'Social handle', kind: 'text' },
      { id: 'f_contact', label: 'Prefers to be contacted by', kind: 'text' }
    ],
    folders: ['Ideas', 'References']
  },
  {
    id: 'shop',
    title: 'Shop & orders',
    icon: 'ShoppingCart',
    blurb: 'A florist, bakery or craft shop: orders, custom orders, delivery, stock',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'inventory', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Orders', customers: 'Customers' },
    statuses: [status('new', 'New order', 'blue'), status('preparing', 'Preparing', 'purple'), status('ready', 'Ready', 'green', { ready: true }), status('out', 'Out for delivery', 'orange'), status('completed', 'Completed', 'gray', { done: true })],
    startPreset: 'order',
    customerFields: [{ id: 'f_usual', label: 'Usual order', kind: 'long' }],
    folders: ['Products', 'Suppliers']
  },
  {
    id: 'bookings',
    title: 'Appointments & bookings',
    icon: 'Calendar',
    blurb: 'Salons, tutoring, coaching, lessons, pet care: bookings, notes, progress',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Bookings', customers: 'Clients' },
    statuses: [status('requested', 'Requested', 'blue'), status('booked', 'Booked', 'teal'), status('done', 'Done', 'green', { ready: true }), status('paid', 'Paid', 'gray', { done: true }), status('cancelled', 'Cancelled', 'red', { done: true })],
    startPreset: 'appointment',
    customerFields: [
      { id: 'f_birthday', label: 'Birthday', kind: 'date' },
      { id: 'f_prefs', label: 'Preferences', kind: 'long' }
    ],
    folders: ['Clients', 'Lesson plans']
  },
  {
    id: 'events',
    title: 'Events & planning',
    icon: 'Gift',
    blurb: 'Weddings, parties and catering: venues, guests, schedules, budgets',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'notes', 'lists', 'templates', 'assistant'],
    names: { tickets: 'Events', customers: 'Clients' },
    statuses: [status('inquiry', 'Inquiry', 'blue'), status('booked', 'Booked', 'teal'), status('planning', 'Planning', 'purple'), status('final', 'Final details', 'yellow', { ready: true }), status('done', 'Done', 'gray', { done: true })],
    startPreset: 'event',
    folders: ['Venues', 'Vendors', 'Ideas']
  },
  {
    id: 'freelance',
    title: 'Freelance & consulting',
    icon: 'Briefcase',
    blurb: 'Client jobs: quotes, scope, time, invoices, follow-ups',
    business: true,
    menu: ['tasks', 'calendar', 'tickets', 'customers', 'money', 'mail', 'notes', 'templates', 'assistant'],
    names: { tickets: 'Jobs', customers: 'Clients' },
    statuses: [status('lead', 'Lead', 'blue'), status('quoted', 'Quoted', 'purple'), status('in_progress', 'In progress', 'orange'), status('waiting', 'Waiting on client', 'yellow', { ready: true }), status('invoiced', 'Invoiced', 'teal'), status('paid', 'Paid', 'gray', { done: true })],
    startPreset: 'job',
    customerFields: [{ id: 'f_billing', label: 'Billing contact', kind: 'text' }],
    folders: ['Clients', 'Proposals']
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

export interface UsePlan {
  menuHidden: string[]
  /** The first picked use that's a business (asks for business details) */
  business: UseCase | undefined
  /** The first picked use that names tickets (decides names, statuses and where new tickets start) */
  primary: UseCase | undefined
  /** Uses tickets at all */
  tickets: boolean
  /** Uses customers at all */
  customers: boolean
  presets: TicketPreset[]
  /** Built-in sections that don't fit (hidden from + Add) */
  hideSections: string[]
  noteTemplates: NoteTemplateDef[]
  customerFields: CustomerFieldDef[]
  folders: string[]
  lists: string[]
}

/** What picking these does, put together */
export function planFor(ids: string[]): UsePlan {
  const picked = ids.map(useCase).filter((u): u is UseCase => Boolean(u))
  const shown = new Set(picked.flatMap((u) => u.menu))
  const uniq = (xs: string[]): string[] => [...new Set(xs)]
  const fields = new Map<string, CustomerFieldDef>()
  for (const f of picked.flatMap((u) => u.customerFields ?? [])) if (!fields.has(f.id)) fields.set(f.id, f)
  return {
    menuHidden: picked.length ? MENU_ITEMS.filter((m) => !shown.has(m)) : [],
    business: picked.find((u) => u.business),
    primary: picked.find((u) => u.names) ?? picked.find((u) => u.business),
    tickets: !picked.length || shown.has('tickets'),
    customers: !picked.length || shown.has('customers'),
    presets: presetsFor(ids),
    hideSections: sectionsNotFor(ids),
    noteTemplates: noteTemplatesFor(ids),
    customerFields: [...fields.values()],
    folders: uniq(picked.flatMap((u) => u.folders ?? [])),
    lists: uniq(picked.flatMap((u) => u.lists ?? []))
  }
}
