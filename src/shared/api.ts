// Contract between the main process (data, files, OS) and the renderer (UI).
// Every method is exposed over IPC as `${namespace}:${method}`; see API_SHAPE.

/** Kinds of things that can be searched and linked. Grows with each phase (event…). */
export type EntityType = 'note' | 'customer' | 'ticket'

/** TipTap/ProseMirror document JSON. */
export type DocJSON = {
  type: string
  content?: DocJSON[]
  attrs?: Record<string, unknown>
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface Folder {
  id: string
  name: string
  sort: number
  createdAt: number
  updatedAt: number
}

export interface NoteSummary {
  id: string
  title: string
  folderId: string | null
  pinned: boolean
  tags: string[]
  preview: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Note extends NoteSummary {
  content: DocJSON | null
}

export interface NoteListOptions {
  /** undefined = all folders, null = unfiled only */
  folderId?: string | null
  tag?: string
  trashed?: boolean
}

export interface NoteUpdate {
  title?: string
  content?: DocJSON
  folderId?: string | null
  pinned?: boolean
  tags?: string[]
}

export interface SearchResult {
  type: EntityType
  id: string
  title: string
  /** Body excerpt; matched terms are wrapped in \u0001 … \u0002 */
  snippet: string
  updatedAt: number
}

export interface Backlink {
  type: EntityType
  id: string
  title: string
}

export interface StoredFile {
  id: string
  name: string
  mime: string
  size: number
  url: string
}

export interface AppInfo {
  version: string
  dataDir: string
}

// ---------- Customers & tickets ----------

export interface CustomerInput {
  name?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  address: string
  notes: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface CustomerSummary extends Customer {
  ticketCount: number
  /** YYYY-MM-DD of their most recent ticket */
  lastVisit: string | null
}

export const TICKET_STATUSES = [
  { id: 'intake', label: 'Intake' },
  { id: 'diagnosing', label: 'Diagnosing' },
  { id: 'waiting_parts', label: 'Waiting on parts' },
  { id: 'ready', label: 'Ready for pickup' },
  { id: 'picked_up', label: 'Picked up' }
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]['id']
export const statusLabel = (s: TicketStatus): string => TICKET_STATUSES.find((x) => x.id === s)?.label ?? s

export const formatTicketNumber = (n: number): string => `NT-${String(n).padStart(4, '0')}`

export interface TicketSummary {
  id: string
  number: number
  customerId: string | null
  customerName: string
  customerPhone: string
  customerEmail: string
  status: TicketStatus
  device: string
  issue: string
  priceCents: number | null
  receivedOn: string | null
  pickupOn: string | null
  closedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Ticket extends TicketSummary {
  content: DocJSON | null
  templateId: string | null
}

export interface TicketFilter {
  /** Matches customer name/email/phone (any format), repair number, device, issue and ticket text */
  query?: string
  /** 'open' = everything not picked up */
  status?: TicketStatus | 'open' | 'all'
  customerId?: string
  /** YYYY-MM-DD, inclusive, on the received date */
  from?: string
  to?: string
  trashed?: boolean
  limit?: number
}

export interface TicketUpdate {
  customerId?: string | null
  status?: TicketStatus
  device?: string
  issue?: string
  priceCents?: number | null
  receivedOn?: string | null
  pickupOn?: string | null
  content?: DocJSON
}

export type PhotoKind = 'before' | 'after'

export interface TicketPhoto {
  id: string
  ticketId: string
  fileId: string
  kind: PhotoKind
  name: string
  url: string
}

export interface TemplateSummary {
  id: string
  name: string
  updatedAt: number
}

export interface Template extends TemplateSummary {
  content: DocJSON | null
}

// ---------- Calendar ----------

export type ReminderKind = 'day_before' | 'day_of'
export const REMINDER_SCHEDULE: Record<ReminderKind, { daysBefore: number; time: string; label: string }> = {
  day_before: { daysBefore: 1, time: '09:00', label: 'Day before (9 AM)' },
  day_of: { daysBefore: 0, time: '08:00', label: 'Day of (8 AM)' }
}

export type EventKind = 'event' | 'pickup'

export interface CalendarEvent {
  id: string
  title: string
  notes: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, null = all day */
  startTime: string | null
  endTime: string | null
  /** 'pickup' events are the pickup date of their linked ticket (kept in sync both ways) */
  kind: EventKind
  linkType: EntityType | null
  linkId: string | null
  linkTitle: string
  /** Linked ticket is picked up (pickup reminders stop) */
  linkDone: boolean
  /** Linked item was deleted */
  linkDeleted: boolean
  reminders: ReminderKind[]
  updatedAt: number
}

export interface EventInput {
  title?: string
  notes?: string
  date: string
  startTime?: string | null
  endTime?: string | null
  linkType?: EntityType | null
  linkId?: string | null
  reminders?: ReminderKind[]
}

export interface EventUpdate {
  title?: string
  notes?: string
  date?: string
  startTime?: string | null
  endTime?: string | null
  reminders?: ReminderKind[]
  kind?: EventKind
}

// ---------- Holidays (Google's public holiday calendars) ----------

export const HOLIDAY_REGIONS = [
  { id: 'en.usa', label: 'United States' },
  { id: 'en.canadian', label: 'Canada' },
  { id: 'en.uk', label: 'United Kingdom' },
  { id: 'en.australian', label: 'Australia' },
  { id: 'en.new_zealand', label: 'New Zealand' },
  { id: 'en.irish', label: 'Ireland' },
  { id: 'en.mexican', label: 'Mexico' },
  { id: 'en.brazilian', label: 'Brazil' },
  { id: 'en.german', label: 'Germany' },
  { id: 'en.french', label: 'France' },
  { id: 'en.spain', label: 'Spain' },
  { id: 'en.italian', label: 'Italy' },
  { id: 'en.indian', label: 'India' },
  { id: 'en.philippines', label: 'Philippines' },
  { id: 'en.japanese', label: 'Japan' }
] as const
export const DEFAULT_HOLIDAY_REGION = 'en.usa'

export interface Holiday {
  id: string
  date: string
  title: string
  observance: boolean
}

export interface HolidayStatus {
  /** null = holidays turned off */
  region: string | null
  showObservances: boolean
  count: number
  fetchedAt: number | null
  error: string | null
}

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export interface PlannrApi {
  notes: {
    list(opts?: NoteListOptions): Promise<NoteSummary[]>
    get(id: string): Promise<Note | null>
    create(input?: { title?: string; folderId?: string | null }): Promise<Note>
    update(id: string, patch: NoteUpdate): Promise<NoteSummary>
    trash(id: string): Promise<void>
    restore(id: string): Promise<void>
    destroy(id: string): Promise<void>
    tags(): Promise<string[]>
  }
  customers: {
    list(opts?: { query?: string; limit?: number }): Promise<CustomerSummary[]>
    get(id: string): Promise<Customer | null>
    create(input?: CustomerInput): Promise<Customer>
    update(id: string, patch: CustomerInput): Promise<Customer>
    trash(id: string): Promise<void>
  }
  tickets: {
    list(filter?: TicketFilter): Promise<TicketSummary[]>
    get(id: string): Promise<Ticket | null>
    create(input?: { templateId?: string | null; customerId?: string | null }): Promise<Ticket>
    update(id: string, patch: TicketUpdate): Promise<TicketSummary>
    trash(id: string): Promise<void>
    restore(id: string): Promise<void>
    counts(): Promise<{ open: number; ready: number }>
  }
  photos: {
    list(ticketId: string): Promise<TicketPhoto[]>
    add(ticketId: string, fileIds: string[], kind: PhotoKind): Promise<TicketPhoto[]>
    remove(id: string): Promise<void>
    setKind(id: string, kind: PhotoKind): Promise<void>
  }
  templates: {
    list(): Promise<TemplateSummary[]>
    get(id: string): Promise<Template | null>
    create(input?: { name?: string; content?: DocJSON | null }): Promise<Template>
    update(id: string, patch: { name?: string; content?: DocJSON }): Promise<void>
    remove(id: string): Promise<void>
  }
  links: {
    /** Notes/tickets that @-mention the given entity */
    backlinks(id: string): Promise<Backlink[]>
  }
  calendar: {
    /** Events with date in [from, to] (YYYY-MM-DD, inclusive) */
    range(from: string, to: string): Promise<CalendarEvent[]>
    get(id: string): Promise<CalendarEvent | null>
    create(input: EventInput): Promise<CalendarEvent>
    update(id: string, patch: EventUpdate): Promise<CalendarEvent>
    remove(id: string): Promise<void>
    /** Events linked to a ticket/customer/note */
    forLink(id: string): Promise<CalendarEvent[]>
    /** Something was dragged onto a day: a ticket becomes (or moves) its pickup; others make a linked event */
    drop(item: { type: EntityType; id: string }, date: string, startTime?: string | null): Promise<CalendarEvent>
  }
  folders: {
    list(): Promise<Folder[]>
    create(name: string): Promise<Folder>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
  }
  search: {
    query(q: string, opts?: { limit?: number; types?: EntityType[] }): Promise<SearchResult[]>
  }
  files: {
    save(input: { name: string; mime: string; data: Uint8Array }): Promise<StoredFile>
    /** Opens the file in its default Windows app (e.g. Photos, to zoom) */
    open(id: string): Promise<void>
  }
  settings: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  holidays: {
    /** Holidays in [from, to] for the chosen region (observances only if enabled) */
    range(from: string, to: string): Promise<Holiday[]>
    status(): Promise<HolidayStatus>
    /** Change region (null = off) and/or observances; downloads the region's holidays */
    configure(opts: { region?: string | null; showObservances?: boolean }): Promise<HolidayStatus>
    refresh(): Promise<HolidayStatus>
  }
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    setTheme(theme: Theme): Promise<void>
    getOpenAtLogin(): Promise<boolean>
    /** Start Plannr (in the tray) when Windows starts, so reminders always work */
    setOpenAtLogin(enabled: boolean): Promise<void>
  }
}

export const API_SHAPE = {
  notes: ['list', 'get', 'create', 'update', 'trash', 'restore', 'destroy', 'tags'],
  customers: ['list', 'get', 'create', 'update', 'trash'],
  tickets: ['list', 'get', 'create', 'update', 'trash', 'restore', 'counts'],
  photos: ['list', 'add', 'remove', 'setKind'],
  templates: ['list', 'get', 'create', 'update', 'remove'],
  links: ['backlinks'],
  calendar: ['range', 'get', 'create', 'update', 'remove', 'forLink', 'drop'],
  holidays: ['range', 'status', 'configure', 'refresh'],
  folders: ['list', 'create', 'rename', 'remove'],
  search: ['query'],
  files: ['save', 'open'],
  settings: ['get', 'set'],
  app: ['info', 'openDataFolder', 'setTheme', 'getOpenAtLogin', 'setOpenAtLogin']
} as const satisfies { [K in keyof PlannrApi]: readonly (keyof PlannrApi[K])[] }

// Compile-time check that API_SHAPE lists every method of PlannrApi.
type MissingMethods = {
  [K in keyof PlannrApi]: Exclude<keyof PlannrApi[K], (typeof API_SHAPE)[K][number]>
}[keyof PlannrApi]
export const API_SHAPE_COMPLETE: [MissingMethods] extends [never] ? true : never = true
