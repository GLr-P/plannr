import { BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import type { Db } from './db'
import { getSetting } from './services/settings'

/*
 * Quick capture: a global shortcut (Ctrl+Shift+Space by default) opens a small box over whatever you're doing,
 * to jot a note or a task without opening Plannr. The box is one window, hidden and shown again.
 */

export const CAPTURE_SHORTCUTS = ['Ctrl+Shift+Space', 'Ctrl+Alt+N', 'Ctrl+Shift+J'] as const
export const DEFAULT_CAPTURE_SHORTCUT = 'Ctrl+Shift+Space'

let win: BrowserWindow | null = null
let registered: string | null = null

function captureWindow(theme: () => 'light' | 'dark'): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 520,
    height: 216,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    title: 'Quick capture',
    backgroundColor: theme() === 'dark' ? '#242427' : '#ffffff',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const query = { capture: '1', theme: theme() }
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?capture=1&theme=${query.theme}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  win.on('blur', () => win?.hide()) // clicking away puts it away, like Windows' own pop-ups
  return win
}

/** Shows the box in the middle of the screen the mouse is on. */
export function openCapture(theme: () => 'light' | 'dark'): void {
  const w = captureWindow(theme)
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const [bw, bh] = w.getSize()
  w.setPosition(Math.round(x + (width - bw) / 2), Math.round(y + height * 0.28 - bh / 2))
  const show = (): void => {
    w.show()
    w.focus()
    w.webContents.send('capture-open')
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show)
  else show()
}

export const hideCapture = (): void => win?.hide()

/** (Re)registers the global shortcut from Settings ('off' turns it off). Returns false if another app has it. */
export function registerCaptureShortcut(db: Db, theme: () => 'light' | 'dark'): boolean {
  if (registered) globalShortcut.unregister(registered.replace('Ctrl', 'CommandOrControl'))
  registered = null
  const chosen = (getSetting(db, 'captureShortcut') as string | null) ?? DEFAULT_CAPTURE_SHORTCUT
  if (chosen === 'off') return true
  const accel = chosen.replace('Ctrl', 'CommandOrControl')
  const ok = globalShortcut.register(accel, () => openCapture(theme))
  if (ok) registered = chosen
  return ok
}
