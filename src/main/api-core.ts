import type { Db } from './db'
import type { PlannrApi } from '../shared/api'
import { displayPrefs } from '../shared/api'
import * as notes from './services/notes'
import * as folders from './services/folders'
import * as sidebar from './services/sidebar'
import * as items from './services/items'
import { moneyReport } from './services/reports'
import * as tasks from './services/tasks'
import * as customers from './services/customers'
import * as tickets from './services/tickets'
import * as photos from './services/photos'
import * as templates from './services/templates'
import { backlinks } from './services/links'
import * as calendar from './services/calendar'
import * as holidays from './services/holidays'
import * as money from './services/money'
import { search } from './services/search'
import { saveFile } from './services/files'
import { getSetting, setSetting } from './services/settings'
import { getBusiness } from './services/print'
import { saveDisplayPrefs } from './display'

/** The parts of the API that are the same on every device (the PC app and the phone web app). */
export type CoreApi = Pick<
  PlannrApi,
  | 'notes'
  | 'customers'
  | 'tickets'
  | 'tasks'
  | 'parts'
  | 'photos'
  | 'templates'
  | 'links'
  | 'calendar'
  | 'holidays'
  | 'folders'
  | 'search'
  | 'settings'
  | 'sidebar'
  | 'display'
  | 'business'
> & { files: Pick<PlannrApi['files'], 'save'>; money: Omit<PlannrApi['money'], 'exportCsv'> }

export interface CoreHooks {
  /** Money or customer data changed (QuickBooks sends it soon) */
  moneyChanged: () => void
  /** Calendar data changed (Google gets it soon) */
  calendarChanged: () => void
  /** Downloads text (holiday feeds) */
  fetchText: (url: string) => Promise<string>
}

