import { app, BrowserWindow, nativeTheme, net, Notification, powerMonitor, protocol, shell } from 'electron'
import { VaultSession } from './vault-session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDb, type Db } from './db'
import { createApi, fetchText, registerIpc, themeColors, TITLEBAR_HEIGHT } from './api'
import { holidaysStale, refreshHolidays } from './services/holidays'
import { getSetting, setSetting } from './services/settings'
import { resolveFilePath } from './services/files'
import { ensureStarterTemplate } from './services/templates'
import { ensureSearchIndex } from './services/reindex'
import type { Theme, ThemePref } from '../shared/api'
import { APP_ID, createTray, ensureStartMenuShortcut, resourcePath, showWindow, startReminders } from './background'

// PLANNR_DATA_DIR isolates data (used by automated tests); otherwise %APPDATA%\Plannr\data.
const dataDir = process.env.PLANNR_DATA_DIR ?? join(app.getPath('userData'), 'data')
const isTest = Boolean(process.env.PLANNR_DATA_DIR)
// Tray, close-to-tray and reminders. Off in tests; PLANNR_BACKGROUND=1 turns them on to verify real notifications.
const background = !isTest || process.env.PLANNR_BACKGROUND === '1'
if (isTest) app.setPath('userData', join(dataDir, '.electron'))
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
// Started with Windows (login item): stay in the tray until opened.
const startHidden = process.argv.includes('--hidden')
mkdirSync(dataDir, { recursive: true })

protocol.registerSchemesAsPrivileged([
  { scheme: 'plannr', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let db: Db
let mainWindow: BrowserWindow | null = null
let quitting = false
let vaultSession: VaultSession | null = null
const getWindow = (): BrowserWindow | null => mainWindow

function quit(): void {
  quitting = true
  app.quit()
}

function effectiveTheme(): Theme {
  const pref = (getSetting(db, 'theme') as ThemePref | null) ?? 'system'
  if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return pref
}

function createWindow(): void {
  const theme = effectiveTheme()
  const colors = themeColors[theme]
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Plannr',
    icon: resourcePath('icon.png'),
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.titlebar, symbolColor: colors.symbol, height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })
  // Closing the window keeps Plannr running in the tray so reminders still fire (unless turned off in Settings).
  mainWindow.on('close', (event) => {
    if (quitting || !background || getSetting(db, 'runInBackground') === false) return
    event.preventDefault()
    mainWindow?.hide()
    vaultSession?.lock() // hidden in the tray = locked
    if (!getSetting(db, 'trayHintShown') && Notification.isSupported()) {
      new Notification({ title: 'Plannr is still running', body: 'It stays in the tray so reminders can pop up. Right-click the tray icon to quit.', icon: resourcePath('icon.png') }).show()
      setSetting(db, 'trayHintShown', true)
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))

  // Keep the app on its own page; open web links in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  const query = { theme }
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?theme=${theme}`)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow(getWindow))
  app.on('before-quit', () => {
    quitting = true
    vaultSession?.clearClipboardNow() // don't leave a copied password behind
  })

  app.whenReady().then(() => {
    db = openDb(join(dataDir, 'plannr.db'))
    ensureStarterTemplate(db)
    ensureSearchIndex(db)

    // plannr://file/<id> serves stored attachments (images in notes, ticket photos…).
    protocol.handle('plannr', (request) => {
      const url = new URL(request.url)
      const file = url.hostname === 'file' ? resolveFilePath(db, dataDir, url.pathname.slice(1)) : null
      if (!file) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(file.path).toString())
    })

    vaultSession = new VaultSession(db, () => mainWindow?.webContents.send('vault-locked'))
    powerMonitor.on('lock-screen', () => vaultSession?.lock())
    powerMonitor.on('suspend', () => vaultSession?.lock())
    registerIpc(createApi(db, dataDir, getWindow, vaultSession))
    createWindow()
    // Keep holidays fresh (weekly). Tests only do this when given a saved feed (no internet in tests).
    if (!isTest || process.env.PLANNR_HOLIDAY_FIXTURE) {
      const updateHolidays = (): void => {
        if (holidaysStale(db)) void refreshHolidays(db, fetchText)
      }
      updateHolidays()
      setInterval(updateHolidays, 6 * 60 * 60 * 1000)
    }
    if (background) {
      createTray(getWindow, quit)
      startReminders(db, getWindow)
      ensureStartMenuShortcut()
    }
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => db?.close())
}
