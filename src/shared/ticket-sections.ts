import type { DocJSON, TicketLayout, TicketPart } from './api'

/**
 * Ticket sections and presets. A new ticket holds the minimum (who it's for, its name, details, dates, price);
 * everything else is added when it's needed:
 * - a **section** is a block of fill-in fields, text or a checklist (`ticketSection` node, attrs `preset` and `title`),
 *   or one of the ticket page's built-in **parts** (due date, photos, quote lines, warranty, emails);
 * - a **preset** is a bundle of sections for one kind of work (a design project, an assignment, a shop repair…).
 * Sections and presets carry the uses they're made for (`uses`, ids from use-cases.ts); untagged ones fit anyone.
 * The setup hides sections that don't fit what you picked (all of them stay one click away). Pure, so the phone and
 * tests use it.
 */

export type SectionGroup = 'plan' | 'creative' | 'people' | 'school' | 'device' | 'work' | 'visit' | 'order' | 'other'

export const SECTION_GROUPS: { id: SectionGroup; label: string }[] = [
  { id: 'plan', label: 'Planning' },
  { id: 'work', label: 'Work' },
  { id: 'creative', label: 'Creative' },
  { id: 'people', label: 'People & places' },
  { id: 'order', label: 'Orders & money' },
  { id: 'visit', label: 'Visits & time' },
  { id: 'school', label: 'School' },
  { id: 'device', label: 'Repair & devices' },
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
  /** The uses it's made for (use-cases.ts ids); none = everyone */
  uses?: string[]
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

const sec = (id: string, title: string, icon: string, group: SectionGroup, hint: string, keywords: string, content: () => DocJSON[], uses?: string[]): SectionPreset => ({
  id,
  title,
  icon,
  group,
  hint,
  keywords: `${title.toLowerCase()} ${keywords}`,
  ...(uses ? { uses } : {}),
  content
})
const part = (id: TicketPart, title: string, icon: string, group: SectionGroup, hint: string, keywords: string, uses?: string[]): SectionPreset => ({
  id: `part:${id}`,
  title,
  icon,
  group,
  hint,
  keywords: `${title.toLowerCase()} ${keywords}`,
  ...(uses ? { uses } : {}),
  part: id
})

const REPAIR = ['repair']
const CREATIVE = ['design', 'art']

export const TICKET_SECTIONS: SectionPreset[] = [
  // Planning (anyone)
  sec('brief', 'Brief', 'Lightbulb', 'plan', 'The goal, who it’s for, and anything to know', 'goal purpose audience overview summary', () => [long('Goal', 'What it should do or be', 2), field('For', 'text', { placeholder: 'Who it’s for' }), long('Notes', undefined, 2)]),
  sec('requirements', 'Requirements', 'ListChecks', 'plan', 'What it has to have, ticked off as you go', 'must have needs criteria rubric list', () => [checklist(['', '', ''])]),
  sec('scope', 'Scope', 'ClipboardList', 'plan', 'What’s included and what isn’t', 'included excluded not included agreement', () => [long('Included'), long('Not included', undefined, 2)], ['freelance', 'trades', 'design', 'work', 'events']),
  sec('milestones', 'Milestones', 'Flag', 'plan', 'Steps to tick off on the way', 'steps stages phases progress plan', () => [checklist(['Start', 'First draft', 'Feedback', 'Finished'])]),
  sec('deliverables', 'Deliverables', 'Package', 'plan', 'What you hand over at the end', 'deliver hand over final files outputs', () => [checklist(['', ''])], ['design', 'art', 'freelance', 'work']),
  sec('priority', 'Priority', 'Zap', 'plan', 'How urgent it is', 'urgent important priority level', () => [field('Priority', 'select', { options: ['Low', 'Normal', 'High', 'Urgent'] })]),
  sec('schedule', 'Schedule', 'CalendarDays', 'plan', 'Start and end dates, hours planned', 'dates start end timeline hours plan', () => [field('Starts', 'date'), field('Ends', 'date'), field('Hours planned', 'number')]),
  sec('budget', 'Budget', 'DollarSign', 'plan', 'Budget, spent so far and what’s left, worked out for you', 'budget cost spent remaining money', () => [field('Budget', 'money'), field('Spent', 'money'), field('Left', 'calc', { formula: '{Budget} - {Spent}' })]),
  sec('files', 'Files & links', 'Paperclip', 'plan', 'Where the files, drafts and shared folders are', 'files links folder drive dropbox drafts', () => [long('Links', 'Shared folder, drafts, final files', 2)]),
  // Creative
  sec('design-notes', 'Design notes', 'Palette', 'creative', 'Colours, fonts, style and anything to keep in mind', 'design colours colors fonts typography style look feel brand', () => [field('Colours', 'text', { placeholder: 'e.g. navy, warm white, gold' }), field('Fonts', 'text'), field('Style', 'text', { placeholder: 'e.g. clean and modern, hand-drawn' }), long('Notes', undefined, 3)], [...CREATIVE, 'shop', 'events', 'freelance']),
  sec('references', 'References & inspiration', 'Image', 'creative', 'Links and notes about what they like', 'references inspiration mood board examples likes', () => [long('References', 'Links, examples, what they like and don’t', 3)], [...CREATIVE, 'events']),
  sec('revisions', 'Revisions', 'RefreshCw', 'creative', 'How many are included, and what changed', 'revisions changes rounds edits versions', () => [field('Revisions included', 'number'), long('Revision notes', undefined, 3)], [...CREATIVE, 'freelance']),
  sec('feedback', 'Feedback', 'MessageSquare', 'creative', 'What they said, and when', 'feedback comments review notes client', () => [field('Feedback on', 'date'), long('Feedback', undefined, 3)], [...CREATIVE, 'freelance', 'work', 'school']),
  sec('size', 'Size & medium', 'Ruler', 'creative', 'Size, medium and framing', 'size medium canvas framing dimensions', () => [field('Size', 'text', { placeholder: 'e.g. 12 × 16 in' }), field('Medium', 'select', { options: ['Digital', 'Acrylic', 'Oil', 'Watercolour', 'Pencil', 'Mixed', 'Other'] }), field('Framing', 'select', { options: ['None', 'Framed', 'Mat only', 'Canvas wrap'] })], ['art']),
  sec('usage', 'Usage & rights', 'Shield', 'creative', 'Personal or commercial use, credit', 'usage rights licence license commercial credit', () => [field('Use', 'select', { options: ['Personal', 'Commercial', 'Print run'] }), field('Credit or tag', 'text')], CREATIVE),
  sec('shoot', 'Shoot details', 'Camera', 'creative', 'Where and when, and the shot list', 'photo video shoot location shot list', () => [field('Location', 'text'), field('Date', 'date'), field('Time', 'time'), long('Shot list', undefined, 3)], ['design', 'events']),
  // People & places
  sec('contacts', 'Contacts', 'Users', 'people', 'Other people involved and how to reach them', 'contacts people phone email team', () => [field('Name', 'text'), field('Phone', 'phone'), field('Role', 'text', { placeholder: 'e.g. Site manager, Teacher, Venue' })]),
  sec('location', 'Location', 'MapPin', 'people', 'The address and how to get in', 'location address where directions place access', () => [field('Address', 'text', { link: 'customer.address' }), long('Directions or access', 'Gate code, parking, which door', 2)]),
  sec('property', 'Property', 'Home', 'people', 'Address, type of place and access notes', 'property house home site address access', () => [field('Address', 'text', { link: 'customer.address' }), field('Type', 'select', { options: ['House', 'Apartment', 'Business', 'Land', 'Other'] }), long('Access notes', 'Gate code, pets, parking', 2)], ['trades', 'repair']),
  sec('measurements', 'Measurements', 'Ruler', 'people', 'Sizes and quantities', 'measurements size width height length area dimensions', () => [field('Width', 'text'), field('Height', 'text'), field('Length or depth', 'text'), long('Notes', undefined, 2)], ['trades', 'art', 'shop', 'design']),
  sec('materials', 'Materials', 'Hammer', 'people', 'What’s needed and what it costs', 'materials supplies cost lumber paint fabric', () => [long('Materials', undefined, 3), field('Materials cost', 'money')], ['trades', 'art', 'shop', 'personal']),
  sec('vehicle', 'Vehicle', 'Truck', 'people', 'Make, model, year, plate and mileage', 'vehicle car truck auto make model vin plate mileage', () => [field('Make & model', 'text'), field('Year', 'number'), field('Plate or VIN', 'text'), field('Mileage', 'text')], ['repair', 'trades']),
  sec('pet', 'Pet', 'Heart', 'people', 'Name, breed, age and notes', 'pet dog cat animal grooming vet breed', () => [field('Pet’s name', 'text'), field('Breed', 'text'), field('Age', 'text'), long('Notes', 'Allergies, temperament', 2)], ['bookings']),
  sec('session', 'Session notes', 'FileText', 'people', 'What you covered and what’s next', 'session lesson class coaching tutoring notes', () => [field('Date', 'date'), long('What we covered', undefined, 3), long('For next time', undefined, 2)], ['bookings', 'school']),
  sec('goals', 'Goals & progress', 'Target', 'people', 'What they’re working toward, and how it’s going', 'goals progress coaching tutoring training', () => [long('Goals', undefined, 2), long('Progress', undefined, 3)], ['bookings', 'personal']),
  sec('venue', 'Venue', 'Building2', 'people', 'Where it’s held and who to talk to', 'venue hall location event place', () => [field('Venue', 'text'), field('Address', 'text'), field('Venue contact', 'text')], ['events']),
  sec('guests', 'Guests', 'Users', 'people', 'How many, and dietary or seating notes', 'guests attendees rsvp seating dietary headcount', () => [field('Guests', 'number'), long('Guest notes', 'Dietary needs, seating, RSVPs', 2)], ['events']),
  sec('menu', 'Menu & catering', 'Utensils', 'people', 'What’s being served', 'menu food catering drinks', () => [long('Menu', undefined, 3), field('Servings', 'number')], ['events', 'shop']),
  // School
  sec('assignment', 'Assignment details', 'GraduationCap', 'school', 'Class, teacher, what it’s worth and how to hand it in', 'assignment homework class course teacher worth grade', () => [field('Class', 'text'), field('Teacher', 'text'), field('Worth (% of grade)', 'number'), field('Hand in', 'select', { options: ['Online', 'In class', 'Email', 'Other'] })], ['school']),
  sec('study', 'Study plan', 'BookOpen', 'school', 'Steps to get ready, ticked off as you go', 'study plan review practice exam test prepare', () => [checklist(['Read the material', 'Make notes', 'Practice questions', 'Review'])], ['school']),
  sec('sources', 'Sources', 'Book', 'school', 'Books, articles and links you used', 'sources references citations bibliography research', () => [long('Sources', 'Books, articles, links', 3)], ['school', 'work']),
  sec('grade', 'Grade', 'Star', 'school', 'The mark and the feedback', 'grade mark score result feedback', () => [field('Mark', 'text'), long('Feedback', undefined, 2)], ['school']),
  sec('group', 'Group members', 'Users', 'school', 'Who’s in the group and who does what', 'group team members partners roles', () => [long('Members and what they do', undefined, 3)], ['school', 'work']),
  // Work
  sec('work', 'Work done', 'CheckSquare', 'work', 'What was done', 'work done performed fixed steps completed', () => [long('Work done')]),
  sec('issue', 'Issue details', 'AlertTriangle', 'work', 'What happens, what should happen, how bad it is', 'bug issue problem steps reproduce expected actual severity', () => [long('What happens', undefined, 2), long('What should happen', undefined, 2), field('How bad', 'select', { options: ['Minor', 'Annoying', 'Serious', 'Blocking'] })], ['work']),
  sec('meeting', 'Meeting', 'Users', 'work', 'When, who was there, what was decided', 'meeting attendees agenda decisions minutes', () => [field('Date', 'date'), field('Who', 'text'), long('Decisions', undefined, 3)], ['work', 'freelance']),
  sec('recommendations', 'Recommendations', 'Lightbulb', 'work', 'What they should do next', 'recommendations advice next steps suggest upgrade', () => [long('Recommendations', 'Next steps, things to watch for', 2)]),
  // Visits & time
  sec('appointment', 'Event or appointment', 'Calendar', 'visit', 'Date, time and place', 'event appointment booking date time place location meeting', () => [field('Date', 'date'), field('Time', 'time'), field('Place', 'text')]),
  sec('time', 'Time spent', 'Clock', 'visit', 'Hours and rate, worked out for you', 'time spent hours labour labor rate billing', () => [field('Hours', 'number'), field('Hourly rate', 'money'), field('Labour', 'calc', { formula: '{Hours} * {Hourly rate}' })]),
  sec('housecall', 'House call', 'Home', 'visit', 'Where and when you visit', 'house call on site visit home address appointment travel', () => [field('Address', 'text', { link: 'customer.address' }), field('Visit date', 'date'), field('Arrival time', 'time'), field('Travel', 'text', { placeholder: 'Distance or travel time' })], ['repair', 'trades']),
  sec('remote', 'Remote session', 'Monitor', 'visit', 'Remote tool, session ID, time connected', 'remote support session rustdesk teamviewer anydesk quick assist phone call online', () => [field('Connected with', 'select', { options: ['Phone call', 'RustDesk', 'Quick Assist', 'TeamViewer', 'AnyDesk', 'Other'] }), field('Session ID', 'text'), field('Time connected', 'text', { placeholder: 'e.g. 45 min' })], REPAIR),
  // Orders & money
  sec('items', 'What’s in it', 'ShoppingCart', 'order', 'Items, colours and anything special', 'items order contents products colours special requests', () => [long('Items'), field('Colours or style', 'text'), long('Special requests', undefined, 2)], ['shop', 'events']),
  sec('delivery', 'Delivery', 'Truck', 'order', 'Recipient, address, phone and card message', 'delivery deliver recipient address card message ship order', () => [field('Recipient', 'text'), field('Delivery address', 'text'), field('Recipient phone', 'phone'), long('Card message', undefined, 2)], ['shop', 'events', 'art']),
  sec('payment', 'Payment notes', 'DollarSign', 'order', 'Deposit, how they’re paying', 'payment deposit paid method cash card e-transfer invoice', () => [field('Deposit', 'money'), field('Paying by', 'select', { options: ['Cash', 'Card', 'E-transfer', 'Cheque', 'Invoice'] })]),
  sec('approval', 'Approval', 'ThumbsUp', 'order', 'Who approved it, when and for how much', 'approval approved quote agreed consent go ahead sign off', () => [field('Approved', 'select', { options: ['Waiting', 'Approved', 'Declined'] }), field('Approved on', 'date'), field('Approved amount', 'money')]),
  // Repair & devices
  sec('passcode', 'Passcode & logins', 'Key', 'device', 'Device passcode, PIN or pattern, account logins', 'password pin pattern login account apple id microsoft unlock', () => [field('Passcode / PIN', 'text', { placeholder: 'Left off printouts' }), field('Account login', 'text', { placeholder: 'Apple ID, Microsoft or Google account' })], REPAIR),
  sec('device', 'Device details', 'Laptop', 'device', 'Make and model, serial number, operating system', 'device make model serial number os operating system brand year', () => [field('Make & model', 'text'), field('Serial number', 'text'), field('Operating system', 'text', { placeholder: 'Windows 11, macOS 15…' })], REPAIR),
  sec('specs', 'Specs', 'Cpu', 'device', 'Processor, memory, storage, graphics', 'specifications cpu processor ram memory storage ssd hdd drive gpu graphics', () => [field('Processor', 'text'), field('Memory (RAM)', 'text'), field('Storage', 'text', { placeholder: 'e.g. 512 GB SSD, 2 TB HDD' }), field('Graphics', 'text')], REPAIR),
  sec('condition', 'Condition & accessories', 'ClipboardList', 'device', 'How it came in and what was left with it', 'condition arrival damage scratches accessories charger cable case left', () => [long('Condition on arrival', 'Scratches, cracks, what works and what doesn’t', 2), field('Accessories left', 'text', { placeholder: 'Charger, case, cables…' })], ['repair', 'trades']),
  sec('backup', 'Data backup', 'HardDrive', 'device', 'Whether their files need saving first, and where they went', 'data backup files photos save transfer', () => [field('Data backup', 'select', { options: ['Not needed', 'Needed', 'Done', 'Customer declined'] }), field('Backed up to', 'text')], REPAIR),
  sec('diagnosis', 'Diagnosis', 'Search', 'device', 'What you found', 'diagnose found findings cause problem test inspection', () => [long('What I found')], ['repair', 'trades']),
  sec('parts', 'Parts used', 'Package', 'device', 'Parts that went in (for prices, add Quote lines)', 'parts used replaced components installed', () => [long('Parts used', 'e.g. 1 TB SSD, battery', 2)], ['repair', 'trades']),
  sec('checklist', 'Repair checklist', 'ListChecks', 'device', 'Diagnosed, approved, repaired, tested, customer told', 'steps progress diagnosed approved repaired tested notified', () => [checklist(['Diagnosed', 'Customer approved quote', 'Repaired', 'Tested', 'Customer notified'])], REPAIR),
  sec('software', 'Software installed', 'Code', 'device', 'Programs installed, removed or updated', 'programs installed removed updated apps antivirus drivers windows updates', () => [long('Installed or updated', undefined, 2), long('Removed', undefined, 2)], REPAIR),
  sec('accounts', 'Accounts & email', 'Mail', 'device', 'Email, accounts and passwords changed, two-step sign-in', 'email outlook gmail password reset security two step 2fa recovery compromised hacked', () => [field('Email provider', 'text', { placeholder: 'Outlook, Gmail, Telus…' }), long('Accounts changed', 'Password resets, sessions signed out', 2), field('Two-step sign-in', 'select', { options: ['Not set up', 'Set up', 'Already on', 'Customer declined'] })], REPAIR),
  sec('network', 'Network & Wi-Fi', 'Wifi', 'device', 'Internet provider, router, network name', 'wifi wi-fi internet router modem isp provider', () => [field('Internet provider', 'text'), field('Router / modem', 'text'), field('Network name', 'text')], REPAIR),
  // Other
  sec('followup', 'Follow-up', 'Bell', 'other', 'When to check in and what about', 'follow up check in call back reminder later', () => [field('Follow up on', 'date'), field('About', 'text')]),
  sec('internal', 'Private notes', 'Lock', 'other', 'Notes just for you', 'internal private notes memo', () => [p()]),
  sec('notes', 'Notes', 'FileText', 'other', 'A blank section to write anything', 'text blank custom anything', () => [p()]),
  // Built-in parts of the ticket page
  part('pickup', 'Due date', 'CalendarCheck', 'plan', 'A date that goes on the calendar (due, pickup, delivery…)', 'pickup due date delivery calendar deadline'),
  part('photos', 'Photos', 'Camera', 'other', 'Pictures, before and after', 'pictures images before after camera'),
  part('lines', 'Quote lines', 'Receipt', 'order', 'Items, hours and discounts that add up to the price', 'quote invoice lines items parts labour price estimate'),
  part('warranty', 'Warranty', 'ShieldCheck', 'work', 'How long the work is covered', 'guarantee covered days', ['repair', 'trades']),
  part('emails', 'Emails', 'Mail', 'other', 'Emails with this customer', 'mail messages inbox')
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

/** A preset: a bundle of sections for one kind of work */
export interface TicketPreset {
  id: string
  name: string
  icon: string
  hint: string
  /** The uses it's made for (use-cases.ts ids); none = everyone (made on every install) */
  uses?: string[]
  /** Section ids (document sections and parts), in order */
  sections: string[]
  /** Names for the boxes at the top (what the title and the line under it are called) */
  titleLabel?: string
  titlePlaceholder?: string
  summaryLabel?: string
  summaryPlaceholder?: string
  pickupLabel?: string
  /** Anything else about the top of the ticket (e.g. no customer or price for school work) */
  layout?: Partial<TicketLayout>
}

/** Repair wording for the top boxes */
const REPAIR_BOXES = { titleLabel: 'Device', titlePlaceholder: 'e.g. Dell laptop, iPhone 13', summaryLabel: 'What they need', summaryPlaceholder: 'What’s wrong, or what they’re asking for', pickupLabel: 'Pickup', layout: { receivedLabel: 'Received' } }
/** Your own work (school, projects at work, at home): no customer or price at the top */
const OWN_WORK: Partial<TicketLayout> = { showCustomer: false, showPrice: false, showFor: false, showReceived: false }

export const TICKET_PRESETS: TicketPreset[] = [
  // Everyone
  { id: 'quick', name: 'Quick ticket', icon: 'Zap', hint: 'Just the basics; add sections as you go', sections: [] },
  { id: 'project', name: 'Project', icon: 'Briefcase', hint: 'A goal, steps to get there and a due date', sections: ['brief', 'milestones', 'files', 'part:pickup'], titleLabel: 'Project', titlePlaceholder: 'Name the project' },
  { id: 'request', name: 'Request', icon: 'ClipboardList', hint: 'Something someone asked for', sections: ['requirements', 'notes', 'part:pickup'], titleLabel: 'Request', titlePlaceholder: 'What’s being asked for?' },
  { id: 'appointment', name: 'Appointment', icon: 'Calendar', hint: 'A booking at a date and time', sections: ['appointment', 'payment', 'followup'], titleLabel: 'Appointment', titlePlaceholder: 'What it’s for', pickupLabel: 'Date' },
  // Personal & home
  { id: 'home-project', name: 'Home project', icon: 'Home', uses: ['personal'], hint: 'Renovations, repairs and projects around the house', sections: ['budget', 'materials', 'contacts', 'milestones', 'part:photos', 'part:pickup'], titleLabel: 'Project', titlePlaceholder: 'e.g. Paint the bedroom', layout: OWN_WORK },
  { id: 'goal', name: 'Goal', icon: 'Flag', uses: ['personal', 'school', 'work'], hint: 'Something you want to get done, step by step', sections: ['goals', 'milestones', 'part:pickup'], titleLabel: 'Goal', titlePlaceholder: 'e.g. Run a 10K', pickupLabel: 'By', layout: OWN_WORK },
  { id: 'trip', name: 'Trip', icon: 'MapPin', uses: ['personal'], hint: 'Where, when, the budget and what to bring', sections: ['schedule', 'location', 'budget', 'requirements', 'files'], titleLabel: 'Trip', titlePlaceholder: 'e.g. Weekend in Victoria', layout: OWN_WORK },
  // School
  { id: 'assignment', name: 'Assignment', icon: 'GraduationCap', uses: ['school'], hint: 'Homework, essays and projects with a due date', sections: ['assignment', 'requirements', 'sources', 'part:pickup'], titleLabel: 'Assignment', titlePlaceholder: 'e.g. History essay', summaryPlaceholder: 'What you have to do', pickupLabel: 'Due', layout: OWN_WORK },
  { id: 'group-project', name: 'Group project', icon: 'Users', uses: ['school'], hint: 'Who does what, and the steps to finish', sections: ['assignment', 'group', 'milestones', 'files', 'part:pickup'], titleLabel: 'Project', titlePlaceholder: 'e.g. Science fair', pickupLabel: 'Due', layout: OWN_WORK },
  { id: 'exam', name: 'Test or exam', icon: 'BookOpen', uses: ['school'], hint: 'What’s on it, a study plan and the result', sections: ['study', 'notes', 'grade', 'part:pickup'], titleLabel: 'Test', titlePlaceholder: 'e.g. Math midterm', summaryLabel: 'What’s on it', summaryPlaceholder: 'Chapters or topics', pickupLabel: 'Test date', layout: OWN_WORK },
  // Work & projects
  { id: 'work-task', name: 'Work task', icon: 'CheckSquare', uses: ['work'], hint: 'A piece of work with a priority and a due date', sections: ['priority', 'requirements', 'notes', 'part:pickup'], titleLabel: 'Task', titlePlaceholder: 'What needs doing?', layout: OWN_WORK },
  { id: 'issue', name: 'Bug or issue', icon: 'AlertTriangle', uses: ['work'], hint: 'Something broken: what happens and how bad it is', sections: ['issue', 'priority', 'part:photos'], titleLabel: 'Issue', titlePlaceholder: 'Short description of the problem', layout: OWN_WORK },
  { id: 'meeting', name: 'Meeting', icon: 'Users', uses: ['work', 'freelance'], hint: 'Who, when, and what was decided', sections: ['meeting', 'followup'], titleLabel: 'Meeting', titlePlaceholder: 'What it’s about', pickupLabel: 'Date', layout: OWN_WORK },
  // Repair & tech
  { id: 'repair-quick', name: 'Quick repair', icon: 'Wrench', uses: ['repair'], hint: 'Just the device and what’s wrong; add sections as you go', sections: [], ...REPAIR_BOXES },
  { id: 'shop', name: 'Shop repair (drop-off)', icon: 'Wrench', uses: ['repair'], hint: 'A device left with you to fix', sections: ['passcode', 'condition', 'backup', 'diagnosis', 'work', 'parts', 'checklist', 'part:photos', 'part:warranty', 'part:pickup'], ...REPAIR_BOXES },
  { id: 'remote', name: 'Remote support', icon: 'Monitor', uses: ['repair'], hint: 'Fixed over a remote session or the phone', sections: ['remote', 'work', 'recommendations', 'part:warranty'], ...REPAIR_BOXES },
  { id: 'housecall', name: 'House call', icon: 'Home', uses: ['repair'], hint: 'A visit to their home or business', sections: ['housecall', 'diagnosis', 'work', 'time', 'recommendations'], ...REPAIR_BOXES },
  { id: 'tuneup', name: 'Tune-up & cleanup', icon: 'Zap', uses: ['repair'], hint: 'Slow computer: clean, optimize, update', sections: ['specs', 'backup', 'work', 'software', 'recommendations', 'part:warranty'], ...REPAIR_BOXES },
  { id: 'security', name: 'Virus, scam or hacked email', icon: 'Shield', uses: ['repair'], hint: 'Malware, scams, compromised accounts', sections: ['accounts', 'diagnosis', 'work', 'software', 'recommendations', 'followup'], ...REPAIR_BOXES },
  { id: 'setup', name: 'New computer setup', icon: 'Laptop', uses: ['repair'], hint: 'Set up a new device and move their files', sections: ['device', 'backup', 'accounts', 'software', 'checklist', 'part:pickup'], ...REPAIR_BOXES },
  { id: 'build', name: 'Custom build / parts order', icon: 'Cpu', uses: ['repair'], hint: 'Order parts, build or upgrade', sections: ['specs', 'part:lines', 'parts', 'payment', 'part:pickup'], ...REPAIR_BOXES, titleLabel: 'Build', titlePlaceholder: 'What’s being built or ordered' },
  // Trades & home services
  { id: 'site-visit', name: 'Site visit & quote', icon: 'MapPin', uses: ['trades'], hint: 'Look at the job, measure, and quote it', sections: ['property', 'measurements', 'part:photos', 'part:lines', 'approval'], titleLabel: 'Job', titlePlaceholder: 'e.g. Bathroom tiles, fence repair', summaryLabel: 'What they want', pickupLabel: 'Visit' },
  { id: 'service-job', name: 'Service job', icon: 'Hammer', uses: ['trades'], hint: 'The work itself: materials, time, photos and the bill', sections: ['property', 'scope', 'materials', 'time', 'part:photos', 'part:lines', 'part:warranty', 'part:pickup'], titleLabel: 'Job', titlePlaceholder: 'e.g. Replace water heater', summaryLabel: 'What they need', pickupLabel: 'Booked for' },
  { id: 'maintenance', name: 'Maintenance visit', icon: 'Clock', uses: ['trades'], hint: 'Regular upkeep and what to watch for', sections: ['property', 'work', 'recommendations', 'followup'], titleLabel: 'Visit', titlePlaceholder: 'e.g. Spring furnace check', pickupLabel: 'Visit' },
  // Design & creative
  { id: 'design-project', name: 'Design project', icon: 'Palette', uses: ['design'], hint: 'Brief, design notes, revisions, feedback and files', sections: ['brief', 'design-notes', 'references', 'revisions', 'feedback', 'files', 'deliverables', 'part:pickup'], titleLabel: 'Project', titlePlaceholder: 'e.g. Spring menu redesign', summaryLabel: 'What they want', pickupLabel: 'Due' },
  { id: 'branding', name: 'Logo & branding', icon: 'Star', uses: ['design'], hint: 'A logo, colours and fonts for a brand', sections: ['brief', 'design-notes', 'references', 'revisions', 'deliverables', 'usage', 'part:pickup'], titleLabel: 'Brand', titlePlaceholder: 'Whose brand is it?', pickupLabel: 'Due' },
  { id: 'website', name: 'Website', icon: 'Monitor', uses: ['design', 'freelance'], hint: 'Pages, design notes, milestones and the quote', sections: ['requirements', 'design-notes', 'milestones', 'files', 'part:lines', 'part:pickup'], titleLabel: 'Website', titlePlaceholder: 'e.g. Bakery website', pickupLabel: 'Launch' },
  { id: 'shoot', name: 'Photo or video shoot', icon: 'Camera', uses: ['design', 'events'], hint: 'Where and when, the shot list, what you deliver', sections: ['shoot', 'deliverables', 'part:photos', 'payment'], titleLabel: 'Shoot', titlePlaceholder: 'e.g. Family photos at the beach', pickupLabel: 'Deliver by' },
  // Art & commissions
  { id: 'commission', name: 'Commission', icon: 'Star', uses: ['art'], hint: 'A piece made to order: brief, size, revisions, deposit', sections: ['brief', 'size', 'references', 'revisions', 'payment', 'part:photos', 'part:pickup'], titleLabel: 'Piece', titlePlaceholder: 'e.g. Pet portrait, 12 × 16', summaryLabel: 'Notes', summaryPlaceholder: 'Anything to remember about it', pickupLabel: 'Due', layout: { receivedLabel: 'Started' } },
  // Shop & orders
  { id: 'order', name: 'Order', icon: 'ShoppingCart', uses: ['shop'], hint: 'What they ordered, and when it’s due', sections: ['items', 'payment', 'part:lines', 'part:pickup'], titleLabel: 'Order', titlePlaceholder: 'What they ordered', summaryLabel: 'Notes', summaryPlaceholder: 'Occasion or anything to remember', pickupLabel: 'Due' },
  { id: 'delivery', name: 'Delivery order', icon: 'Truck', uses: ['shop', 'events'], hint: 'An order delivered to someone', sections: ['items', 'delivery', 'part:lines', 'payment', 'part:pickup'], titleLabel: 'Order', titlePlaceholder: 'What they ordered', summaryLabel: 'Notes', summaryPlaceholder: 'Anything special about it', pickupLabel: 'Delivery' },
  { id: 'custom-order', name: 'Custom order', icon: 'Gift', uses: ['shop', 'art'], hint: 'Made to order: design notes, sizes, a deposit', sections: ['design-notes', 'measurements', 'payment', 'part:photos', 'part:lines', 'part:pickup'], titleLabel: 'Order', titlePlaceholder: 'e.g. Custom birthday cake', pickupLabel: 'Due' },
  // Appointments & bookings
  { id: 'session', name: 'Lesson or session', icon: 'Users', uses: ['bookings'], hint: 'Tutoring, coaching or a class: notes and progress', sections: ['session', 'goals', 'payment', 'followup'], titleLabel: 'Session', titlePlaceholder: 'e.g. Piano lesson', pickupLabel: 'Date' },
  { id: 'pet-appointment', name: 'Pet appointment', icon: 'Heart', uses: ['bookings'], hint: 'Grooming, sitting or walks', sections: ['pet', 'appointment', 'payment'], titleLabel: 'Appointment', titlePlaceholder: 'e.g. Full groom', pickupLabel: 'Date' },
  // Events & planning
  { id: 'event', name: 'Event', icon: 'Calendar', uses: ['events'], hint: 'Venue, guests, schedule, budget and contacts', sections: ['venue', 'guests', 'schedule', 'budget', 'contacts', 'part:lines', 'part:pickup'], titleLabel: 'Event', titlePlaceholder: 'e.g. Smith wedding', summaryLabel: 'Notes', pickupLabel: 'Event date' },
  { id: 'catering', name: 'Catering order', icon: 'Utensils', uses: ['events', 'shop'], hint: 'The menu, how many, and delivery', sections: ['menu', 'guests', 'delivery', 'payment', 'part:lines', 'part:pickup'], titleLabel: 'Order', titlePlaceholder: 'e.g. Office lunch for 20', pickupLabel: 'Event date' },
  // Freelance & consulting
  { id: 'job', name: 'Client job', icon: 'Briefcase', uses: ['freelance'], hint: 'Scope, milestones, approval, time and the invoice', sections: ['scope', 'milestones', 'approval', 'time', 'followup', 'part:lines', 'part:pickup'], titleLabel: 'Job', titlePlaceholder: 'What’s the job?', summaryLabel: 'Notes', summaryPlaceholder: 'The short version', pickupLabel: 'Due' },
  { id: 'estimate', name: 'Quote or estimate', icon: 'Receipt', uses: ['freelance', 'trades'], hint: 'What’s included and the price, waiting for a yes', sections: ['scope', 'part:lines', 'approval', 'followup'], titleLabel: 'Quote', titlePlaceholder: 'What it’s for', pickupLabel: 'Valid until' }
]

/** The presets for these uses (and the ones for everyone) */
export const presetsFor = (uses: string[]): TicketPreset[] => {
  const all = uses.includes('other')
  return TICKET_PRESETS.filter((p) => !p.uses || all || p.uses.some((u) => uses.includes(u)))
}

/** The boxes at the top for tickets made from a preset: the minimum, with the preset's parts added to the ticket instead */
export function presetLayout(preset: TicketPreset): Partial<TicketLayout> {
  return {
    titleLabel: preset.titleLabel ?? 'Name',
    titlePlaceholder: preset.titlePlaceholder ?? 'Give it a name',
    summaryLabel: preset.summaryLabel ?? 'Details',
    summaryPlaceholder: preset.summaryPlaceholder ?? 'What it’s about',
    pickupLabel: preset.pickupLabel ?? 'Due date',
    showPickup: false,
    showLines: false,
    showPhotos: false,
    showEmails: false,
    showWarranty: false,
    parts: presetParts(preset),
    ...preset.layout
  }
}

/** How 1.0 made a preset's top boxes (its old wording), to tell untouched built-in templates from your own */
export function presetLayout10(preset: Pick<TicketPreset, 'titleLabel' | 'titlePlaceholder' | 'summaryLabel' | 'summaryPlaceholder' | 'pickupLabel'> & { sections: string[] }): Partial<TicketLayout> {
  return {
    titleLabel: preset.titleLabel ?? 'Title',
    titlePlaceholder: preset.titlePlaceholder ?? 'What is it? (e.g. Dell laptop, iPhone 13)',
    summaryLabel: preset.summaryLabel ?? 'What they need',
    summaryPlaceholder: preset.summaryPlaceholder ?? 'What’s wrong, or what they’re asking for',
    pickupLabel: preset.pickupLabel ?? 'Pickup'
  }
}

/** A built-in preset for everyone still showing 1.0's repair-flavoured wording, never changed by you */
export function untouched10(saved: Partial<TicketLayout> | null): boolean {
  const old = presetLayout10({ sections: [] }) // 1.0's Quick ticket and Appointment had no names of their own
  const stored = (saved ?? {}) as Record<string, unknown>
  // Layouts keep only what differs from the defaults of the time (Title, What is it?, Details, Pickup)
  const before: Record<string, unknown> = { titleLabel: 'Title', titlePlaceholder: 'What is it?', summaryLabel: 'Details', summaryPlaceholder: 'A short description', pickupLabel: 'Pickup' }
  return (Object.keys(old) as (keyof TicketLayout)[]).every((k) => (stored[k] ?? before[k]) === old[k])
}

/** Sections that don't fit any of these uses (hidden from + Add by the setup) */
export const sectionsNotFor = (uses: string[]): string[] =>
  uses.includes('other') || !uses.length ? [] : TICKET_SECTIONS.filter((s) => s.uses && !s.uses.some((u) => uses.includes(u))).map((s) => s.id)
/** Every section that's only for some uses (the ones the setup decides about) */
export const TAGGED_SECTIONS = new Set(TICKET_SECTIONS.filter((s) => s.uses).map((s) => s.id))

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
