import { app, BrowserWindow, nativeTheme, net, protocol, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDb, type Db } from './db'
import { createApi, registerIpc, themeColors, TITLEBAR_HEIGHT } from './api'
import { getSetting } from './services/settings'
import { resolveFilePath } from './services/files'
import { ensureStarterTemplate } from './services/templates'
import { ensureSearchIndex } from './services/reindex'
import type { Theme, ThemePref } from '../shared/api'

// PLANNR_DATA_DIR isolates data (used by automated tests); otherwise %APPDATA%\Plannr\data.
const dataDir = process.env.PLANNR_DATA_DIR ?? join(app.getPath('userData'), 'data')
if (process.env.PLANNR_DATA_DIR) app.setPath('userData', join(dataDir, '.electron'))
mkdirSync(dataDir, { recursive: true })

protocol.registerSchemesAsPrivileged([
  { scheme: 'plannr', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let db: Db
let mainWindow: BrowserWindow | null = null

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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
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
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
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

    registerIpc(createApi(db, dataDir, () => mainWindow))
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => db?.close())
}
