import type { Db } from '../db'
import { tx } from '../db'
import { formatTicketNumber, type DocJSON, type TroubleshootrStatus } from '../../shared/api'
import { dropLink, dropToken, newDropKeys, openReport, sealInfo, b64url, type DropKeys } from '../../shared/drop-crypto'
import { sha256Hex } from '../../shared/sync-crypto'
import { saveFile } from './files'
import { createTicket, getTicket, listTickets, updateTicket } from './tickets'
import { createCustomer, listCustomers } from './customers'
import { createNote, updateNote } from './notes'
import { getSetting, setSetting } from './settings'

/*
 * Reports from Troubleshootr (the diagnostic tool) arrive in an inbox on the sync service, sealed to this PC's key
 * (shared/drop-crypto.ts). Collecting one turns it into a new ticket, an addition to an existing ticket, or a note, with
 * the full report attached as an HTML file (which then syncs like any attachment). Plannr also publishes its open
 * tickets (number, customer, device) for Troubleshootr's "add to ticket" list.
 */

export type DropFetch = (url: string, init: RequestInit) => Promise<Response>

export interface DropDeps {
  db: Db
  dataDir: string
  /** The sync service's address, space and token; null while sync is off */
  credentials: () => Promise<{ server: string; space: string; token: string; fetch: DropFetch } | null>
  /** Windows-encrypted storage for the inbox keys (the private key never leaves this PC) */
  getKeys: () => DropKeys | null
  putKeys: (keys: DropKeys | null) => void
  /** This PC's name, shown on other synced PCs ("connected on …") */
  deviceName: string
}

/** What Troubleshootr sends (version 1). Only add fields; Troubleshootr's PlannrPayload writes it. */
export interface TroubleshootrReport {
  v: 1
  kind: 'troubleshootr-report'
  sentAt: string
  toolVersion?: string
  target: { mode: 'new' | 'ticket' | 'note'; ticketNumber?: number; customer?: string }
  device: { name?: string; manufacturer?: string; model?: string; windows?: string; cpu?: string; ramGB?: number; gpu?: string }
  /** The ticket summary text (device, specs, problems) */
  summary: string
  findings: { severity: 'Critical' | 'Warning' | 'Info'; checkId: string; title: string; evidence: string; advice: string }[]
  /** The full report, every section and finding: a self-contained HTML page */
  html: string
  fileName?: string
}

export interface ImportResult {
  kind: 'ticket' | 'note'
  id: string
  title: string
  created: boolean
}

