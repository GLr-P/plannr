import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as tickets from '../../src/main/services/tickets'
import * as customers from '../../src/main/services/customers'
import * as notes from '../../src/main/services/notes'
import { resolveFilePath } from '../../src/main/services/files'
import { collectReports, connectTroubleshootr, deviceTitle, disconnectTroubleshootr, importReport, publishOpenTickets, troubleshootrStatus, type DropDeps, type TroubleshootrReport } from '../../src/main/services/troubleshootr'
import { dropToken, fromB64url, newDropKeys, openInfo, openReport, sealReport, type DropKeys } from '../../src/shared/drop-crypto'
import { deriveSyncKeys, newSyncKey, sha256Hex } from '../../src/shared/sync-crypto'
import { fakeServer } from '../support/d1'
import { checkDue } from '../../src/main/troubleshootr-sync'
import { formatTicketNumber } from '../../src/shared/api'

let srv: ReturnType<typeof fakeServer>
let db: Db
let deps: DropDeps
let keys: DropKeys | null

/** What Troubleshootr does with the link: parse it, then post sealed reports and read the ticket list with its token. */
function troubleshootr(link: string) {
  const [space, secret, publicKey] = link.split('#troubleshootr=')[1].split('.')
  return {
    space,
    send: async (payload: unknown, token?: string) =>
      srv.fetch(`/api/s/${space}/inbox`, { method: 'POST', headers: { Authorization: `Bearer ${token ?? (await dropToken(secret))}` }, body: await sealReport(publicKey, payload) }),
    tickets: async () => {
      const res = await srv.fetch(`/api/s/${space}/dropinfo`, { headers: { Authorization: `Bearer ${await dropToken(secret)}` } })
      const { info } = (await res.json()) as { info: string }
      return (await openInfo(secret, fromB64url(info))) as { tickets: { number: number; customer: string; device: string }[] }
    }
  }
}

const report = (target: TroubleshootrReport['target']): TroubleshootrReport => ({
  v: 1,
  kind: 'troubleshootr-report',
  sentAt: '2026-10-27T15:30:00Z',
  toolVersion: '1.1.0',
  target,
  device: { name: 'WORKSHOP-PC', manufacturer: 'Dell', model: 'XPS 13', windows: 'Windows 11 Home 25H2', cpu: 'Intel Core i7', ramGB: 16, gpu: 'Intel Iris Xe' },
  summary: 'Device: WORKSHOP-PC',
  findings: [
    { severity: 'Critical', checkId: 'STO-002', title: 'Disk 0 has unreadable sectors', evidence: 'Reallocated: 312.', advice: 'Back up now.' },
    { severity: 'Info', checkId: 'WIN-004', title: 'A restart is pending', evidence: 'Waiting.', advice: 'Restart.' }
  ],
  html: '<!doctype html><title>Report</title><h1>WORKSHOP-PC</h1>'
})

beforeEach(async () => {
  srv = fakeServer()
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  const sync = await deriveSyncKeys(newSyncKey())
  await srv.fetch('/api/spaces', { method: 'POST', body: JSON.stringify({ space: sync.space, authHash: await sha256Hex(sync.token), ownerSecret: 'owner-secret' }) })
  keys = null
  deps = {
    db,
    dataDir: mkdtempSync(join(tmpdir(), 'plannr-drop-')),
    credentials: async () => ({ server: 'https://sync.test', space: sync.space, token: sync.token, fetch: (url, init) => srv.fetch(url.replace('https://sync.test', ''), init) }),
    deviceName: 'BENCH-PC',
    getKeys: () => keys,
    putKeys: (k) => void (keys = k)
  }
})

