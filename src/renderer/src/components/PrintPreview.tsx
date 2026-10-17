import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { FileDown, Printer, X } from 'lucide-react'
import { DEFAULT_PRINT_SETUP, PRINT_MARGIN_MM, type PrintJob, type PrintKind, type PrintSetup } from '../../../shared/api'
import { api } from '../api'
import { showToast } from '../lib/toast'
import { useUi } from '../store/ui'
import { useNav } from '../store/nav'

/** Something to print: a ticket printout, or what's on screen (the open note, the vault's recovery key) */
export interface PrintRequest {
  /** Names the preview and the saved PDF */
  title: string
  ticket?: { id: string; kind: PrintKind }
  /** Printing what's on screen: this class goes on <body> while printing (its print styles hide everything else) */
  bodyClass?: string
  /** Prints at its own size (the label), so no paper choices */
  fixedSize?: boolean
}

const usePrintPreview = create<{ req: PrintRequest | null; set: (req: PrintRequest | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }))

/** Prints with a preview first, where paper, orientation and margins are chosen. The phone's own print sheet already previews. */
export async function openPrint(req: PrintRequest): Promise<void> {
  const info = await api.app.info()
  if (!info.web) return usePrintPreview.getState().set(req)
  if (req.ticket) return api.print.ticket(req.ticket.id, req.ticket.kind)
  await onPage(req, DEFAULT_PRINT_SETUP, async () => window.print())
}

/** For what's on screen: its body class and the chosen paper while `fn` prints it */
async function onPage<T>(req: PrintRequest, setup: PrintSetup, fn: () => Promise<T>): Promise<T> {
  if (req.ticket) return fn()
  const style = document.createElement('style')
  style.textContent = `@page { size: ${setup.paper} ${setup.landscape ? 'landscape' : 'portrait'}; margin: ${PRINT_MARGIN_MM[setup.margins]}mm; }`
  document.head.append(style)
  if (req.bodyClass) document.body.classList.add(req.bodyClass)
  try {
    return await fn()
  } finally {
    style.remove()
    if (req.bodyClass) document.body.classList.remove(req.bodyClass)
  }
}

type PdfJs = typeof import('pdfjs-dist')
let pdfjs: Promise<PdfJs> | null = null
/** pdf.js, loaded the first time a preview opens. Its worker runs in this page (a worker file can't load from file://). */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs')]).then(([lib, worker]) => {
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    return lib
  })
  return pdfjs
}

function savedSetup(): PrintSetup {
  try {
    return { ...DEFAULT_PRINT_SETUP, ...(JSON.parse(useUi.getState().prefs.printSetup ?? '{}') as Partial<PrintSetup>) }
  } catch {
    return DEFAULT_PRINT_SETUP
  }
}

export function PrintPreview() {
  const req = usePrintPreview((s) => s.req)
  return req ? <Preview req={req} /> : null
}

