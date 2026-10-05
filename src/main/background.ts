import { app, BrowserWindow, Menu, nativeImage, Notification, powerMonitor, shell, Tray } from 'electron'
import { join } from 'node:path'
import type { Db } from './db'
import { dueMoneyReminders, dueReminders, markReminderFired } from './services/reminders'
import { processAutopay } from './services/money'
import type { EntityType } from '../shared/api'

export const APP_ID = 'com.nanotechservices.plannr'

/** resources/ lives next to package.json in development, and in the app's resources folder when installed. */
export const resourcePath = (file: string): string =>
  app.isPackaged ? join(process.resourcesPath, 'resources', file) : join(app.getAppPath(), 'resources', file)

/** Asks the window to show something (used by notifications). */
export type NavigateTarget = { type: EntityType; id: string } | { calendarDate: string } | { money: string }

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

export function createTray(getWindow: () => BrowserWindow | null, quit: () => void): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip('Plannr')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Plannr', click: () => showWindow(getWindow) },
      { type: 'separator' },
      { label: 'Quit Plannr', click: quit }
    ])
  )
  tray.on('click', () => showWindow(getWindow))
}

// ---------- Reminders ----------

/** Checks every minute (and on wake from sleep) for reminders that are due and shows Windows notifications. */
export function startReminders(db: Db, getWindow: () => BrowserWindow | null): () => void {
  const check = (): void => {
    if (!Notification.isSupported()) return
    // Bill/subscription reminders first (auto-pay below moves due dates forward once charged).
    for (const r of dueMoneyReminders(db)) {
      markReminderFired(db, r.recurringId, r.key)
      const n = new Notification({ title: r.title, body: r.body, icon: resourcePath('icon.png') })
      n.on('click', () => showWindow(getWindow, { money: r.recurringId }))
      n.show()
    }
    processAutopay(db)
    for (const r of dueReminders(db)) {
      markReminderFired(db, r.eventId, r.key) // mark first: never repeat, even if showing fails
      const n = new Notification({ title: r.title, body: r.body, icon: resourcePath('icon.png') })
      n.on('click', () =>
        showWindow(getWindow, r.linkType && r.linkId ? { type: r.linkType, id: r.linkId } : { calendarDate: r.date })
      )
      n.show()
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