describe('Troubleshootr inbox', () => {
  it('a report becomes a new ticket for the named customer, with the full report attached', async () => {
    const link = await connectTroubleshootr(deps)
    expect(link).toMatch(/^https:\/\/sync\.test\/#troubleshootr=[\w-]+\.[\w-]{43}\.[\w-]{87}$/)
    const ts = troubleshootr(link)
    expect((await ts.send(report({ mode: 'new', customer: 'Jane Doe' }))).status).toBe(200)

    const { imported, errors } = await collectReports(deps)
    expect(errors).toEqual([])
    expect(imported).toHaveLength(1)
    const t = tickets.getTicket(db, imported[0].id)!
    expect(t).toMatchObject({ device: 'Dell XPS 13', issue: 'Disk 0 has unreadable sectors', customerName: 'Jane Doe' })
    const blocks = JSON.stringify(t.content)
    expect(blocks).toContain('[Critical] Disk 0 has unreadable sectors: Reallocated: 312.')
    expect(blocks).toContain('Also 1 informational note')
    const attachment = t.content!.content!.find((b) => b.type === 'fileAttachment')!
    const fileId = String(attachment.attrs!.src).replace('plannr://file/', '')
    expect(readFileSync(resolveFilePath(db, deps.dataDir, fileId)!.path, 'utf8')).toContain('<h1>WORKSHOP-PC</h1>')
    // collected reports leave the inbox
    expect((await collectReports(deps)).imported).toHaveLength(0)
  })

  it('adds to an existing ticket by number, matches the customer, or makes a note', async () => {
    const jane = customers.createCustomer(db, { name: 'Jane Doe' })
    const open = tickets.createTicket(db, { customerId: jane.id })
    tickets.updateTicket(db, open.id, { device: 'Old laptop' })
    const ts = troubleshootr(await connectTroubleshootr(deps))
    expect((await ts.tickets()).tickets).toEqual([{ number: open.number, label: formatTicketNumber(open.number), customer: 'Jane Doe', device: 'Old laptop', status: 'intake' }])

    await ts.send(report({ mode: 'ticket', ticketNumber: open.number }))
    await ts.send(report({ mode: 'note' }))
    await ts.send(report({ mode: 'new', customer: 'jane doe' }))
    const { imported } = await collectReports(deps)
    expect(imported.map((r) => [r.kind, r.created])).toEqual([['ticket', false], ['note', true], ['ticket', true]])
    expect(tickets.getTicket(db, open.id)!.device).toBe('Old laptop') // kept
    expect(JSON.stringify(tickets.getTicket(db, open.id)!.content)).toContain('Diagnostic scan')
    expect(notes.getNote(db, imported[1].id)!.title).toBe('Diagnostic scan · Dell XPS 13 · 2026-10-27')
    expect(tickets.getTicket(db, imported[2].id)!.customerId).toBe(jane.id) // same customer, not a duplicate

    await publishOpenTickets(deps)
    expect((await ts.tickets()).tickets).toHaveLength(2)
  })

  it('only the link’s token can post; disconnecting or reconnecting makes an old link stop working', async () => {
    const ts = troubleshootr(await connectTroubleshootr(deps))
    expect((await ts.send(report({ mode: 'note' }), 'f'.repeat(64))).status).toBe(401)
    // the inbox token can't read or delete anything else
    const res = await srv.fetch(`/api/s/${ts.space}/inbox`, { headers: { Authorization: `Bearer ${await dropToken(keys!.secret)}` } })
    expect(res.status).toBe(401)

    const fresh = troubleshootr(await connectTroubleshootr(deps))
    expect((await ts.send(report({ mode: 'note' }))).status).toBe(401)
    expect((await fresh.send(report({ mode: 'note' }))).status).toBe(200)
    await disconnectTroubleshootr(deps)
    expect((await fresh.send(report({ mode: 'note' }))).status).toBe(401)
  })

  it('a second synced PC can take the inbox over; the first then stops collecting and says where it went', async () => {
    const first = troubleshootr(await connectTroubleshootr(deps))
    await first.send(report({ mode: 'note' }))
    const firstKeys = keys
    // The other PC: same sync space, its own keys.
    let otherKeys: DropKeys | null = null
    const other: DropDeps = { ...deps, deviceName: 'DESK-PC', getKeys: () => otherKeys, putKeys: (k) => void (otherKeys = k) }
    expect(await troubleshootrStatus(other)).toMatchObject({ connected: false, elsewhere: 'BENCH-PC' })
    const second = troubleshootr(await connectTroubleshootr(other))

    keys = firstKeys
    const result = await collectReports(deps)
    expect(result).toMatchObject({ imported: [], movedTo: 'DESK-PC' })
    expect(keys).toBeNull() // forgot its keys: no more errors every 5 minutes
    // The report sealed to the old key was dropped on reconnect; new ones go to the other PC.
    expect((await second.send(report({ mode: 'note' }))).status).toBe(200)
    expect((await collectReports(other)).imported).toHaveLength(1)
    expect((await first.send(report({ mode: 'note' }))).status).toBe(401)
  })

  it('a report already imported is not imported twice when removing it from the server failed', async () => {
    const ts = troubleshootr(await connectTroubleshootr(deps))
    await ts.send(report({ mode: 'note' }))
    const realFetch = (await deps.credentials())!.fetch
    let failDelete = true
    const flaky: DropDeps = {
      ...deps,
      credentials: async () => ({
        ...(await deps.credentials())!,
        fetch: async (url, init) => {
          if (init.method === 'DELETE' && failDelete) {
            failDelete = false
            throw new Error('network down')
          }
          return realFetch(url, init)
        }
      })
    }
    expect((await collectReports(flaky)).imported).toHaveLength(1)
    const again = await collectReports(flaky)
    expect(again.imported).toHaveLength(0)
    expect(notes.listNotes(db).filter((n) => n.title.startsWith('Diagnostic scan'))).toHaveLength(1)
    const { items } = (await (await srv.fetch(`/api/s/${ts.space}/inbox`, { headers: { Authorization: `Bearer ${(await deps.credentials())!.token}` } })).json()) as { items: unknown[] }
    expect(items).toHaveLength(0)
  })

  it('opens and imports a report sealed by Troubleshootr itself (.NET), byte-compatible', async () => {
    const dir = join(__dirname, '..', 'fixtures', 'troubleshootr')
    const fixtureKeys = JSON.parse(readFileSync(join(dir, 'drop-keys.json'), 'utf8')) as DropKeys
    const payload = await openReport(fixtureKeys, new Uint8Array(readFileSync(join(dir, 'report.bin'))))
    const result = importReport(db, deps.dataDir, payload)
    expect(result).toMatchObject({ kind: 'ticket', created: true })
    const t = tickets.getTicket(db, result.id)!
    expect(t.customerName).toBe('Jane Doe')
    expect(t.device).toBe('Micro-Star International Summit E16 AI Evo A1MTG')
    expect(JSON.stringify(t.content)).toContain('[Critical]')
  })

  it('a report sealed for another Plannr stays in the inbox with a readable error', async () => {
    const ts = troubleshootr(await connectTroubleshootr(deps))
    const wrongKey = (await newDropKeys()).publicKey
    await srv.fetch(`/api/s/${ts.space}/inbox`, { method: 'POST', headers: { Authorization: `Bearer ${await dropToken(keys!.secret)}` }, body: await sealReport(wrongKey, report({ mode: 'note' })) })
    const { imported, errors } = await collectReports(deps)
    expect(imported).toHaveLength(0)
    expect(errors[0]).toMatch(/doesn’t belong to this Plannr/)
  })

  it('device names drop company suffixes and repeated makers', () => {
    expect(deviceTitle({ manufacturer: 'Micro-Star International Co., Ltd.', model: 'Summit E16 AI Evo A1MTG' })).toBe('Micro-Star International Summit E16 AI Evo A1MTG')
    expect(deviceTitle({ manufacturer: 'Dell Inc.', model: 'XPS 13 9310' })).toBe('Dell XPS 13 9310')
    expect(deviceTitle({ manufacturer: 'LENOVO', model: 'Lenovo ThinkPad T14' })).toBe('Lenovo ThinkPad T14')
    expect(deviceTitle({ name: 'WORKSHOP-PC' })).toBe('WORKSHOP-PC')
  })
})

describe('how soon Plannr looks for reports', () => {
  it('every 20 s while the window is open, every 5 min from the tray', () => {
    const t = 1_000_000_000
    expect(checkDue(t, t - 19_000, true)).toBe(false)
    expect(checkDue(t, t - 20_000, true)).toBe(true)
    expect(checkDue(t, t - 60_000, false)).toBe(false)
    expect(checkDue(t, t - 5 * 60_000, false)).toBe(true)
    expect(checkDue(t, 0, false)).toBe(true) // right after start
  })
})
