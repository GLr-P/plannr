import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { VaultSession } from './vault-session'
import type { Db } from './db'
import { API_SHAPE, type BackupStatus, type GoogleCalendarInfo, type GoogleStatus, type PlannrApi, type QboStatus, type Theme } from '../shared/api'
import * as notes from './services/notes'
import * as folders from './services/folders'
import * as customers from './services/customers'
import * as tickets from './services/tickets'
import * as photos from './services/photos'
import * as templates from './services/templates'
import { backlinks } from './services/links'
import * as calendar from './services/calendar'
import * as holidays from './services/holidays'
import * as money from './services/money'
import { getOpenAtLogin, setOpenAtLogin } from './background'
import * as backups from './services/backup'
import * as google from './services/google'
import * as googleClient from './google-client'
import * as zoho from './zoho-client'
import * as qbo from './quickbooks-client'
import * as qboSync from './services/quickbooks'
import type { QuickBooksSync } from './quickbooks-sync'
import type { GoogleSync } from './google-sync'
import { search } from './services/search'
import { resolveFilePath, saveFile } from './services/files'
import { getSetting, setSetting } from './services/settings'

export const TITLEBAR_HEIGHT = 44
export const themeColors: Record<Theme, { bg: string; titlebar: string; symbol: string }> = {
  light: { bg: '#ffffff', titlebar: '#f6f6f4', symbol: '#3a3a37' },
  dark: { bg: '#1b1b1d', titlebar: '#151517', symbol: '#d6d6d6' }
}

export interface ApiHooks {
  googleSync: GoogleSync
  qboSync: QuickBooksSync
  backupDir: () => string
  /** Closes the database, puts the snapshot back and restarts Plannr */
  restoreAndRestart: (file: string) => Promise<void>
}

