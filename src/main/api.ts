import { app, BrowserWindow, dialog, ipcMain, net, Notification, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { VaultSession } from './vault-session'
import type { Db } from './db'
import { API_SHAPE, ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL, type AssistantProvider, type AssistantStatus, type BackupStatus, type GoogleCalendarInfo, type GoogleStatus, type PlannrApi, type QboStatus, type Theme } from '../shared/api'
import { exportAll, importContacts } from './services/portability'
import * as money from './services/money'
import { getBusiness } from './services/print'
import { getSecret, putSecret } from './secrets'
import * as packageService from './services/packages'
import * as assistantService from './services/assistant'
import { getOpenAtLogin, resourcePath, setOpenAtLogin } from './background'
import * as backups from './services/backup'
import * as google from './services/google'
import * as googleClient from './google-client'
import * as zoho from './zoho-client'
import * as qbo from './quickbooks-client'
import * as qboSync from './services/quickbooks'
import type { QuickBooksSync } from './quickbooks-sync'
import type { GoogleSync } from './google-sync'
import type { Updater } from './updater'
import type { SyncService } from './sync/service'
import { DEFAULT_CAPTURE_SHORTCUT, hideCapture, openCapture, registerCaptureShortcut } from './capture'
import { resolveFilePath } from './services/files'
import { getSetting, setSetting } from './services/settings'
import { printTicket } from './print-window'
import { createCoreApi } from './api-core'
import { join } from 'node:path'

export const TITLEBAR_HEIGHT = 44
export const themeColors: Record<Theme, { bg: string; titlebar: string; symbol: string }> = {
  light: { bg: '#ffffff', titlebar: '#f6f6f4', symbol: '#3a3a37' },
  dark: { bg: '#1b1b1d', titlebar: '#151517', symbol: '#d6d6d6' }
}

export interface ApiHooks {
  googleSync: GoogleSync
  qboSync: QuickBooksSync
  updater: Updater
  sync: SyncService
  /** Current light/dark theme (for the quick capture box) */
  theme: () => 'light' | 'dark'
  backupDir: () => string
  /** Closes the database, puts the snapshot back and restarts Plannr */
  restoreAndRestart: (file: string) => Promise<void>
  profiles: PlannrApi['profiles']
}

const ASSISTANT_KEY: Record<AssistantProvider, string> = { anthropic: 'assistant.key', openai: 'assistant.openaiKey', gemini: 'assistant.geminiKey', groq: 'assistant.groqKey', ollama: 'assistant.ollamaKey' }
/** Services that speak OpenAI's Chat Completions (with tools) */
const OPENAI_STYLE: Partial<Record<AssistantProvider, { url: string; tokens: 'max_completion_tokens' | 'max_tokens'; name: string }>> = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', tokens: 'max_completion_tokens', name: 'ChatGPT' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', tokens: 'max_tokens', name: 'Gemini' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', tokens: 'max_completion_tokens', name: 'Groq' },
  ollama: { url: 'http://localhost:11434/v1/chat/completions', tokens: 'max_tokens', name: 'Ollama' }
}

