import { app, BrowserWindow, nativeTheme, net, Notification, powerMonitor, protocol, shell } from 'electron'
import { VaultSession } from './vault-session'
import { GoogleSync } from './google-sync'
import { QuickBooksSync } from './quickbooks-sync'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDb, type Db } from './db'
import { createApi, fetchText, registerIpc, themeColors, TITLEBAR_HEIGHT } from './api'
import { holidaysStale, refreshHolidays } from './services/holidays'
import { backupDue, restoreSnapshot, runBackup } from './services/backup'
import { getSetting, setSetting } from './services/settings'
import { mkdirSync as ensureDir } from 'node:fs'
import { resolveFilePath } from './services/files'
import { ensureStarterTemplate } from './services/templates'
import { ensureStarterNoteTemplates } from './services/note-templates'
import { loadDisplayPrefs, pinLegacyPrefix } from './display'
import { ensureOnboardingState } from './services/onboarding'
import { ensureSearchIndex } from './services/reindex'
import type { NavigateTarget, Theme, ThemePref } from '../shared/api'
import { adoptLoginItem, APP_ID, createTray, ensureStartMenuShortcut, resourcePath, showWindow, startReminders } from './background'
import { Updater } from './updater'
import { registerCaptureShortcut } from './capture'
import { SyncService } from './sync/service'
import { getSecret, putSecret } from './secrets'
import { ProfileManager } from './profile-manager'
import { MAIN_PROFILE, saveRegistry } from './profiles'

// PLANNR_DATA_DIR isolates data (used by automated tests); otherwise %APPDATA%\Plannr\data.
// That folder is the first profile; other profiles have their own folders inside it (see profiles.ts).
const baseDir = process.env.PLANNR_DATA_DIR ?? join(app.getPath('userData'), 'data')
const isTest = Boolean(process.env.PLANNR_DATA_DIR)
// Switching profile restarts Plannr in the other one (tests start the app again themselves).
const profiles = new ProfileManager(baseDir, () => {
  quitting = true
  vaultSession?.lock()
  vaultSession?.clearClipboardNow()
  vaultSession?.cleanTemp()
  db?.close()
  if (!isTest) app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') })
  app.exit(0)
}, isTest ? async (dir) => rmSync(dir, { recursive: true, force: true }) : undefined)
const dataDir = profiles.dir
// Tray, close-to-tray and reminders. Off in tests; PLANNR_BACKGROUND=1 turns them on to verify real notifications.
const background = !isTest || process.env.PLANNR_BACKGROUND === '1'
if (isTest) app.setPath('userData', join(baseDir, '.electron'))
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
// Started with Windows (login item): stay in the tray until opened.
const startHidden = process.argv.includes('--hidden')
mkdirSync(dataDir, { recursive: true })
// Shown after a switch (e.g. the item a notification was about), once.
const startNavigate = profiles.registry.navigate

