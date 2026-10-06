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
  /** Icon name from the picker (e.g. "Star") or an emoji; '' = default */
  icon: string
  /** Colour id from the palette (e.g. "blue"); '' = default */
  color: string
  /** Sidebar section it's shown in (top-level folders only) */
  sectionId: string
  /** Folder it's inside, or null */
  parentId: string | null
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
  /** Icon name from the picker or an emoji; '' = default */
  icon: string
  /** Colour id from the palette; '' = default */
  color: string
  /** Sidebar section it's shown in (Pinned or one you added); null = not in the sidebar unless it's in a folder */
  sectionId: string | null
  /** Order within its section/folder in the sidebar */
  sort: number
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
  icon?: string
  color?: string
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
  /** Automated tests: the welcome tour stays out of the way */
  tests: boolean
}

/** Ticket prefix suggested from a business name: "Acme Repairs" → "AR-", "Nano Tech Services" → "NTS-". */
export function suggestPrefix(name: string): string {
  const initials = name
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !/^(and|of|the|inc|ltd|llc|co)$/i.test(w))
    .map((w) => w[0].toUpperCase())
    .join('')
    .slice(0, 4)
  return initials ? `${initials}-` : 'T-'
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
export const statusLabel = (s: TicketStatus): string => display.statusLabels[s]?.trim() || (TICKET_STATUSES.find((x) => x.id === s)?.label ?? s)

// ---------- Display preferences (Settings), shared by the main process and the window ----------

export interface DisplayPrefs {
  /** Before ticket numbers, e.g. "NT-" → NT-0007 */
  ticketPrefix: string
  /** ISO currency code, e.g. CAD */
  currency: string
  /** Your names for the ticket statuses (blank = default name) */
  statusLabels: Partial<Record<TicketStatus, string>>
  /** Choices when recording a payment or expense */
  paymentMethods: string[]
  /** 0 = Sunday, 1 = Monday */
  weekStart: 0 | 1
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  ticketPrefix: 'T-',
  currency: 'CAD',
  statusLabels: {},
  paymentMethods: ['Cash', 'Card', 'Debit', 'e-Transfer', 'PayPal', 'Cheque', 'Bank transfer', 'Other'],
  weekStart: 0
}

const display: DisplayPrefs = { ...DEFAULT_DISPLAY }
export const displayPrefs = (): DisplayPrefs => display
export function setDisplayPrefs(patch: Partial<DisplayPrefs>): void {
  Object.assign(display, patch)
}

export const formatTicketNumber = (n: number): string => `${display.ticketPrefix}${String(n).padStart(4, '0')}`

/** "$1,299.50" in the chosen currency (narrow symbol, so CAD shows "$" not "CA$"). */
export function formatCurrency(cents: number): string {
  try {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: display.currency, currencyDisplay: 'narrowSymbol' })
  } catch {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
  }
}

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
  /** Sum of payments recorded for this ticket */
  paidCents: number
  /** No tax on this ticket's line items */
  taxExempt: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

// ---------- Quotes & invoices (ticket line items) and inventory ----------

export type LineKind = 'part' | 'labour' | 'other' | 'discount'

export interface LineItem {
  id: string
  ticketId: string
  kind: LineKind
  description: string
  qty: number
  /** Price per unit (a discount line: the amount taken off) */
  unitCents: number
  /** Inventory part it came from (stock follows the quantity) */
  partId: string | null
  /** The part's cost per unit when it was added, for profit */
  costCents: number | null
  sort: number
}

export interface LineInput {
  kind?: LineKind
  description?: string
  qty?: number
  unitCents?: number
  partId?: string | null
}

export interface TicketTotals {
  /** Parts, labour and other lines */
  subtotal: number
  discount: number
  tax: number
  /** What the customer pays */
  total: number
  /** Cost of the inventory parts used */
  cost: number
  /** Total before tax, minus parts cost */
  profit: number
}

export const lineTotal = (l: Pick<LineItem, 'qty' | 'unitCents'>): number => Math.round(l.qty * l.unitCents)

