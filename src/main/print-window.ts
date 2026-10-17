import { app, BrowserWindow, dialog, type WebContents } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRINT_MARGIN_MM, type PrintJob, type PrintKind } from '../shared/api'
import type { Db } from './db'
import { getBusiness, ticketPrintHtml } from './services/print'
import { withPageSetup } from './services/print-form'

export { getBusiness }

const PAPER = { letter: 'Letter', legal: 'Legal', a4: 'A4' } as const

/** A ticket printout with the paper chosen in the preview (the label keeps its own size) */
const ticketHtml = (db: Db, dataDir: string, job: PrintJob): string => withPageSetup(ticketPrintHtml(db, dataDir, job.ticket!.id, job.ticket!.kind), job)

/** Runs `fn` on the page to print: a hidden window with the ticket printout, or the app window (its print styles show only the note) */
async function onPage<T>(db: Db, dataDir: string, window: BrowserWindow | null, job: PrintJob, fn: (page: WebContents) => Promise<T>): Promise<T> {
  if (!job.ticket) {
    if (!window) throw new Error('Nothing to print')
    return fn(window.webContents)
  }
  const file = join(app.getPath('temp'), `plannr-print-${process.pid}-${Date.now()}.html`)
  writeFileSync(file, ticketHtml(db, dataDir, job))
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await win.loadFile(file)
    return await fn(win.webContents)
  } finally {
    win.destroy()
    rmSync(file, { force: true })
  }
}

/** The printout as a PDF (for the preview and Save as PDF). Tests also get a ticket printout's page in `testOut`. */
export async function printPdf(db: Db, dataDir: string, window: BrowserWindow | null, job: PrintJob, testOut?: string): Promise<Uint8Array> {
  if (testOut && job.ticket) writeFileSync(testOut, ticketHtml(db, dataDir, job))
  const inches = PRINT_MARGIN_MM[job.margins] / 25.4
  const pdf = await onPage(db, dataDir, window, job, (page) =>
    page.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: PAPER[job.paper],
      landscape: job.landscape,
      margins: { top: inches, bottom: inches, left: inches, right: inches }
    })
  )
  return new Uint8Array(pdf)
}

/** Opens the Windows print dialog (pick a printer). Tests skip the dialog. */
export async function printSend(db: Db, dataDir: string, window: BrowserWindow | null, job: PrintJob, testOut?: string): Promise<void> {
  if (testOut) {
    if (job.ticket) writeFileSync(testOut, ticketHtml(db, dataDir, job))
    return
  }
  await onPage(
    db,
    dataDir,
    window,
    job,
    (page) =>
      new Promise<void>((resolve, reject) =>
        page.print({ silent: false, printBackground: true, pageSize: PAPER[job.paper], landscape: job.landscape }, (ok, reason) =>
          ok || /cancel/i.test(reason) ? resolve() : reject(new Error(`Couldn’t print: ${reason}`))
        )
      )
  )
}

/** Saves the printout as a PDF where the user picks (or in `file`). False if cancelled. */
export async function printSavePdf(db: Db, dataDir: string, window: BrowserWindow | null, job: PrintJob, name: string, file?: string): Promise<boolean> {
  let out = file
  if (!out) {
    const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Plannr printout'
    const options = { title: 'Save as PDF', defaultPath: join(app.getPath('documents'), `${safe}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    out = result.filePath
  }
  writeFileSync(out, await printPdf(db, dataDir, window, job))
  return true
}

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
