import { app, BrowserWindow } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BusinessInfo, PrintKind } from '../shared/api'
import type { Db } from './db'
import { resolveFilePath } from './services/files'
import { getCustomer } from './services/customers'
import { listTransactions } from './services/money'
import { DEFAULT_BUSINESS, printHtml } from './services/print'
import { getSetting } from './services/settings'
import { getTicket } from './services/tickets'

export const getBusiness = (db: Db): BusinessInfo => ({ ...DEFAULT_BUSINESS, ...((getSetting(db, 'business') as Partial<BusinessInfo> | null) ?? {}) })

function logoDataUrl(db: Db, dataDir: string, id: string | null): string | null {
  const file = id ? resolveFilePath(db, dataDir, id) : null
  if (!file) return null
  try {
    return `data:${file.mime};base64,${readFileSync(file.path).toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Opens the Windows print dialog for a ticket printout (pick a printer, or "Microsoft Print to PDF").
 * In automated tests (`testOut` set) the page is written to that file instead, so it can be checked.
 */
export async function printTicket(db: Db, dataDir: string, id: string, kind: PrintKind, testOut?: string): Promise<void> {
  const ticket = getTicket(db, id)
  if (!ticket) throw new Error('Ticket not found')
  const business = getBusiness(db)
  const html = printHtml(kind, {
    ticket,
    customer: ticket.customerId ? getCustomer(db, ticket.customerId) : null,
    payments: listTransactions(db, { ticketId: id, type: 'income' }).reverse(), // oldest first
    business,
    logo: logoDataUrl(db, dataDir, business.logoFileId)
  })
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