export function createCoreApi(db: Db, dataDir: string, hooks: CoreHooks): CoreApi {
  const moneyChanged = <T>(value: T): T => {
    hooks.moneyChanged()
    return value
  }
  const changed = <T>(value: T): T => {
    hooks.calendarChanged()
    return value
  }
  return {
    notes: {
      list: async (opts) => notes.listNotes(db, opts),
      get: async (id) => notes.getNote(db, id),
      create: async (input) => notes.createNote(db, input),
      update: async (id, patch) => notes.updateNote(db, id, patch),
      trash: async (id) => notes.trashNote(db, id),
      restore: async (id) => notes.restoreNote(db, id),
      destroy: async (id) => notes.destroyNote(db, id),
      tags: async () => notes.allTags(db)
    },
    customers: {
      list: async (opts) => customers.listCustomers(db, opts),
      get: async (id) => customers.getCustomer(db, id),
      create: async (input) => moneyChanged(customers.createCustomer(db, input)),
      update: async (id, patch) => moneyChanged(customers.updateCustomer(db, id, patch)),
      trash: async (id) => moneyChanged(customers.trashCustomer(db, id)),
      restore: async (id) => moneyChanged(customers.restoreCustomer(db, id))
    },
    tickets: {
      list: async (filter) => tickets.listTickets(db, filter),
      get: async (id) => tickets.getTicket(db, id),
      create: async (input) => tickets.createTicket(db, input),
      update: async (id, patch) => (patch.pickupOn !== undefined ? changed(tickets.updateTicket(db, id, patch)) : tickets.updateTicket(db, id, patch)),
      trash: async (id) => changed(tickets.trashTicket(db, id)),
      restore: async (id) => changed(tickets.restoreTicket(db, id)),
      counts: async () => tickets.ticketCounts(db),
      items: async (ticketId) => items.listItems(db, ticketId),
      addItem: async (ticketId, input) => moneyChanged(items.addItem(db, ticketId, input)),
      updateItem: async (id, patch) => moneyChanged(items.updateItem(db, id, patch)),
      removeItem: async (id) => moneyChanged(items.removeItem(db, id)),
      totals: async (ticketId) => items.totalsFor(db, ticketId)
    },
    tasks: {
      list: async (opts) => tasks.listTasks(db, opts),
      range: async (from, to) => tasks.tasksInRange(db, from, to),
      create: async (input) => tasks.createTask(db, input),
      update: async (id, patch) => tasks.updateTask(db, id, patch),
      remove: async (id) => tasks.removeTask(db, id),
      restore: async (id) => tasks.restoreTask(db, id),
      dueCount: async () => tasks.dueTaskCount(db),
      checklists: async (opts) => tasks.checklistItems(db, opts),
      setChecklist: async (source, id, index, checked) => tasks.setChecklistItem(db, source, id, index, checked)
    },
    parts: {
      list: async (opts) => items.listParts(db, opts),
      create: async (input) => items.createPart(db, input),
      update: async (id, patch) => items.updatePart(db, id, patch),
      remove: async (id) => items.removePart(db, id),
      restore: async (id) => items.restorePart(db, id),
      lowCount: async () => items.lowStockCount(db)
    },
    photos: {
      list: async (ticketId) => photos.listPhotos(db, ticketId),
      add: async (ticketId, fileIds, kind) => photos.addPhotos(db, ticketId, fileIds, kind),
      remove: async (id) => photos.removePhoto(db, id),
      setKind: async (id, kind) => photos.setPhotoKind(db, id, kind)
    },
    templates: {
      list: async (kind) => templates.listTemplates(db, kind),
      get: async (id) => templates.getTemplate(db, id),
      create: async (input) => templates.createTemplate(db, input),
      update: async (id, patch) => templates.updateTemplate(db, id, patch),
      remove: async (id) => templates.removeTemplate(db, id)
    },
    links: { backlinks: async (id) => backlinks(db, id) },
    calendar: {
      range: async (from, to) => calendar.listEvents(db, from, to),
      get: async (id) => calendar.getEvent(db, id),
      create: async (input) => changed(calendar.createEvent(db, input)),
      update: async (id, patch) => changed(calendar.updateEvent(db, id, patch)),
      remove: async (id) => changed(calendar.removeEvent(db, id)),
      skipOccurrence: async (id, date) => changed(calendar.skipOccurrence(db, id, date)),
      forLink: async (id) => calendar.eventsForLink(db, id),
      drop: async (item, date, startTime) => changed(calendar.dropItem(db, item, date, startTime ?? null))
    },
    holidays: {
      range: async (from, to) => holidays.listHolidays(db, from, to),
      status: async () => holidays.holidayStatus(db),
      configure: async (opts) => {
        holidays.setHolidayPrefs(db, opts)
        return holidays.holidaysStale(db) ? holidays.refreshHolidays(db, hooks.fetchText) : holidays.holidayStatus(db)
      },
      refresh: async () => holidays.refreshHolidays(db, hooks.fetchText)
    },
    folders: {
      list: async () => folders.listFolders(db),
      create: async (name, place) => folders.createFolder(db, name, place),
      rename: async (id, name) => folders.renameFolder(db, id, name),
      style: async (id, style) => folders.styleFolder(db, id, style),
      remove: async (id) => folders.removeFolder(db, id)
    },
    search: { query: async (q, opts) => search(db, q, opts) },
    files: { save: async (input) => saveFile(db, dataDir, input) },
    settings: { get: async (key) => getSetting(db, key), set: async (key, value) => setSetting(db, key, value) },
    money: {
      // Auto-pay catch-up runs first so lists are right even if Plannr was closed when something renewed.
      recurring: async () => (money.processAutopay(db), money.listRecurring(db)),
      createRecurring: async (kind) => money.createRecurring(db, kind),
      updateRecurring: async (id, patch) => money.updateRecurring(db, id, patch),
      removeRecurring: async (id) => money.removeRecurring(db, id),
      restoreRecurring: async (id) => money.restoreRecurring(db, id),
      markPaid: async (id, opts) => moneyChanged(money.markPaid(db, id, opts)),
      skip: async (id) => money.skip(db, id),
      transactions: async (filter) => money.listTransactions(db, filter),
      addTransaction: async (input) => moneyChanged(money.addTransaction(db, input)),
      updateTransaction: async (id, patch) => moneyChanged(money.updateTransaction(db, id, patch)),
      removeTransaction: async (id) => moneyChanged(money.removeTransaction(db, id)),
      restoreTransaction: async (id) => moneyChanged(money.restoreTransaction(db, id)),
      summary: async (month) => (money.processAutopay(db), money.summary(db, month)),
      occurrences: async (from, to) => money.occurrences(db, from, to),
      report: async (from, to) => moneyReport(db, from, to),
      categories: async () => money.categories(db)
    },
    sidebar: {
      sections: async () => sidebar.listSections(db),
      createSection: async (name) => sidebar.createSection(db, name),
      renameSection: async (id, name) => sidebar.renameSection(db, id, name),
      removeSection: async (id) => sidebar.removeSection(db, id),
      reorderSections: async (ids) => sidebar.reorderSections(db, ids),
      move: async (item, dest, order) => sidebar.moveInSidebar(db, item, dest, order)
    },
    display: { get: async () => displayPrefs(), set: async (patch) => saveDisplayPrefs(db, patch) },
    business: {
      get: async () => getBusiness(db),
      set: async (patch) => {
        const next = { ...getBusiness(db), ...patch }
        next.taxRate = Math.max(0, Math.min(100, Number(next.taxRate) || 0))
        setSetting(db, 'business', next)
        return next
      }
    }
  }
}
