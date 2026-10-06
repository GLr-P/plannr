import { execFileSync } from 'node:child_process'
import { app, BrowserWindow, Menu, nativeImage, Notification, powerMonitor, shell, Tray } from 'electron'
import { join } from 'node:path'
import type { Db } from './db'
import { dueMoneyReminders, dueReminders, markReminderFired } from './services/reminders'
import { dueTaskReminders } from './services/tasks'
import { openCapture } from './capture'
import { processAutopay } from './services/money'
import type { NavigateTarget } from '../shared/api'

export const APP_ID = 'com.nanotechservices.plannr'

/** resources/ lives next to package.json in development, and in the app's resources folder when installed. */
export const resourcePath = (file: string): string =>
  app.isPackaged ? join(process.resourcesPath, 'resources', file) : join(app.getAppPath(), 'resources', file)

export type { NavigateTarget }

export function showWindow(getWindow: () => BrowserWindow | null, target?: NavigateTarget): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (target) win.webContents.send('navigate', target)
}

// ---------- Tray ----------

let tray: Tray | null = null

/** The profiles for the tray's "Switch profile" menu (only shown when there are two or more). */
export interface TrayProfiles {
  list: () => { id: string; name: string; active: boolean }[]
  pick: (id: string) => void
}

export function createTray(getWindow: () => BrowserWindow | null, quit: () => void, theme: () => 'light' | 'dark', profiles?: TrayProfiles): () => void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  const build = (): void => {
    const list = profiles?.list() ?? []
    const active = list.find((b) => b.active)
    tray?.setToolTip(list.length > 1 && active ? `Plannr · ${active.name}` : 'Plannr')
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Plannr', click: () => showWindow(getWindow) },
        { label: 'Quick capture', click: () => openCapture(theme) },
        ...(list.length > 1
          ? [
              {
                label: 'Switch profile',
                submenu: list.map((b) => ({ label: b.name, type: 'radio' as const, checked: b.active, click: () => profiles?.pick(b.id) }))
              }
            ]
          : []),
        { type: 'separator' },
        { label: 'Quit Plannr', click: quit }
      ])
    )
  }
  build()
  tray.on('click', () => showWindow(getWindow))
  return build
}

// ---------- Reminders ----------

/** A profile whose reminders are checked: the open one, and the others (labelled, and clicking switches to them). */
export interface ReminderSource {
  db: Db
  /** The profile name, for profiles that aren't open */
  label?: string
  open: (target: NavigateTarget) => void
}

/** Checks every minute (and on wake from sleep) for reminders that are due and shows Windows notifications. */
export function startReminders(sources: () => ReminderSource[]): () => void {
  const notify = (source: ReminderSource, title: string, body: string, target: NavigateTarget): void => {
    const n = new Notification({ title: source.label ? `${source.label} · ${title}` : title, body, icon: resourcePath('icon.png') })
    n.on('click', () => source.open(target))
    n.show()
  }
  const checkOne = (source: ReminderSource): void => {
    const { db } = source
    // Bill/subscription reminders first (auto-pay below moves due dates forward once charged).
    for (const r of dueMoneyReminders(db)) {
      markReminderFired(db, r.recurringId, r.key)
      notify(source, r.title, r.body, { money: r.recurringId })
    }
    processAutopay(db)
    for (const r of dueTaskReminders(db)) {
      markReminderFired(db, r.taskId, r.key)
      notify(source, r.title, r.body, { tasks: true })
    }
    for (const r of dueReminders(db)) {
      markReminderFired(db, r.eventId, r.key) // mark first: never repeat, even if showing fails
      notify(source, r.title, r.body, r.linkType && r.linkId ? { type: r.linkType, id: r.linkId } : { calendarDate: r.date })
    }
  }
  const check = (): void => {
    if (!Notification.isSupported()) return
    for (const source of sources()) {
      try {
        checkOne(source)
      } catch {
        // one profile's problem (e.g. its folder was removed) mustn't stop the others' reminders
      }
    }
  }
  check()
  const timer = setInterval(check, 60_000)
  powerMonitor.on('resume', check)
  return () => clearInterval(timer)
}

// ---------- Windows integration ----------

/**
 * Windows only shows notifications for apps with a Start menu shortcut carrying the app's ID.
 * Until the installer exists (phase 7) we create that shortcut ourselves; it also puts Plannr in the Start menu.
 */
export function ensureStartMenuShortcut(): void {
  if (process.platform !== 'win32' || app.isPackaged) return
  const lnk = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Plannr.lnk')
  const options = {
    target: process.execPath,
    args: `"${app.getAppPath()}"`,
    cwd: app.getAppPath(),
    icon: resourcePath('icon.ico'),
    iconIndex: 0,
    appUserModelId: APP_ID,
    description: 'Plannr'
  }
  shell.writeShortcutLink(lnk, 'replace', options)
  // Keep the Desktop shortcut's icon in sync too, if it exists.
  const desktop = join(app.getPath('desktop'), 'Plannr.lnk')
  try {
    shell.readShortcutLink(desktop)
    shell.writeShortcutLink(desktop, 'replace', options)
  } catch {
    // no desktop shortcut — fine
  }
}

const loginItem = () =>
  app.isPackaged
    ? { path: process.execPath, args: ['--hidden'] }
    : { path: process.execPath, args: [app.getAppPath(), '--hidden'] }

export const getOpenAtLogin = (): boolean => app.getLoginItemSettings(loginItem()).openAtLogin

export function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItem() })
}

/**
 * "Start with Windows" was turned on in another copy of Plannr (e.g. the one run from source before installing):
 * the installed app takes the entry over, so Windows starts this copy instead.
 */
export function adoptLoginItem(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  if (app.getLoginItemSettings(loginItem()).openAtLogin) return
  // Electron only reports entries that point at this exe, so look in the Run key directly.
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', APP_ID], { encoding: 'utf8', windowsHide: true })
    if (out.includes(APP_ID)) setOpenAtLogin(true)
  } catch {
    // no entry: this PC isn't set to start Plannr with Windows
  }
}
