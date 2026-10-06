import { app, BrowserWindow } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PrintKind } from '../shared/api'
import type { Db } from './db'
import { getBusiness, ticketPrintHtml } from './services/print'

export { getBusiness }

/**
 * Opens the Windows print dialog for a ticket printout (pick a printer, or "Microsoft Print to PDF").
 * In automated tests (`testOut` set) the page is written to that file instead, so it can be checked.
 */
export async function printTicket(db: Db, dataDir: string, id: string, kind: PrintKind, testOut?: string): Promise<void> {
  const html = ticketPrintHtml(db, dataDir, id, kind)
  if (testOut) return writeFileSync(testOut, html)

  const file = join(app.getPath('temp'), `plannr-print-${process.pid}.html`)
  writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await win.loadFile(file)
    await new Promise<void>((resolve, reject) =>
      win.webContents.print({ silent: false, printBackground: true }, (ok, reason) =>
        ok || /cancel/i.test(reason) ? resolve() : reject(new Error(`Couldn’t print: ${reason}`))
      )
    )
  } finally {
    win.destroy()
    rmSync(file, { force: true })
  }
}
