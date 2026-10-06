/*
 * The page side of the phone web app: window.plannr (the same API the PC app's screens use), answered by the
 * database worker. A few calls need the page itself (clipboard, printing, opening and saving files).
 */
import { API_SHAPE, type PlannrApi } from '../shared/api'
import type { WebExtras } from './worker'

export type WorkerRequest = { id: number; ns: string; method: string; args: unknown[] }
export type WorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string } | { event: string }

/*
 * Pictures are stored as plannr://file/<id> (that's what the PC understands, and notes sync between them). The
 * browser can't load that, so on the way to the screens it becomes /plannr-file/<id>, which the service worker
 * answers from the database, and on the way back it's turned into plannr://file/<id> again.
 */
const TO_WEB: [RegExp, string][] = [
  [/plannr:\/\/file\//g, '/plannr-file/'],
  [/plannr-vault:\/\/file\//g, '/plannr-vault/']
]
const TO_STORED: [RegExp, string][] = [
  [/\/plannr-file\//g, 'plannr://file/'],
  [/\/plannr-vault\//g, 'plannr-vault://file/']
]
function rewrite<T>(value: T, rules: [RegExp, string][]): T {
  if (typeof value === 'string') return (value.includes('plannr') ? rules.reduce((s, [re, to]) => s.replace(re, to), value as string) : value) as T
  if (Array.isArray(value)) return value.map((v) => rewrite(v, rules)) as T
  if (value && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, rules)
    return out as T
  }
  return value
}

const listeners = new Map<string, Set<() => void>>()
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

export const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'plannr-db' })
worker.onmessage = (e: MessageEvent<WorkerReply>) => {
  const msg = e.data
  if ('event' in msg) {
    for (const fn of listeners.get(msg.event) ?? []) fn()
    return
  }
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  if (msg.ok) p.resolve(msg.value)
  else p.reject(new Error(msg.error))
}

export function call<T>(ns: string, method: string, ...args: unknown[]): Promise<T> {
  const id = nextId++
  const internal = ns === '_web' // the page's own requests (e.g. a /plannr-file/ path) go as they are
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve((internal ? v : rewrite(v, TO_WEB)) as T), reject })
    worker.postMessage({ id, ns, method, args: internal ? args : rewrite(args, TO_STORED) } satisfies WorkerRequest)
  })
}

export const web = new Proxy({} as WebExtras & { boot(): Promise<{ persistent: boolean; joined: boolean }> }, {
  get:
    (_t, method: string) =>
    (...args: unknown[]) =>
      call('_web', method, ...args)
})

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Prints a page of HTML (iPhone: the share sheet's Print, i.e. AirPrint) */
function printHtml(html: string): void {
  const frame = Object.assign(document.createElement('iframe'), { srcdoc: html })
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'
  frame.onload = () => {
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.append(frame)
}

/** Builds window.plannr and window.plannrEvents. */
export function installApi(): void {
  const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {}
  for (const [ns, methods] of Object.entries(API_SHAPE)) {
    api[ns] = {}
    for (const method of methods) api[ns][method] = (...args) => call(ns, method, ...args)
  }
  const p = api as unknown as PlannrApi
  p.files.open = async (id) => void window.open(`/plannr-file/${id}`, '_blank')
  p.vault.openFile = async (id) => void window.open(`/plannr-vault/${id}/file`, '_blank')
  p.vault.exportFile = async (id) => {
    const file = await web.readFile(`/plannr-vault/${id}`)
    if (!file) return false
    download(file.name, file.data as Uint8Array<ArrayBuffer>, file.mime)
    return true
  }
  p.vault.copy = async (id, field) => {
    const value = await web.fieldValue(id, field)
    await navigator.clipboard.writeText(value)
  }
  p.vault.saveRecoveryKey = async (key) => {
    download(
      'Plannr vault recovery key.txt',
      `Plannr vault recovery key\n\n${key}\n\nKeep this somewhere safe. If you forget your vault passcode, this key is the only way back in.\n`,
      'text/plain'
    )
    return true
  }
  p.money.exportCsv = async (from, to) => {
    download(`Plannr transactions ${from} to ${to}.csv`, '﻿' + (await web.csv(from, to)), 'text/csv')
    return true
  }
  p.print.ticket = async (id, kind) => printHtml(await web.printHtml(id, kind))
  ;(window as unknown as { plannr: PlannrApi }).plannr = p

  const on = (event: string) => (callback: () => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(callback)
    return () => void listeners.get(event)?.delete(callback)
  }
  ;(window as unknown as { plannrEvents: unknown }).plannrEvents = {
    onNavigate: () => () => undefined,
    onCalendarChanged: on('calendar-changed'),
    onUpdateStatus: () => () => undefined,
    onCaptureOpen: () => () => undefined,
    onDataChanged: on('data-changed'),
    onVaultLocked: on('vault-locked')
  }
}

/** The service worker asks for file contents (pictures in notes, ticket photos, vault files). */
export function answerFileRequests(): void {
  navigator.serviceWorker?.addEventListener('message', async (e: MessageEvent<{ type: string; path: string }>) => {
    if (e.data?.type !== 'plannr-file' || !e.ports[0]) return
    const file = await web.readFile(e.data.path).catch(() => null)
    e.ports[0].postMessage(file, file ? [file.data.buffer] : [])
  })
  navigator.serviceWorker?.startMessages() // messages wait in a queue until this (addEventListener alone doesn't start it)
}
