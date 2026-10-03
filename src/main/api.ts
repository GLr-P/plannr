import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { Db } from './db'
import { API_SHAPE, type PlannrApi, type Theme } from '../shared/api'
import * as notes from './services/notes'
import * as folders from './services/folders'
import { search } from './services/search'
import { saveFile } from './services/files'
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
      backlinks: async (id) => notes.noteBacklinks(db, id),
      tags: async () => notes.allTags(db)
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
      save: async (input) => saveFile(db, dataDir, input)
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
      }
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