/** Ticket totals from its lines. Prices are before tax unless `pricesIncludeTax`; `exempt` = no tax. */
export function ticketTotals(lines: LineItem[], opts: { taxRate: number; pricesIncludeTax: boolean; exempt: boolean }): TicketTotals {
  let subtotal = 0
  let discount = 0
  let cost = 0
  for (const l of lines) {
    if (l.kind === 'discount') discount += lineTotal(l)
    else subtotal += lineTotal(l)
    if (l.kind === 'part' && l.costCents !== null) cost += Math.round(l.qty * l.costCents)
  }
  const net = Math.max(0, subtotal - discount)
  const rate = opts.exempt ? 0 : opts.taxRate
  let tax = 0
  let total = net
  if (rate > 0 && opts.pricesIncludeTax) tax = net - Math.round(net / (1 + rate / 100))
  else if (rate > 0) {
    tax = Math.round((net * rate) / 100)
    total = net + tax
  }
  return { subtotal, discount, tax, total, cost, profit: total - tax - cost }
}

export interface Part {
  id: string
  name: string
  sku: string
  /** In stock */
  qty: number
  costCents: number
  /** Usual selling price */
  priceCents: number
  /** Warn when stock is at or below this (0 = never) */
  reorderAt: number
  supplier: string
  notes: string
  /** Total used on tickets */
  used: number
  updatedAt: number
}