export function createApi(db: Db, dataDir: string, getWindow: () => BrowserWindow | null, vaultSession: VaultSession, hooks: ApiHooks): PlannrApi {
  const googleStatus = (): GoogleStatus => {
    const calendars = (getSetting(db, 'google.calendarList') as GoogleCalendarInfo[] | null) ?? []
    return {
      configured: googleClient.isConfigured(db),
      connected: googleClient.isConnected(db),
      email: googleClient.connectedEmail(db),
      lastSyncAt: (getSetting(db, 'google.lastSyncAt') as number | null) ?? null,
      error: (getSetting(db, 'google.error') as string | null) ?? null,
      calendars,
      selected: google.selectedCalendarIds(db) ?? calendars.filter((c) => c.primary).map((c) => c.id)
    }
  }
  const qboStatus = (): QboStatus => ({
    configured: qbo.qboConfigured(db),
    connected: qbo.qboConnected(db),
    companyName: qbo.companyName(db),
    config: qboSync.getConfig(db),
    lastSyncAt: (getSetting(db, 'qbo.lastSyncAt') as number | null) ?? null,
    error: (getSetting(db, 'qbo.error') as string | null) ?? null,
    problems: (getSetting(db, 'qbo.problems') as string[] | null) ?? []
  })
  /** Money or customer data changed: let QuickBooks know soon. */
  const moneyChanged = <T>(value: T): T => {
    hooks.qboSync.schedule()
    return value
  }
  /** Calendar data changed locally: let Google know soon. */
  const changed = <T>(value: T): T => {
    hooks.googleSync.schedule()
    return value
  }
  const backupStatus = (): BackupStatus => ({
    dir: hooks.backupDir(),
    lastAt: (getSetting(db, 'lastBackupAt') as number | null) ?? null,
    error: (getSetting(db, 'backupError') as string | null) ?? null,
    backups: backups.listBackups(hooks.backupDir())
  })
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
      trash: async (id) => moneyChanged(customers.trashCustomer(db, id))
    },
    tickets: {
      list: async (filter) => tickets.listTickets(db, filter),
      get: async (id) => tickets.getTicket(db, id),
      create: async (input) => tickets.createTicket(db, input),
      update: async (id, patch) => (patch.pickupOn !== undefined ? changed(tickets.updateTicket(db, id, patch)) : tickets.updateTicket(db, id, patch)),
      trash: async (id) => changed(tickets.trashTicket(db, id)),
      restore: async (id) => changed(tickets.restoreTicket(db, id)),
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
      create: async (input) => changed(calendar.createEvent(db, input)),
      update: async (id, patch) => changed(calendar.updateEvent(db, id, patch)),
      remove: async (id) => changed(calendar.removeEvent(db, id)),
      forLink: async (id) => calendar.eventsForLink(db, id),
      drop: async (item, date, startTime) => changed(calendar.dropItem(db, item, date, startTime ?? null))
    },
    holidays: {
      range: async (from, to) => holidays.listHolidays(db, from, to),
      status: async () => holidays.holidayStatus(db),
      configure: async (opts) => {
        holidays.setHolidayPrefs(db, opts)
        return holidays.holidaysStale(db) ? holidays.refreshHolidays(db, fetchText) : holidays.holidayStatus(db)
      },
      refresh: async () => holidays.refreshHolidays(db, fetchText)
    },
    folders: {
      list: async () => folders.listFolders(db),
      create: async (name) => folders.createFolder(db, name),
      rename: async (id, name) => folders.renameFolder(db, id, name),
      style: async (id, style) => folders.styleFolder(db, id, style),
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
    vault: {
      status: async () => vaultSession.status(),
      setup: async (passcode) => vaultSession.setup(passcode),
      unlock: async (passcode) => vaultSession.unlock(passcode),
      recover: async (key, passcode) => vaultSession.recover(key, passcode),
      changePasscode: async (current, next) => vaultSession.changePasscode(current, next),
      lock: async () => vaultSession.lock(),
      touch: async () => vaultSession.touch(),
      setAutoLock: async (minutes) => vaultSession.setAutoLock(minutes),
      list: async () => vaultSession.list(),
      get: async (id) => vaultSession.get(id),
      create: async (kind) => vaultSession.create(kind),
      update: async (id, patch) => vaultSession.update(id, patch),
      remove: async (id) => vaultSession.remove(id),
      copy: async (id, field) => vaultSession.copy(id, field),
      addFile: async (itemId, file) => vaultSession.addFile(itemId, file),
      files: async (itemId) => vaultSession.files(itemId),
      removeFile: async (fileId) => vaultSession.removeFile(fileId),
      openFile: async (fileId) => vaultSession.openFile(fileId),
      exportFile: async (fileId) => {
        const file = vaultSession.readFile(fileId)
        if (!file) return false
        const win = getWindow()
        const options = { defaultPath: file.name }
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return false
        writeFileSync(result.filePath, file.data)
        return true
      },
      saveRecoveryKey: async (recoveryKey) => {
        const win = getWindow()
        const options = { defaultPath: 'Plannr vault recovery key.txt', filters: [{ name: 'Text', extensions: ['txt'] }] }
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return false
        writeFileSync(
          result.filePath,
          [
            'Plannr vault recovery key',
            '',
            recoveryKey,
            '',
            'Keep this somewhere safe (not only on this computer).',
            'If you forget your vault passcode, this key is the only way to get back in.'
          ].join('\r\n')
        )
        return true
      }
    },
    money: {
      // Auto-pay catch-up runs first so lists are right even if Plannr was closed when something renewed.
      recurring: async () => (money.processAutopay(db), money.listRecurring(db)),
      createRecurring: async (kind) => money.createRecurring(db, kind),
      updateRecurring: async (id, patch) => money.updateRecurring(db, id, patch),
      removeRecurring: async (id) => money.removeRecurring(db, id),
      markPaid: async (id, opts) => moneyChanged(money.markPaid(db, id, opts)),
      skip: async (id) => money.skip(db, id),
      transactions: async (filter) => money.listTransactions(db, filter),
      addTransaction: async (input) => moneyChanged(money.addTransaction(db, input)),
      updateTransaction: async (id, patch) => moneyChanged(money.updateTransaction(db, id, patch)),
      removeTransaction: async (id) => moneyChanged(money.removeTransaction(db, id)),
      summary: async (month) => (money.processAutopay(db), money.summary(db, month)),
      occurrences: async (from, to) => money.occurrences(db, from, to),
      categories: async () => money.categories(db),
      exportCsv: async (from, to) => {
        const win = getWindow()
        const options = { defaultPath: `Plannr transactions ${from} to ${to}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] }
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return false
        writeFileSync(result.filePath, '﻿' + money.transactionsCsv(db, from, to)) // BOM so Excel reads it as UTF-8
        return true
      }
    },
    google: {
      status: async () => googleStatus(),
      importClient: async () => {
        await googleClient.importClientFile(db, getWindow())
        return googleStatus()
      },
      connect: async () => {
        await googleClient.connect(db)
        await hooks.googleSync.run().catch(() => undefined) // first sync right away; problems show in status.error
        return googleStatus()
      },
      disconnect: async () => {
        await googleClient.disconnect(db)
        google.clearGoogleData(db)
        return googleStatus()
      },
      syncNow: async () => {
        await hooks.googleSync.run().catch(() => undefined)
        return googleStatus()
      },
      setCalendars: async (ids) => {
        google.setSelectedCalendars(db, ids)
        await hooks.googleSync.run().catch(() => undefined)
        return googleStatus()
      },
      events: async (from, to) => google.listGoogleEvents(db, from, to)
    },
    zoho: {
      status: async () => zoho.zohoStatus(db),
      configure: async (input) => {
        zoho.configure(db, input)
        return zoho.zohoStatus(db)
      },
      connect: async () => {
        await zoho.connect(db)
        return zoho.zohoStatus(db)
      },
      disconnect: async () => {
        await zoho.disconnect(db)
        return zoho.zohoStatus(db)
      },
      search: async (email) => zoho.search(db, email),
      message: async (folderId, messageId) => zoho.message(db, folderId, messageId)
    },
    quickbooks: {
      status: async () => qboStatus(),
      configureKey: async (input) => {
        qbo.configureKey(db, input)
        return qboStatus()
      },
      connect: async () => {
        await qbo.connect(db, getWindow())
        return qboStatus()
      },
      disconnect: async () => {
        await qbo.disconnect(db)
        qboSync.clearQboData(db)
        return qboStatus()
      },
      options: async () => qboSync.loadOptions(qbo.qboApi(db), qbo.companyName(db) ?? ''),
      createItem: async (incomeAccountId) => {
        const api = qbo.qboApi(db)
        const [existing] = await api.query("select * from Item where Name = 'Repair services'")
        const item = existing ?? (await api.create('Item', { Name: 'Repair services', Type: 'Service', IncomeAccountRef: { value: incomeAccountId } }))
        return { id: item.Id, name: 'Repair services' }
      },
      setConfig: async (config) => {
        setSetting(db, 'qbo.config', config)
        hooks.qboSync.schedule(1_000)
        return qboStatus()
      },
      syncNow: async () => {
        await hooks.qboSync.run().catch(() => undefined) // problems show in status
        return qboStatus()
      }
    },
    backup: {
      status: async () => backupStatus(),
      runNow: async () => {
        await backups.runBackup(db, dataDir, hooks.backupDir()).catch(() => undefined) // failure is shown via status.error
        return backupStatus()
      },
      chooseFolder: async () => {
        const win = getWindow()
        const options = { title: 'Where should Plannr keep backups?', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        if (!result.canceled && result.filePaths[0]) {
          setSetting(db, 'backupDir', result.filePaths[0])
          await backups.runBackup(db, dataDir, hooks.backupDir()).catch(() => undefined) // back up there right away
        }
        return backupStatus()
      },
      openFolder: async () => {
        await shell.openPath(hooks.backupDir())
      },
      restore: async (file) => hooks.restoreAndRestart(file)
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

/** Downloads text (holiday feeds). PLANNR_HOLIDAY_FIXTURE points tests at a saved feed instead of the internet. */
export async function fetchText(url: string): Promise<string> {
  if (process.env.PLANNR_HOLIDAY_FIXTURE) return readFileSync(process.env.PLANNR_HOLIDAY_FIXTURE, 'utf8')
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