protocol.registerSchemesAsPrivileged([
  { scheme: 'plannr', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // Vault files, decrypted in memory on request; only works while the vault is unlocked.
  { scheme: 'plannr-vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
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
  const zoom = Math.max(0.8, Math.min(1.4, Number(getSetting(db, 'zoom')) || 1))
  // After switching profile the window comes back where it was.
  const bounds = profiles.registry.window
  const several = profiles.registry.profiles.length > 1
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1320,
    height: bounds?.height ?? 860,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: several ? `Plannr · ${profiles.active.name}` : 'Plannr',
    icon: resourcePath('icon.png'),
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.titlebar, symbolColor: colors.symbol, height: Math.round(TITLEBAR_HEIGHT * zoom) },
    webPreferences: {
      zoomFactor: zoom, // text size from Settings
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      plugins: true // Chromium's built-in PDF viewer, for previewing vault PDFs
    }
  })
  mainWindow.once('ready-to-show', () => {
    if (bounds?.maximized) mainWindow?.maximize()
    if (!startHidden) mainWindow?.show()
  })
  if (bounds || startNavigate) {
    delete profiles.registry.window
    delete profiles.registry.navigate
    saveRegistry(baseDir, profiles.registry) // used once
  }
  // Remembered so a switch can put the window back.
  const remember = (): void => {
    if (!mainWindow || mainWindow.isMinimized()) return
    profiles.registry.window = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }
  }
  mainWindow.on('resize', remember)
  mainWindow.on('move', remember)
  mainWindow.on('maximize', remember)
  mainWindow.on('unmaximize', remember)
  remember()
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
  mainWindow.on('page-title-updated', (event) => event.preventDefault()) // the title names the open profile

  // Keep the app on its own page; open web links in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  // The profile (its own remembered layout) and anything to show after a switch.
  const query: Record<string, string> = { theme, profile: profiles.registry.active }
  if (startNavigate) query.navigate = JSON.stringify(startNavigate)
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
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
    vaultSession?.cleanTemp() // nor decrypted copies of vault files
  })

  app.whenReady().then(() => {
    db = openDb(join(dataDir, 'plannr.db'))
    profiles.adoptName(db)
    pinLegacyPrefix(db)
    loadDisplayPrefs(db)
    ensureOnboardingState(db)
    ensureStarterTemplate(db)
    ensureStarterNoteTemplates(db)
    ensureSearchIndex(db)

    // plannr://file/<id> serves stored attachments (images in notes, ticket photos…).
    protocol.handle('plannr', (request) => {
      const url = new URL(request.url)
      const file = url.hostname === 'file' ? resolveFilePath(db, dataDir, url.pathname.slice(1)) : null
      if (!file) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(file.path).toString())
    })

    vaultSession = new VaultSession(db, dataDir, () => mainWindow?.webContents.send('vault-locked'))
    powerMonitor.on('lock-screen', () => vaultSession?.lock())
    powerMonitor.on('suspend', () => vaultSession?.lock())
    protocol.handle('plannr-vault', (request) => {
      const url = new URL(request.url)
      const file = url.hostname === 'file' ? vaultSession?.readFile(url.pathname.split('/')[1] ?? '') : null
      if (!file) return new Response('Locked or not found', { status: 404 })
      return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': file.mime, 'Cache-Control': 'no-store' } })
    })
    // Backups go to Documents\Plannr Backups unless another folder was chosen (tests keep them inside their data folder).
    // Other profiles get their own folder (Plannr Backups\<name>), fixed when first opened, so backups never mix.
    if (!isTest && profiles.registry.active !== MAIN_PROFILE && !getSetting(db, 'backupDir')) {
      const safe = profiles.active.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || profiles.active.id
      const folder = ['snapshots', 'files'].includes(safe.toLowerCase()) ? safe + ' profile' : safe
      setSetting(db, 'backupDir', join(app.getPath('documents'), 'Plannr Backups', folder))
    }
    const backupDir = (): string => {
      const chosen = getSetting(db, 'backupDir')
      return typeof chosen === 'string' && chosen ? chosen : isTest ? join(dataDir, 'backups') : join(app.getPath('documents'), 'Plannr Backups')
    }
    const restoreAndRestart = async (file: string): Promise<void> => {
      const dir = backupDir() // read before closing the database
      vaultSession?.lock()
      db.close()
      restoreSnapshot(dataDir, dir, file)
      quitting = true
      if (!isTest) app.relaunch() // tests start the app again themselves
      app.exit(0)
    }
    // Google Calendar sync (only does anything once connected). The calendar refreshes when a sync brings changes.
    const googleSync = new GoogleSync(db, () => mainWindow?.webContents.send('calendar-changed'))
    if (!isTest) googleSync.start()
    // QuickBooks: customers, ticket payments and expenses (only once connected and set up).
    const qboSync = new QuickBooksSync(db)
    if (!isTest) qboSync.start()
    // Updates from GitHub Releases (tests point PLANNR_UPDATE_URL at a local server and never run the installer).
    const updater = new Updater(getWindow, quit, isTest ? join(dataDir, 'update-ready.json') : undefined)
    if (!isTest) updater.start(db)
    // Sync with your other devices (phone, second PC) through your own sync server, once turned on in Settings.
    const sync = new SyncService(db, dataDir, (touched) => {
      const win = getWindow()
      win?.webContents.send('data-changed')
      if (touched.has('events')) {
        win?.webContents.send('calendar-changed')
        googleSync.schedule()
      }
      if (touched.has('transactions') || touched.has('customers') || touched.has('tickets')) qboSync.schedule()
    }, {
      fetch: (url, init) => net.fetch(url, init),
      // The sync key is encrypted with Windows (only this account on this PC can read it).
      getKey: () => getSecret<string>(db, 'sync.key'),
      putKey: (key) => putSecret(db, 'sync.key', key)
    })
    void sync.start()
    app.on('browser-window-focus', () => sync.poke())
    let refreshTray = (): void => undefined
    registerIpc(
      createApi(db, dataDir, getWindow, vaultSession, {
        backupDir,
        restoreAndRestart,
        googleSync,
        qboSync,
        updater,
        sync,
        theme: effectiveTheme,
        profiles: {
          list: async () => profiles.state(),
          add: async (name, color) => {
            const p = profiles.add(name, color)
            mainWindow?.setTitle(`Plannr · ${profiles.active.name}`)
            refreshTray()
            return p
          },
          update: async (id, patch) => {
            const p = profiles.update(id, patch)
            if (id === profiles.registry.active) mainWindow?.setTitle(`Plannr · ${p.name}`)
            refreshTray()
            return p
          },
          remove: async (id) => {
            await profiles.remove(id)
            refreshTray()
          },
          switch: async (id, navigate) => {
            if (id !== profiles.registry.active) profiles.switchTo(id, navigate)
          },
          copyNote: async (noteId, targetId, move) => profiles.copyNote({ db, dir: dataDir }, noteId, targetId, move)
        }
      })
    )
    // Daily automatic backup (checked hourly; runs when the last one is ~a day old).
    if (!isTest) {
      const autoBackup = (): void => {
        if (!backupDue(db)) return
        try {
          ensureDir(backupDir(), { recursive: true })
        } catch {
          // folder unavailable (e.g. USB drive unplugged): runBackup records the error for Settings
        }
        void runBackup(db, dataDir, backupDir()).catch(() => undefined)
      }
      setTimeout(autoBackup, 30_000) // shortly after start, so opening Plannr stays fast
      setInterval(autoBackup, 60 * 60 * 1000)
    }
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
      refreshTray = createTray(getWindow, quit, effectiveTheme, {
        list: () => profiles.registry.profiles.map((p) => ({ id: p.id, name: p.name, active: p.id === profiles.registry.active })),
        pick: (id) => {
          if (id !== profiles.registry.active) profiles.switchTo(id)
        }
      })
      // Reminders for every profile, not just the open one; clicking another profile's reminder switches to it.
      startReminders(() => [
        { db, open: (target) => showWindow(getWindow, target) },
        ...profiles.otherProfiles().map((b) => ({
          db: b.db,
          label: b.profile.name,
          open: (target: NavigateTarget) => profiles.switchTo(b.profile.id, target)
        }))
      ])
      ensureStartMenuShortcut()
      adoptLoginItem()
      registerCaptureShortcut(db, effectiveTheme) // quick capture from anywhere (Ctrl+Shift+Space)
    }
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    profiles.closeAll()
    db?.close()
  })
}