async function call(deps: DropDeps, method: string, path: string, body?: RequestInit['body'], json = true): Promise<Response> {
  const c = await deps.credentials()
  if (!c) throw new Error('Turn on sync first (Settings → Sync & devices); Troubleshootr sends reports through it')
  let res: Response
  try {
    res = await c.fetch(`${c.server}/api/s/${c.space}/${path}`, {
      method,
      body,
      headers: { Authorization: `Bearer ${c.token}`, ...(json && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }
    })
  } catch {
    throw new Error('Can’t reach the sync server. Check the internet connection.')
  }
  if (!res.ok) {
    const out = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(out.error ?? `The sync server answered ${res.status}`)
  }
  return res
}

/** Which PC holds the inbox (one per sync space): its token hash and name, or null when it's off. */
async function serverDrop(deps: DropDeps): Promise<{ tokenHash: string; device: string } | null> {
  const r = (await (await call(deps, 'GET', 'drop')).json()) as { tokenHash: string | null; device?: string }
  return r.tokenHash ? { tokenHash: r.tokenHash, device: r.device ?? '' } : null
}

/**
 * True if this PC still holds the inbox. Another synced PC may have connected since (the inbox moves there); then this
 * PC forgets its keys, so it stops collecting reports it can't open and stops overwriting the ticket list.
 */
async function stillOurs(deps: DropDeps, keys: DropKeys): Promise<boolean> {
  const drop = await serverDrop(deps)
  if (drop && drop.tokenHash === (await sha256Hex(await dropToken(keys.secret)))) return true
  deps.putKeys(null)
  return false
}

export async function troubleshootrStatus(deps: DropDeps): Promise<Pick<TroubleshootrStatus, 'connected' | 'link' | 'elsewhere'>> {
  const keys = deps.getKeys()
  const c = await deps.credentials()
  if (keys && c) return { connected: true, link: dropLink(c.server, c.space, keys), elsewhere: null }
  const drop = c ? await serverDrop(deps).catch(() => null) : null
  return { connected: false, link: null, elsewhere: drop ? drop.device || 'another PC' : null }
}

/** Turns the inbox on for this PC (new keys each time, so an old link stops working) and returns the link for Troubleshootr. */
export async function connectTroubleshootr(deps: DropDeps): Promise<string> {
  const c = await deps.credentials()
  if (!c) throw new Error('Turn on sync first (Settings → Sync & devices); Troubleshootr sends reports through it')
  const keys = await newDropKeys()
  await call(deps, 'PUT', 'drop', JSON.stringify({ tokenHash: await sha256Hex(await dropToken(keys.secret)), device: deps.deviceName }))
  deps.putKeys(keys)
  await publishOpenTickets(deps, true)
  return dropLink(c.server, c.space, keys)
}

export async function disconnectTroubleshootr(deps: DropDeps): Promise<void> {
  const keys = deps.getKeys()
  // Only switch the inbox off if it's still this PC's (not one another PC took over meanwhile).
  if (keys && (await deps.credentials()) && (await stillOurs(deps, keys).catch(() => false))) await call(deps, 'DELETE', 'drop').catch(() => undefined)
  deps.putKeys(null)
}

let lastPublished = ''

/** Sends the open-tickets list when it changed (sealed with the link's secret). */
export async function publishOpenTickets(deps: DropDeps, force = false): Promise<void> {
  const keys = deps.getKeys()
  if (!keys || (force && !(await stillOurs(deps, keys)))) return
  const tickets = listTickets(deps.db, { status: 'open', limit: 300 }).map((t) => ({ number: t.number, label: formatTicketNumber(t.number), customer: t.customerName, device: t.device, status: t.status }))
  const fingerprint = JSON.stringify(tickets)
  if (!force && fingerprint === lastPublished) return
  const sealed = await sealInfo(keys.secret, { v: 1, updatedAt: new Date().toISOString(), tickets })
  await call(deps, 'PUT', 'dropinfo', b64url(sealed), false)
  lastPublished = fingerprint
}

/** Collects every waiting report. Reports that can't be read are left in the inbox and reported as errors. */
export async function collectReports(deps: DropDeps): Promise<{ imported: ImportResult[]; errors: string[]; movedTo?: string }> {
  const keys = deps.getKeys()
  if (!keys) return { imported: [], errors: [] }
  if (!(await stillOurs(deps, keys))) return { imported: [], errors: [], movedTo: (await serverDrop(deps).catch(() => null))?.device || 'another PC' }
  const { items } = (await (await call(deps, 'GET', 'inbox')).json()) as { items: { id: string }[] }
  const imported: ImportResult[] = []
  const errors: string[] = []
  // Inbox ids already turned into tickets/notes: if removing one from the server failed, it isn't imported twice.
  const done = new Set((getSetting(deps.db, 'troubleshootr.imported') as string[] | null) ?? [])
  for (const item of items) {
    try {
      if (!done.has(item.id)) {
        const bytes = new Uint8Array(await (await call(deps, 'GET', `inbox/${item.id}`)).arrayBuffer())
        let payload: unknown
        try {
          payload = await openReport(keys, bytes)
        } catch (err) {
          // Sealed to a key this PC doesn't have: nobody can ever open it, so it would only block the inbox.
          await call(deps, 'DELETE', `inbox/${item.id}`)
          throw err
        }
        imported.push(importReport(deps.db, deps.dataDir, payload))
        done.add(item.id)
        setSetting(deps.db, 'troubleshootr.imported', [...done].slice(-200))
      }
      await call(deps, 'DELETE', `inbox/${item.id}`)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (imported.length) await publishOpenTickets(deps).catch(() => undefined)
  setSetting(deps.db, 'troubleshootr.lastCheckAt', Date.now())
  return { imported, errors }
}

const text = (t: string): DocJSON => ({ type: 'text', text: t })
const para = (t: string): DocJSON => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })

/** The block added to a ticket or note: heading, device, problems, and the attached full report. */
export function reportBlocks(r: TroubleshootrReport, file: { url: string; name: string; size: number; mime: string }): DocJSON[] {
  const d = r.device
  const when = new Date(r.sentAt)
  const date = Number.isNaN(when.getTime()) ? r.sentAt : when.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
  const serious = r.findings.filter((f) => f.severity !== 'Info')
  const notes = r.findings.length - serious.length
  const blocks: DocJSON[] = [
    { type: 'heading', attrs: { level: 3 }, content: [text(`Diagnostic scan · ${date}`)] },
    para(deviceTitle(d) + (d.windows ? ` · ${d.windows}` : '')),
    para(['Specs: ' + [d.cpu, d.ramGB ? `${d.ramGB} GB RAM` : '', d.gpu].filter(Boolean).join(', ')].join(''))
  ]
  blocks.push(serious.length ? para(`Problems found (${serious.length}):`) : para('No problems found.'))
  if (serious.length)
    blocks.push({
      type: 'bulletList',
      content: serious.map((f) => ({ type: 'listItem', content: [para(`[${f.severity}] ${f.title}: ${f.evidence}`)] }))
    })
  if (notes) blocks.push(para(`Also ${notes} informational note${notes === 1 ? '' : 's'}; see the full report.`))
  blocks.push({ type: 'fileAttachment', attrs: { src: file.url, name: file.name, size: file.size, mime: file.mime } })
  return blocks
}

/** "Dell Inc. XPS 13" → "Dell XPS 13": company suffixes make the device box hard to read. */
export function deviceTitle(d: TroubleshootrReport['device']): string {
  const maker = (d.manufacturer ?? '').replace(/,?\s+(co\.,?\s*ltd\.?|inc\.?|corporation|corp\.?|ltd\.?|limited|llc|gmbh)$/i, '').trim()
  const model = (d.model ?? '').trim()
  return (model.toLowerCase().startsWith(maker.toLowerCase()) ? model : [maker, model].filter(Boolean).join(' ')) || d.name || ''
}

function valid(p: unknown): p is TroubleshootrReport {
  const r = p as TroubleshootrReport
  return !!r && r.v === 1 && r.kind === 'troubleshootr-report' && typeof r.html === 'string' && Array.isArray(r.findings) && !!r.target && !!r.device
}

/** Adds one report to Plannr: the target the technician picked in Troubleshootr, or a new ticket if that ticket is gone. */
export function importReport(db: Db, dataDir: string, payload: unknown): ImportResult {
  if (!valid(payload)) throw new Error('This report was made by a Troubleshootr version this Plannr doesn’t understand; update Plannr')
  const r = payload
  const d = r.device
  const deviceName = deviceTitle(d).slice(0, 200)
  const stamp = r.sentAt.slice(0, 10)
  const fileName = (r.fileName || `Troubleshootr ${deviceName || 'PC'} ${stamp}.html`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200)
  // One transaction: a failure halfway leaves no empty ticket behind (the report stays in the inbox for the next try).
  return tx(db, () => {
  const file = saveFile(db, dataDir, { name: fileName, mime: 'text/html', data: new TextEncoder().encode(r.html) })
  const blocks = reportBlocks(r, file)

  if (r.target.mode === 'note') {
    const note = createNote(db, { title: `Diagnostic scan · ${deviceName || 'PC'} · ${stamp}` })
    updateNote(db, note.id, { content: { type: 'doc', content: blocks } }, false)
    return { kind: 'note', id: note.id, title: note.title, created: true }
  }

  if (r.target.mode === 'ticket' && r.target.ticketNumber) {
    const row = db.prepare('SELECT id FROM tickets WHERE number = ? AND deleted_at IS NULL').get(r.target.ticketNumber) as { id: string } | undefined
    const ticket = row ? getTicket(db, row.id) : null
    if (ticket) {
      const content: DocJSON = ticket.content ?? { type: 'doc', content: [] }
      updateTicket(db, ticket.id, {
        content: { ...content, content: [...(content.content ?? []), ...blocks] },
        ...(ticket.device.trim() ? {} : { device: deviceName })
      })
      return { kind: 'ticket', id: ticket.id, title: formatTicketNumber(ticket.number), created: false }
    }
  }

  // A new ticket (also when the chosen ticket was deleted meanwhile), for the named customer if there is one.
  let customerId: string | null = null
  const name = r.target.customer?.trim()
  if (name) {
    const match = listCustomers(db, { query: name, limit: 20 }).find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
    customerId = match?.id ?? createCustomer(db, { name }).id
  }
  const ticket = createTicket(db, { customerId })
  const serious = r.findings.filter((f) => f.severity !== 'Info')
  const content: DocJSON = ticket.content ?? { type: 'doc', content: [] }
  updateTicket(db, ticket.id, {
    device: deviceName,
    issue: (serious.length ? serious.slice(0, 3).map((f) => f.title).join('; ') : 'Diagnostic scan: no problems found').slice(0, 500),
    content: { ...content, content: [...(content.content ?? []), ...blocks] }
  })
  return { kind: 'ticket', id: ticket.id, title: formatTicketNumber(ticket.number), created: true }
  })
}

export const lastCheckAt = (db: Db): number | null => {
  const v = getSetting(db, 'troubleshootr.lastCheckAt')
  return typeof v === 'number' ? v : null
}