function Preview({ req }: { req: PrintRequest }) {
  const close = (): void => usePrintPreview.getState().set(null)
  const [setup, setSetupState] = useState<PrintSetup>(savedSetup)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [pages, setPages] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pagesRef = useRef<HTMLDivElement>(null)
  const job: PrintJob = { ...setup, ticket: req.ticket }

  const setSetup = (patch: Partial<PrintSetup>): void => {
    const next = { ...setup, ...patch }
    setSetupState(next)
    useUi.getState().setPref('printSetup', JSON.stringify(next))
  }

  // Leaving the page closes the preview.
  const route = useNav((s) => s.route)
  const opened = useRef(route)
  useEffect(() => {
    if (route !== opened.current) close()
  }, [route])

  // Make the PDF again whenever the paper changes.
  useEffect(() => {
    let stale = false
    setError('')
    onPage(req, setup, () => api.print.pdf(job))
      .then((bytes) => !stale && setPdf(bytes))
      .catch((err: Error) => !stale && setError(err.message))
    return () => {
      stale = true
    }
  }, [req, setup.paper, setup.landscape, setup.margins])

  // Draw its pages.
  useEffect(() => {
    const box = pagesRef.current
    if (!pdf || !box) return
    let stale = false
    void (async () => {
      const lib = await loadPdfJs()
      const task = lib.getDocument({ data: pdf.slice() })
      const doc = await task.promise
      const sheets: HTMLElement[] = []
      const fit = Math.min(860, box.clientWidth - 48)
      for (let n = 1; n <= doc.numPages && !stale; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = (base.width > base.height ? fit : Math.min(fit, 760)) / base.width
        const viewport = page.getViewport({ scale: scale * devicePixelRatio })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(base.width * scale)}px`
        canvas.style.height = `${Math.floor(base.height * scale)}px`
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        const sheet = document.createElement('div')
        sheet.className = 'pp-page'
        sheet.setAttribute('aria-label', `Page ${n}`)
        sheet.append(canvas)
        sheets.push(sheet)
      }
      if (stale) return
      box.replaceChildren(...sheets)
      setPages(doc.numPages)
      void task.destroy()
    })().catch((err: Error) => !stale && setError(err.message))
    return () => {
      stale = true
    }
  }, [pdf])

  const print = async (): Promise<void> => {
    setBusy(true)
    await onPage(req, setup, () => api.print.send(job))
      .then(close)
      .catch((err: Error) => showToast(err.message))
      .finally(() => setBusy(false))
  }
  const savePdf = async (): Promise<void> => {
    setBusy(true)
    await onPage(req, setup, () => api.print.savePdf(job, req.title))
      .then((saved) => saved && showToast('Saved as PDF'))
      .catch((err: Error) => showToast(err.message))
      .finally(() => setBusy(false))
  }

  return (
    <div
      className="print-preview"
      role="dialog"
      aria-label="Print preview"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        if (e.key === 'p' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void print()
        }
      }}
    >
      <div className="pp-pages" ref={pagesRef} tabIndex={-1}>
        {!pdf && !error && <p className="pp-wait muted">Getting the pages ready…</p>}
      </div>
      <aside className="pp-side">
        <div className="pp-head">
          <h2>Print</h2>
          <button type="button" className="icon-btn" aria-label="Close preview" title="Close (Esc)" onClick={close}>
            <X />
          </button>
        </div>
        <p className="small muted pp-title">{req.title}</p>
        <p className="pp-count" aria-live="polite">
          {error ? <span className="pp-error">{error}</span> : pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : ' '}
        </p>
        {!req.fixedSize && (
          <>
            <label className="mfield">
              Paper
              <select aria-label="Paper" value={setup.paper} onChange={(e) => setSetup({ paper: e.target.value as PrintSetup['paper'] })}>
                <option value="letter">Letter (8.5 × 11 in)</option>
                <option value="legal">Legal (8.5 × 14 in)</option>
                <option value="a4">A4 (210 × 297 mm)</option>
              </select>
            </label>
            <div className="mfield">
              Orientation
              <div className="segmented" role="radiogroup" aria-label="Orientation">
                {[false, true].map((landscape) => (
                  <button key={String(landscape)} type="button" role="radio" aria-checked={setup.landscape === landscape} className={setup.landscape === landscape ? 'active' : ''} onClick={() => setSetup({ landscape })}>
                    {landscape ? 'Landscape' : 'Portrait'}
                  </button>
                ))}
              </div>
            </div>
            <label className="mfield">
              Margins
              <select aria-label="Margins" value={setup.margins} onChange={(e) => setSetup({ margins: e.target.value as PrintSetup['margins'] })}>
                <option value="normal">Normal</option>
                <option value="narrow">Narrow</option>
                <option value="none">None</option>
              </select>
            </label>
          </>
        )}
        <div className="pp-actions">
          <button type="button" className="btn primary" disabled={busy || !pdf} onClick={() => void print()}>
            <Printer /> Print…
          </button>
          <button type="button" className="btn" disabled={busy || !pdf} onClick={() => void savePdf()}>
            <FileDown /> Save as PDF
          </button>
        </div>
        <p className="small muted">Print… opens Windows’ print window, where you pick the printer and number of copies.</p>
      </aside>
    </div>
  )
}