export function createApi(db: Db, dataDir: string, getWindow: () => BrowserWindow | null, vaultSession: VaultSession, hooks: ApiHooks): PlannrApi {
  const assistantStatus = (): AssistantStatus => {
    const saved = getSetting(db, 'assistant.provider') as AssistantProvider | null
    // Chosen, else whichever paid key was set up first, else free Gemini
    const provider: AssistantProvider = saved && saved in ASSISTANT_KEY ? saved : getSecret<string>(db, 'assistant.key') ? 'anthropic' : getSecret<string>(db, 'assistant.openaiKey') ? 'openai' : 'gemini'
    const savedModel = getSetting(db, 'assistant.model') as string | null
    const model = savedModel && ASSISTANT_MODELS.some((m) => m.id === savedModel && m.provider === provider) ? savedModel : savedModel && getSetting(db, 'assistant.customModel') === provider ? savedModel : DEFAULT_ASSISTANT_MODEL[provider]
    return { provider, configured: provider === 'ollama' || Boolean(getSecret<string>(db, ASSISTANT_KEY[provider])), model }
  }
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
  const backupStatus = (): BackupStatus => ({
    dir: hooks.backupDir(),
    lastAt: (getSetting(db, 'lastBackupAt') as number | null) ?? null,
    error: (getSetting(db, 'backupError') as string | null) ?? null,
    backups: backups.listBackups(hooks.backupDir())
  })
  const core = createCoreApi(db, dataDir, { moneyChanged: () => hooks.qboSync.schedule(), calendarChanged: () => hooks.googleSync.schedule(), fetchText })
  return {
    ...core,
    files: {
      ...core.files,
      open: async (id) => {
        const file = resolveFilePath(db, dataDir, id)
        if (file) await shell.openPath(file.path)
      }
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
      ...core.money,
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
    packages: {
      ...core.packages,
      refresh: async () => {
        const key = getSecret<string>(db, 'track17.key')
        if (key) {
          try {
            await packageService.refreshTracking(db, key, async (url, body, headers) => {
              const res = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
              return res.json()
            })
            setSetting(db, 'track17.error', null)
          } catch (e) {
            setSetting(db, 'track17.error', e instanceof Error ? e.message : String(e))
          }
        }
        return packageService.listPackages(db)
      },
      trackingStatus: async () => ({ configured: Boolean(getSecret<string>(db, 'track17.key')), error: (getSetting(db, 'track17.error') as string | null) ?? null }),
      setTrackingKey: async (key) => {
        putSecret(db, 'track17.key', key?.trim() || null)
        setSetting(db, 'track17.error', null)
        return { configured: Boolean(key?.trim()), error: null }
      }
    },
    assistant: {
      status: async () => assistantStatus(),
      setup: async (input) => {
        if (input.provider) {
          setSetting(db, 'assistant.provider', input.provider)
          // A model of the other provider doesn't carry over
          if (!ASSISTANT_MODELS.some((m) => m.id === getSetting(db, 'assistant.model') && m.provider === input.provider)) setSetting(db, 'assistant.model', DEFAULT_ASSISTANT_MODEL[input.provider])
        }
        const provider = assistantStatus().provider
        if (input.key !== undefined) putSecret(db, ASSISTANT_KEY[provider], input.key?.trim() || null)
        if (input.model) {
          setSetting(db, 'assistant.model', input.model.trim())
          // a model name typed in (not one of the listed ones) belongs to this provider
          setSetting(db, 'assistant.customModel', ASSISTANT_MODELS.some((m) => m.id === input.model) ? null : provider)
        }
        return assistantStatus()
      },
      ask: async (messages) => {
        const { provider, model } = assistantStatus()
        const key = getSecret<string>(db, ASSISTANT_KEY[provider]) ?? (provider === 'ollama' ? 'ollama' : null)
        if (!key) throw new Error('Add your API key first (Setup).')
        const style = OPENAI_STYLE[provider]
        if (style)
          return assistantService.askOpenAI(
            db,
            model,
            messages,
            async (body) => {
              let res: Response
              try {
                res = await net.fetch(style.url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
              } catch {
                throw new Error(provider === 'ollama' ? 'Ollama isn’t running on this PC. Open the Ollama app (from ollama.com) and try again.' : `Couldn’t reach ${style.name}. Check the internet connection.`)
              }
              const json = (await res.json().catch(() => ({}))) as Awaited<ReturnType<assistantService.PostOpenAI>> | Awaited<ReturnType<assistantService.PostOpenAI>>[]
              const one = Array.isArray(json) ? json[0] : json // Gemini wraps errors in a list
              if (!res.ok) throw new Error(one?.error?.message ?? `${style.name} answered ${res.status}`)
              return one
            },
            getBusiness(db).name,
            style.tokens
          )
        return assistantService.ask(
          db,
          model,
          messages,
          async (body) => {
            const res = await net.fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
              body: JSON.stringify(body)
            })
            const json = (await res.json().catch(() => ({}))) as Awaited<ReturnType<assistantService.PostMessages>>
            if (!res.ok) throw new Error(json.error?.message ?? `The assistant service answered ${res.status}`)
            return json
          },
          getBusiness(db).name
        )
      }
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
      message: async (folderId, messageId) => zoho.message(db, folderId, messageId),
      inbox: async () => zoho.inbox(db)
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
    print: {
      // Tests write the page to a file instead of opening the print dialog.
      ticket: async (id, kind) => printTicket(db, dataDir, id, kind, process.env.PLANNR_DATA_DIR ? join(dataDir, 'last-print.html') : undefined)
    },
    data: {
      exportAll: async (folder) => {
        let out = folder
        if (!out) {
          const win = getWindow()
          const options = { title: 'Choose where to save the export', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
          const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
          if (r.canceled || !r.filePaths[0]) return null
          out = r.filePaths[0]
        }
        return exportAll(db, dataDir, out)
      },
      importContacts: async (file) => {
        let path = file
        if (!path) {
          const win = getWindow()
          const options = { title: 'Choose a CSV file of contacts', properties: ['openFile'] as 'openFile'[], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] }
          const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
          if (r.canceled || !r.filePaths[0]) return null
          path = r.filePaths[0]
        }
        return moneyChanged(importContacts(db, readFileSync(path, 'utf8')))
      },
      openFolder: async (folder) => {
        await shell.openPath(folder)
      }
    },
    sync: {
      status: async () => hooks.sync.status(),
      setup: async (server, setupCode) => hooks.sync.setup(server, setupCode),
      join: async (link) => {
        const status = await hooks.sync.join(link)
        getWindow()?.webContents.send('data-changed')
        return status
      },
      link: async () => {
        // Named after the open profile, so a phone with several profiles knows which one this is.
        const { active, profiles } = await hooks.profiles.list()
        const profile = profiles.find((p) => p.id === active)
        return hooks.sync.link(profile)
      },
      syncNow: async () => hooks.sync.syncNow(),
      disconnect: async () => hooks.sync.disconnect()
    },
    profiles: hooks.profiles,
    updates: {
      status: async () => hooks.updater.status,
      check: async () => hooks.updater.check(),
      install: async () => hooks.updater.install()
    },
    app: {
      info: async () => ({ version: app.getVersion(), dataDir, tests: Boolean(process.env.PLANNR_DATA_DIR) && process.env.PLANNR_ONBOARDING !== '1', web: false }),
      openDataFolder: async () => {
        await shell.openPath(dataDir)
      },
      printPage: async () => {
        await new Promise<void>((resolve) => getWindow()?.webContents.print({ silent: false, printBackground: true }, () => resolve()) ?? resolve())
      },
      setTheme: async (theme, colors) => {
        const win = getWindow()
        if (!win) return
        const hex = /^#[0-9a-f]{3,8}$/i
        const c = colors && hex.test(colors.bg) && hex.test(colors.titlebar) && hex.test(colors.symbol) ? colors : themeColors[theme]
        win.setBackgroundColor(c.bg)
        win.setTitleBarOverlay({ color: c.titlebar, symbolColor: c.symbol, height: Math.round(TITLEBAR_HEIGHT * win.webContents.getZoomFactor()) })
      },
      openCapture: async () => openCapture(hooks.theme),
      closeCapture: async () => hideCapture(),
      captureSaved: async () => {
        getWindow()?.webContents.send('data-changed')
      },
      setCaptureShortcut: async (shortcut) => {
        setSetting(db, 'captureShortcut', shortcut)
        return registerCaptureShortcut(db, hooks.theme)
      },
      getCaptureShortcut: async () => (getSetting(db, 'captureShortcut') as string | null) ?? DEFAULT_CAPTURE_SHORTCUT,
      setZoom: async (factor) => {
        const f = Math.max(0.8, Math.min(1.4, Number(factor) || 1))
        setSetting(db, 'zoom', f)
        const win = getWindow()
        if (!win) return
        win.webContents.setZoomFactor(f)
        win.setTitleBarOverlay({ height: Math.round(TITLEBAR_HEIGHT * f) }) // the window buttons line up with the bigger title bar
      },
      getZoom: async () => Number(getSetting(db, 'zoom')) || 1,
      getOpenAtLogin: async () => getOpenAtLogin(),
      setOpenAtLogin: async (enabled) => setOpenAtLogin(enabled),
      testNotification: async () => {
        if (!Notification.isSupported()) return false
        // Tests don't put real notifications on the screen (except the background check, PLANNR_BACKGROUND=1)
        if (process.env.PLANNR_DATA_DIR && process.env.PLANNR_BACKGROUND !== '1') return true
        new Notification({ title: 'Notifications are working', body: 'Plannr will remind you like this. Click a reminder to open what it is about.', icon: resourcePath('icon.png') }).show()
        return true
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

/** Saved copies of real news sources, for tests (PLANNR_NEWS_FIXTURES = the folder) */
const NEWS_FIXTURES: [RegExp, string][] = [
  [/api\.tvmaze\.com\/search/, 'tvmaze-search.json'],
  [/api\.tvmaze\.com\/shows/, 'tvmaze-show.json'],
  [/media-imdb\.com/, 'imdb.json'],
  [/openlibrary\.org/, 'openlibrary.json'],
  [/cheapshark\.com\/api\/1\.0\/games/, 'cheapshark-games.json'],
  [/itunes\.apple\.com/, 'itunes-podcasts.json'],
  [/darknetdiaries/, 'podcast.xml'],
  [/reddit\.com\/r\/pcmasterrace/, 'reddit.xml'],
  [/castanet.net/, 'castanet.xml'],
  [/news.google.com/, 'google.xml'],
  [/open511/, 'roads.json'],
  [/weather.gc.ca/, 'weather.xml'],
  [/geocoding-api/, 'geocode.json'],
  [/osoyoos.ca/, 'town-news.html'],
  [/bapcsales|buildapcsales/, 'bapcsales.xml'],
  [/redflagdeals/, 'rfd.xml'],
  [/cheapshark/, 'cheapshark.json'],
  [/epicgames/, 'epic.json'],
  [/gematsu/, 'gematsu.xml'],
  [/techpowerup/, 'techpowerup.xml'],
  [/youtube\.com\/feeds/, 'yt-feed.xml'],
  [/youtube\.com/, 'yt-channel.html'],
  [/twitch\.tv\/shroud/, 'twitch-live.html'],
  [/twitch\.tv/, 'twitch-offline.html'],
  [/api\.open-meteo\.com/, 'forecast.json']
]

/**
 * Downloads text (holiday calendars, news). Tests never use the internet: PLANNR_HOLIDAY_FIXTURE is a saved
 * holiday feed and PLANNR_NEWS_FIXTURES a folder of saved news sources.
 */
export async function fetchText(url: string): Promise<string> {
  const holidayFixture = process.env.PLANNR_HOLIDAY_FIXTURE
  if (holidayFixture && url.includes('calendar.google.com')) return readFileSync(holidayFixture, 'utf8')
  const newsFixtures = process.env.PLANNR_NEWS_FIXTURES
  if (newsFixtures) {
    const hit = NEWS_FIXTURES.find(([re]) => re.test(url))
    if (!hit) throw new Error('Offline (test)')
    return readFileSync(join(newsFixtures, hit[1]), 'utf8')
  }
  if (holidayFixture) throw new Error('Offline (test)')
  // Some services (e.g. CheapShark) want to know which app is asking
  const res = await net.fetch(url, { headers: { 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Plannr/${app.getVersion()} (+https://github.com/GLr-P/plannr)` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
