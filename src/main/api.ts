import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { Db } from './db'
import { API_SHAPE, type PlannrApi, type Theme } from '../shared/api'
import * as notes from './services/notes'
import * as folders from './services/folders'
import * as customers from './services/customers'
import * as tickets from './services/tickets'
import * as photos from './services/photos'
import * as templates from './services/templates'
import { backlinks } from './services/links'
import * as calendar from './services/calendar'
import { getOpenAtLogin, setOpenAtLogin } from './background'
import { search } from './services/search'
import { resolveFilePath, saveFile } from './services/files'
import { getSetting, setSetting } from './services/settings'

export const TITLEBAR_HEIGHT = 44
export const themeColors: Record<Theme, { bg: string; titlebar: string; symbol: string }> = {
  light: { bg: '#ffffff', titlebar: '#f6f6f4', symbol: '#3a3a37' },
  dark: { bg: '#1b1b1d', titlebar: '#151517', symbol: '#d6d6d6' }
}

export function createApi(db: Db, dataDir: string, getWindow: () => BrowserWindow | null): PlannrApi {
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
      create: async (input) => customers.createCustomer(db, input),
      update: async (id, patch) => customers.updateCustomer(db, id, patch),
      trash: async (id) => customers.trashCustomer(db, id)
    },
    tickets: {
      list: async (filter) => tickets.listTickets(db, filter),
      get: async (id) => tickets.getTicket(db, id),
      create: async (input) => tickets.createTicket(db, input),
      update: async (id, patch) => tickets.updateTicket(db, id, patch),
      trash: async (id) => tickets.trashTicket(db, id),
      restore: async (id) => tickets.restoreTicket(db, id),
      counts: async () => tickets.ticketCounts(db)
    },
    photos: {
      list: async (ticketId) => photos.listPhotos(db, ticketId),
      add: async (ticketId, fileIds, kind) => photos.addPhotos(db, ticketId, fileIds, kind),
      remove: async (id) => photos.removePhoto(db, id),
      setKind: async (id, kind) => photos.setPhotoKind(db, id, kind)
    },
    templates: {
      list: async () => templates.listTemplates(db),
      get: async (id) => templates.getTemplate(db, id),
      create: async (input) => templates.createTemplate(db, input),
      update: async (id, patch) => templates.updateTemplate(db, id, patch),
      remove: async (id) => templates.removeTemplate(db, id)
    },
    links: {
      backlinks: async (id) => backlinks(db, id)
    },
    calendar: {
      range: async (from, to) => calendar.listEvents(db, from, to),
      get: async (id) => calendar.getEvent(db, id),
      create: async (input) => calendar.createEvent(db, input),
      update: async (id, patch) => calendar.updateEvent(db, id, patch),
      remove: async (id) => calendar.removeEvent(db, id),
      forLink: async (id) => calendar.eventsForLink(db, id),
      drop: async (item, date, startTime) => calendar.dropItem(db, item, date, startTime ?? null)
    },
    folders: {
      list: async () => folders.listFolders(db),
      create: async (name) => folders.createFolder(db, name),
      rename: async (id, name) => folders.renameFolder(db, id, name),
      remove: async (id) => folders.removeFolder(db, id)
    },
    search: {
      query: async (q, opts) => search(db, q, opts)
    },
    files: {
      save: async (input) => saveFile(db, dataDir, input),
      open: async (id) => {
        const file = resolveFilePath(db, dataDir, id)
        if (file) await shell.openPath(file.path)
      }
    },
    settings: {
      get: async (key) => getSetting(db, key),
      set: async (key, value) => setSetting(db, key, value)
    },
    app: {
      info: async () => ({ version: app.getVersion(), dataDir }),
      openDataFolder: async () => {
        await shell.openPath(dataDir)
      },
      setTheme: async (theme) => {
        const win = getWindow()
        if (!win) return
        const c = themeColors[theme]
        win.setBackgroundColor(c.bg)
        win.setTitleBarOverlay({ color: c.titlebar, symbolColor: c.symbol, height: TITLEBAR_HEIGHT })
      },
      getOpenAtLogin: async () => getOpenAtLogin(),
      setOpenAtLogin: async (enabled) => setOpenAtLogin(enabled)
    }
  }
}

export function registerIpc(api: PlannrApi): void {
  for (const [ns, methods] of Object.entries(API_SHAPE)) {
    const impl = api[ns as keyof PlannrApi] as Record<string, (...args: unknown[]) => Promise<unknown>>
    for (const method of methods) {
      ipcMain.handle(`${ns}:${method}`, (_event, ...args: unknown[]) => impl[method](...args))
    }
  }
}