export interface PartInput {
  name?: string
  sku?: string
  qty?: number
  costCents?: number
  priceCents?: number
  reorderAt?: number
  supplier?: string
  notes?: string
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
  taxExempt?: boolean
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

export type TemplateKind = 'ticket' | 'note'

export interface TemplateSummary {
  id: string
  name: string
  kind: TemplateKind
  /** Icon for notes made from it (picker name or emoji) */
  icon: string
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

// ---------- Vault ----------

export type VaultItemKind = 'login' | 'card' | 'note'

/** Built-in fields each kind shows, in order. `secret` fields are hidden until revealed. Every kind also has rich notes. */
export const VAULT_FIELDS: Record<VaultItemKind, { key: string; label: string; secret?: boolean }[]> = {
  login: [
    { key: 'username', label: 'Username / email' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'url', label: 'Website' }
  ],
  card: [
    { key: 'cardholder', label: 'Name on card' },
    { key: 'number', label: 'Card number', secret: true },
    { key: 'expiry', label: 'Expiry (MM/YY)' },
    { key: 'cvv', label: 'Security code', secret: true },
    { key: 'pin', label: 'PIN', secret: true }
  ],
  note: []
}

/** A field the user added (e.g. "Account #"). */
export interface VaultCustomField {
  id: string
  label: string
  value: string
  secret: boolean
}

export interface VaultItem {
  id: string
  kind: VaultItemKind
  title: string
  fields: Record<string, string>
  custom: VaultCustomField[]
  /** Rich notes (same editor as regular notes) */
  notes: DocJSON | null
  createdAt: number
  updatedAt: number
}

export interface VaultItemPatch {
  title?: string
  fields?: Record<string, string>
  custom?: VaultCustomField[]
  notes?: DocJSON
}

export interface VaultItemSummary {
  id: string
  kind: VaultItemKind
  title: string
  /** e.g. username, or card ending */
  subtitle: string
  /** Notes text, custom field labels/values and file names, for the vault's own search box */
  searchText: string
  fileCount: number
  updatedAt: number
}

/** An encrypted file in the vault. `url` (plannr-vault://…) only works while the vault is unlocked. */
export interface VaultFile {
  id: string
  itemId: string
  name: string
  mime: string
  size: number
  url: string
  createdAt: number
}

export interface VaultStatus {
  setUp: boolean
  unlocked: boolean
  autoLockMinutes: number
  /** While > 0, unlocking is paused after repeated wrong passcodes */
  retryAfterMs: number
}

export type VaultResult = { ok: true } | { ok: false; error: string; retryAfterMs?: number }

export const MIN_PASSCODE_LENGTH = 6

// ---------- Money ----------

export type RecurringKind = 'bill' | 'subscription'
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'once'
export const FREQUENCIES: { id: Frequency; label: string; per: string }[] = [
  { id: 'weekly', label: 'Weekly', per: '/wk' },
  { id: 'monthly', label: 'Monthly', per: '/mo' },
  { id: 'quarterly', label: 'Every 3 months', per: '/qtr' },
  { id: 'yearly', label: 'Yearly', per: '/yr' },
  { id: 'once', label: 'One time', per: '' }
]

export interface RecurringItem {
  id: string
  kind: RecurringKind
  name: string
  amountCents: number
  frequency: Frequency
  /** YYYY-MM-DD */
  nextDue: string
  category: string
  autopay: boolean
  /** Remind this many days before (and on the day); -1 = no reminders */
  remindDays: number
  url: string
  notes: string
  active: boolean
  cancelledOn: string | null
  updatedAt: number
}

export interface RecurringPatch {
  name?: string
  amountCents?: number
  frequency?: Frequency
  nextDue?: string
  category?: string
  autopay?: boolean
  remindDays?: number
  url?: string
  notes?: string
  active?: boolean
}

export type TransactionType = 'income' | 'expense'

export interface Transaction {
  id: string
  date: string
  type: TransactionType
  amountCents: number
  description: string
  category: string
  method: string
  ticketId: string | null
  /** e.g. "NT-0007 · Jane Doe" when linked to a ticket */
  ticketLabel: string
  recurringId: string | null
  /** No sales tax on this one (sent to QuickBooks with the Exempt tax code) */
  taxExempt: boolean
  /** Number of the QuickBooks invoice this payment belongs to ('' = none); such payments aren't sent again */
  qboInvoice: string
  updatedAt: number
}

export interface TransactionInput {
  date?: string
  type: TransactionType
  amountCents: number
  description?: string
  category?: string
  method?: string
  ticketId?: string | null
  recurringId?: string | null
  taxExempt?: boolean
  qboInvoice?: string
}

export interface TransactionFilter {
  /** YYYY-MM-DD inclusive */
  from?: string
  to?: string
  type?: TransactionType
  query?: string
  ticketId?: string
}

/** A bill/subscription due date (calendar, upcoming list). */
export interface MoneyOccurrence {
  recurringId: string
  date: string
  name: string
  kind: RecurringKind
  amountCents: number
  autopay: boolean
  /** Before today and not paid yet */
  overdue: boolean
}

export interface UnpaidTicket {
  ticketId: string
  number: number
  customerName: string
  device: string
  status: TicketStatus
  priceCents: number
  paidCents: number
}

export interface MoneySummary {
  month: string
  incomeCents: number
  expenseCents: number
  /** Active subscriptions converted to a monthly / yearly cost */
  subscriptionsMonthlyCents: number
  subscriptionsYearlyCents: number
  /** Overdue and due in the next 30 days */
  upcoming: MoneyOccurrence[]
  unpaidTickets: UnpaidTicket[]
}

/** Payment methods to offer (Settings → Business), plus `current` if it's no longer in the list. */
export const paymentMethods = (current?: string): string[] =>
  current && !display.paymentMethods.includes(current) ? [...display.paymentMethods, current] : display.paymentMethods
export const DEFAULT_CATEGORIES = ['Parts', 'Software', 'Rent', 'Utilities', 'Phone & internet', 'Insurance', 'Marketing', 'Fuel', 'Tools', 'Other']

// ---------- Google Calendar ----------

export interface GoogleCalendarInfo {
  id: string
  name: string
  color: string
  primary: boolean
}

/** An event from one of the user's other Google calendars (read-only in Plannr). */
export interface GoogleEvent {
  id: string
  calendarName: string
  color: string
  title: string
  date: string
  /** Last day of a multi-day all-day event */
  endDate: string | null
  startTime: string | null
  endTime: string | null
  htmlLink: string
}

export interface GoogleStatus {
  /** The Google "Desktop app" key file has been imported */
  configured: boolean
  connected: boolean
  email: string | null
  lastSyncAt: number | null
  error: string | null
  /** Other calendars in the account (not the Plannr one) */
  calendars: GoogleCalendarInfo[]
  /** Which of them show in Plannr (default: the main calendar) */
  selected: string[]
}

// ---------- Zoho Mail ----------

export type ZohoRegion = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa'
export const ZOHO_REGIONS: { id: ZohoRegion; label: string }[] = [
  { id: 'com', label: 'zoho.com (US / global)' },
  { id: 'eu', label: 'zoho.eu (Europe)' },
  { id: 'in', label: 'zoho.in (India)' },
  { id: 'com.au', label: 'zoho.com.au (Australia)' },
  { id: 'jp', label: 'zoho.jp (Japan)' },
  { id: 'ca', label: 'zohocloud.ca (Canada)' },
  { id: 'sa', label: 'zoho.sa (Saudi Arabia)' }
]

export interface ZohoStatus {
  configured: boolean
  connected: boolean
  email: string | null
  region: ZohoRegion | null
  error: string | null
}

export interface ZohoMessage {
  id: string
  folderId: string
  subject: string
  summary: string
  from: string
  /** From the customer (vs. sent by you) */
  incoming: boolean
  date: number
  hasAttachment: boolean
  /** Opens the message in Zoho Mail on the web */
  link: string
}

export interface ZohoMessageContent {
  subject: string
  from: string
  to: string
  date: number
  /** A complete, locked-down HTML document for a sandboxed frame */
  html: string
  link: string
}

// ---------- QuickBooks Online ----------

/** Where things go in QuickBooks (picked in Settings after connecting). Amounts in Plannr include tax. */
export interface QboConfig {
  /** Service item used on sales receipts (e.g. "Repair services") */
  itemId: string
  /** Sales tax code + its total rate in % (e.g. HST ON = 13) */
  taxCodeId: string
  taxRate: number
  /** Bank or credit card account expenses are paid from */
  paymentAccountId: string
  paymentAccountType: string
  /** Expense account when no QuickBooks account matches the Plannr category */
  expenseAccountId: string
  purchaseTaxCodeId: string
  purchaseTaxRate: number
  /** Only transactions on/after this date are sent (YYYY-MM-DD) */
  startDate: string
}

export interface QboOption {
  id: string
  name: string
  /** Account type, or tax rate % for tax codes */
  detail?: string
  rate?: number
}

export interface QboOptions {
  companyName: string
  items: QboOption[]
  incomeAccounts: QboOption[]
  taxCodes: QboOption[]
  paymentAccounts: QboOption[]
  expenseAccounts: QboOption[]
}

export interface QboStatus {
  configured: boolean
  connected: boolean
  companyName: string | null
  /** Where-things-go choices made (sync runs only when complete) */
  config: QboConfig | null
  lastSyncAt: number | null
  error: string | null
  /** Records that failed last sync (others still synced) */
  problems: string[]
}

// ---------- Sidebar organisation ----------

export interface SidebarSection {
  id: string
  name: string
  /** Pinned and Folders: can be renamed, not removed */
  builtin: boolean
}
export interface SidebarRef {
  type: 'note' | 'folder'
  id: string
}
export type SidebarDest = { sectionId: string } | { folderId: string }

// ---------- Business details & printing ----------

/** Shown on printouts (intake slip, receipt, label). */
export interface BusinessInfo {
  name: string
  address: string
  phone: string
  email: string
  website: string
  /** e.g. "GST", "HST" */
  taxName: string
  /** % included in prices, used to show the tax on receipts and for "+ tax" payments when QuickBooks isn't set up */
  taxRate: number
  /** Quote/invoice line prices already include the tax (otherwise it's added on top) */
  pricesIncludeTax: boolean
  /** GST/HST registration number */
  taxNumber: string
  /** Printed on the intake slip above the signature line */
  intakeTerms: string
  /** Printed at the bottom of receipts */
  receiptNote: string
  logoFileId: string | null
  labelSize: '62x29mm' | '2.25x1.25in' | '4x6in'
}

export type PrintKind = 'intake' | 'receipt' | 'label' | 'quote' | 'invoice'

// ---------- Updates ----------

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error'
  /** This copy's version */
  current: string
  /** Newest published version, once checked */
  latest: string | null
  /** Release page with what's new */
  notesUrl: string | null
  /** 0–1 while downloading */
  progress: number
  error: string | null
  /** False when running from source: updates install only in the installed app */
  canInstall: boolean
  checkedAt: number | null
}

// ---------- Backups ----------

export interface BackupInfo {
  file: string
  createdAt: number
  size: number
}

export interface BackupStatus {
  dir: string
  lastAt: number | null
  error: string | null
  backups: BackupInfo[]
}

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export interface PlannrApi {
  notes: {
    list(opts?: NoteListOptions): Promise<NoteSummary[]>
    get(id: string): Promise<Note | null>
    /** `templateId`: start as a copy of a note template */
    create(input?: { title?: string; folderId?: string | null; templateId?: string | null }): Promise<Note>
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
    restore(id: string): Promise<void>
  }
  tickets: {
    list(filter?: TicketFilter): Promise<TicketSummary[]>
    get(id: string): Promise<Ticket | null>
    create(input?: { templateId?: string | null; customerId?: string | null }): Promise<Ticket>
    update(id: string, patch: TicketUpdate): Promise<TicketSummary>
    trash(id: string): Promise<void>
    restore(id: string): Promise<void>
    counts(): Promise<{ open: number; ready: number }>
    /** Quote/invoice lines; changes return the new list (the ticket's price follows the total) */
    items(ticketId: string): Promise<LineItem[]>
    addItem(ticketId: string, input?: LineInput): Promise<LineItem[]>
    updateItem(id: string, patch: LineInput): Promise<LineItem[]>
    removeItem(id: string): Promise<LineItem[]>
    totals(ticketId: string): Promise<TicketTotals>
  }
  parts: {
    list(opts?: { query?: string; lowOnly?: boolean }): Promise<Part[]>
    create(input?: PartInput): Promise<Part>
    update(id: string, patch: PartInput): Promise<Part>
    remove(id: string): Promise<void>
    restore(id: string): Promise<void>
    lowCount(): Promise<number>
  }
  photos: {
    list(ticketId: string): Promise<TicketPhoto[]>
    add(ticketId: string, fileIds: string[], kind: PhotoKind): Promise<TicketPhoto[]>
    remove(id: string): Promise<void>
    setKind(id: string, kind: PhotoKind): Promise<void>
  }
  templates: {
    /** Ticket templates unless another kind is asked for */
    list(kind?: TemplateKind): Promise<TemplateSummary[]>
    get(id: string): Promise<Template | null>
    create(input?: { name?: string; content?: DocJSON | null; kind?: TemplateKind; icon?: string }): Promise<Template>
    update(id: string, patch: { name?: string; content?: DocJSON; icon?: string }): Promise<void>
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
    /** In a section (default Folders) or inside another folder */
    create(name: string, place?: { sectionId?: string; parentId?: string | null }): Promise<Folder>
    rename(id: string, name: string): Promise<void>
    /** Icon and colour ('' = default) */
    style(id: string, style: { icon?: string; color?: string }): Promise<void>
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
  vault: {
    status(): Promise<VaultStatus>
    /** First-time setup. Returns the recovery key (shown once). */
    setup(passcode: string): Promise<{ recoveryKey: string }>
    unlock(passcode: string): Promise<VaultResult>
    /** Forgot passcode: the recovery key sets a new one */
    recover(recoveryKey: string, newPasscode: string): Promise<VaultResult>
    changePasscode(current: string, next: string): Promise<VaultResult>
    lock(): Promise<void>
    /** Keeps the vault unlocked while it's being used */
    touch(): Promise<void>
    setAutoLock(minutes: number): Promise<void>
    list(): Promise<VaultItemSummary[]>
    get(id: string): Promise<VaultItem | null>
    create(kind: VaultItemKind): Promise<VaultItem>
    update(id: string, patch: VaultItemPatch): Promise<VaultItem>
    remove(id: string): Promise<void>
    /** Copies a field to the clipboard; cleared again after 30 seconds */
    copy(id: string, field: string): Promise<void>
    /** Save-file dialog for the recovery key */
    saveRecoveryKey(recoveryKey: string): Promise<boolean>
    /** Encrypts and stores a file. `inline` = an image inside the item's notes (not listed as an attachment). */
    addFile(itemId: string, file: { name: string; mime: string; data: Uint8Array; inline?: boolean }): Promise<VaultFile>
    /** Attachments of an item (not inline note images) */
    files(itemId: string): Promise<VaultFile[]>
    removeFile(fileId: string): Promise<void>
    /** Opens a temporary decrypted copy in its Windows app (deleted when the vault locks) */
    openFile(fileId: string): Promise<void>
    /** Save-file dialog to export a decrypted copy */
    exportFile(fileId: string): Promise<boolean>
  }
  money: {
    recurring(): Promise<RecurringItem[]>
    createRecurring(kind: RecurringKind): Promise<RecurringItem>
    updateRecurring(id: string, patch: RecurringPatch): Promise<RecurringItem>
    removeRecurring(id: string): Promise<void>
    restoreRecurring(id: string): Promise<void>
    /** Records the payment (an expense) and moves to the next due date */
    markPaid(id: string, opts?: { date?: string; amountCents?: number }): Promise<RecurringItem>
    /** Moves to the next due date without recording a payment */
    skip(id: string): Promise<RecurringItem>
    transactions(filter?: TransactionFilter): Promise<Transaction[]>
    addTransaction(input: TransactionInput): Promise<Transaction>
    updateTransaction(id: string, patch: Partial<TransactionInput>): Promise<Transaction>
    removeTransaction(id: string): Promise<void>
    restoreTransaction(id: string): Promise<void>
    /** month = YYYY-MM */
    summary(month: string): Promise<MoneySummary>
    occurrences(from: string, to: string): Promise<MoneyOccurrence[]>
    categories(): Promise<string[]>
    /** Save-file dialog: transactions in [from, to] as CSV */
    exportCsv(from: string, to: string): Promise<boolean>
  }
  google: {
    status(): Promise<GoogleStatus>
    /** Imports the "Desktop app" key file downloaded from Google Cloud (file picker opens in Downloads) */
    importClient(): Promise<GoogleStatus>
    /** Opens Google sign-in in the browser; resolves when done */
    connect(): Promise<GoogleStatus>
    disconnect(): Promise<GoogleStatus>
    syncNow(): Promise<GoogleStatus>
    setCalendars(ids: string[]): Promise<GoogleStatus>
    /** Events from the chosen Google calendars in [from, to] */
    events(from: string, to: string): Promise<GoogleEvent[]>
  }
  zoho: {
    status(): Promise<ZohoStatus>
    /** Saves the API key from api-console.zoho.com (stored encrypted) */
    configure(input: { region: ZohoRegion; clientId: string; clientSecret: string }): Promise<ZohoStatus>
    connect(): Promise<ZohoStatus>
    disconnect(): Promise<ZohoStatus>
    /** Recent emails to/from this address (newest first) */
    search(email: string): Promise<ZohoMessage[]>
    message(folderId: string, messageId: string): Promise<ZohoMessageContent>
  }
  quickbooks: {
    status(): Promise<QboStatus>
    configureKey(input: { clientId: string; clientSecret: string }): Promise<QboStatus>
    /** Opens QuickBooks sign-in in a Plannr window */
    connect(): Promise<QboStatus>
    disconnect(): Promise<QboStatus>
    /** Lists from QuickBooks for the where-things-go choices */
    options(): Promise<QboOptions>
    /** Creates a "Repair services" service item on the chosen income account; returns its id */
    createItem(incomeAccountId: string): Promise<QboOption>
    setConfig(config: QboConfig): Promise<QboStatus>
    syncNow(): Promise<QboStatus>
  }
  backup: {
    status(): Promise<BackupStatus>
    runNow(): Promise<BackupStatus>
    /** Folder picker for where backups go (e.g. a USB drive or OneDrive folder) */
    chooseFolder(): Promise<BackupStatus>
    openFolder(): Promise<void>
    /** Restores a snapshot (current data is saved first) and restarts Plannr */
    restore(file: string): Promise<void>
  }
  sidebar: {
    sections(): Promise<SidebarSection[]>
    createSection(name: string): Promise<SidebarSection>
    renameSection(id: string, name: string): Promise<void>
    removeSection(id: string): Promise<void>
    reorderSections(ids: string[]): Promise<void>
    /** Move a note/folder into a section or folder; `order` = that place's full new item order */
    move(item: SidebarRef, dest: SidebarDest, order: SidebarRef[]): Promise<void>
  }
  display: {
    get(): Promise<DisplayPrefs>
    set(patch: Partial<DisplayPrefs>): Promise<DisplayPrefs>
  }
  business: {
    get(): Promise<BusinessInfo>
    set(patch: Partial<BusinessInfo>): Promise<BusinessInfo>
  }
  print: {
    /** Opens the Windows print dialog for a ticket printout */
    ticket(id: string, kind: PrintKind): Promise<void>
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    /** Downloads, verifies and installs the new version, then restarts Plannr */
    install(): Promise<UpdateStatus>
  }
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    setTheme(theme: Theme): Promise<void>
    /** Text size: 1 = normal (0.8–1.4) */
    setZoom(factor: number): Promise<void>
    getZoom(): Promise<number>
    getOpenAtLogin(): Promise<boolean>
    /** Start Plannr (in the tray) when Windows starts, so reminders always work */
    setOpenAtLogin(enabled: boolean): Promise<void>
  }
}

export const API_SHAPE = {
  notes: ['list', 'get', 'create', 'update', 'trash', 'restore', 'destroy', 'tags'],
  customers: ['list', 'get', 'create', 'update', 'trash', 'restore'],
  tickets: ['list', 'get', 'create', 'update', 'trash', 'restore', 'counts', 'items', 'addItem', 'updateItem', 'removeItem', 'totals'],
  parts: ['list', 'create', 'update', 'remove', 'restore', 'lowCount'],
  photos: ['list', 'add', 'remove', 'setKind'],
  templates: ['list', 'get', 'create', 'update', 'remove'],
  links: ['backlinks'],
  calendar: ['range', 'get', 'create', 'update', 'remove', 'forLink', 'drop'],
  holidays: ['range', 'status', 'configure', 'refresh'],
  vault: [
    'status',
    'setup',
    'unlock',
    'recover',
    'changePasscode',
    'lock',
    'touch',
    'setAutoLock',
    'list',
    'get',
    'create',
    'update',
    'remove',
    'copy',
    'saveRecoveryKey',
    'addFile',
    'files',
    'removeFile',
    'openFile',
    'exportFile'
  ],
  folders: ['list', 'create', 'rename', 'style', 'remove'],
  search: ['query'],
  files: ['save', 'open'],
  settings: ['get', 'set'],
  money: [
    'recurring',
    'createRecurring',
    'updateRecurring',
    'removeRecurring',
    'restoreRecurring',
    'markPaid',
    'skip',
    'transactions',
    'addTransaction',
    'updateTransaction',
    'removeTransaction',
    'restoreTransaction',
    'summary',
    'occurrences',
    'categories',
    'exportCsv'
  ],
  google: ['status', 'importClient', 'connect', 'disconnect', 'syncNow', 'setCalendars', 'events'],
  zoho: ['status', 'configure', 'connect', 'disconnect', 'search', 'message'],
  quickbooks: ['status', 'configureKey', 'connect', 'disconnect', 'options', 'createItem', 'setConfig', 'syncNow'],
  backup: ['status', 'runNow', 'chooseFolder', 'openFolder', 'restore'],
  sidebar: ['sections', 'createSection', 'renameSection', 'removeSection', 'reorderSections', 'move'],
  display: ['get', 'set'],
  business: ['get', 'set'],
  print: ['ticket'],
  updates: ['status', 'check', 'install'],
  app: ['info', 'openDataFolder', 'setTheme', 'setZoom', 'getZoom', 'getOpenAtLogin', 'setOpenAtLogin']
} as const satisfies { [K in keyof PlannrApi]: readonly (keyof PlannrApi[K])[] }

// Compile-time check that API_SHAPE lists every method of PlannrApi.
type MissingMethods = {
  [K in keyof PlannrApi]: Exclude<keyof PlannrApi[K], (typeof API_SHAPE)[K][number]>
}[keyof PlannrApi]
export const API_SHAPE_COMPLETE: [MissingMethods] extends [never] ? true : never = true
