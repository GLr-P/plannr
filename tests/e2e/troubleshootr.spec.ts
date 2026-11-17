import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'
import { fakeServer, serveHttp } from '../support/d1'
import { dropToken, sealReport } from '../../src/shared/drop-crypto'

// Settings → Sync & devices → Troubleshootr: connect, then a report Troubleshootr sends lands in a new ticket.
const dir = mkdtempSync(join(tmpdir(), 'plannr-e2e-troubleshootr-'))
const srv = fakeServer('test-setup-code')
let server: Awaited<ReturnType<typeof serveHttp>>
let a: { app: ElectronApplication; page: Page }

test.beforeAll(async () => {
  server = await serveHttp(srv)
  a = await launch(dir, { PLANNR_TROUBLESHOOTR_POLL: '1' }) // the real 20 s check, not only the button
})
test.afterAll(async () => {
  await a?.app.close()
  await server?.close()
})

const report = (target: Record<string, unknown>) => ({
  v: 1,
  kind: 'troubleshootr-report',
  sentAt: '2026-11-17T18:30:00Z',
  toolVersion: '1.1.0',
  target,
  device: { name: 'WORKSHOP-PC', manufacturer: 'Dell Inc.', model: 'XPS 13 9310', windows: 'Windows 11 Home 25H2', cpu: 'Intel Core i7-1185G7', ramGB: 16, gpu: 'Intel Iris Xe' },
  summary: 'Device: WORKSHOP-PC',
  findings: [
    { severity: 'Critical', checkId: 'STO-002', title: 'Disk 0 has unreadable sectors', evidence: 'Reallocated sectors: 312.', advice: 'Back up now and replace the drive.' },
    { severity: 'Warning', checkId: 'DRV-002', title: 'The graphics driver is old', evidence: 'Intel Iris Xe, driver from 2021.', advice: 'Update it from Intel.' },
    { severity: 'Info', checkId: 'WIN-004', title: 'A restart is pending', evidence: 'Windows Update is waiting.', advice: 'Restart.' }
  ],
  html: '<!doctype html><title>Report</title><h1>WORKSHOP-PC</h1>'
})

test('connect Troubleshootr, and a sent scan becomes a ticket with the report attached', async () => {
  const { page } = a
  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'Sync & devices' }).click()
  // Hidden until sync is on (the reports travel through the sync service).
  await expect(page.getByRole('heading', { name: 'Troubleshootr' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start syncing from this PC' }).click()
  await page.getByLabel('Sync server address').fill(server.url)
  await page.getByLabel('Setup code').fill('test-setup-code')
  await page.getByRole('button', { name: 'Turn on sync' }).click()
  await expect(page.locator('.integration-status').first()).toContainText('Synced', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Connect Troubleshootr' }).click()
  const link = (await page.locator('.sync-link .path', { hasText: '#troubleshootr=' }).textContent())!
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#troubleshootr=[\w-]+\.[\w-]{43}\.[\w-]{87}$/)
  await page.getByRole('heading', { name: 'Troubleshootr' }).scrollIntoViewIfNeeded()
  await shot(page, 'tr1-connected')

  // What Troubleshootr does with the link (its .NET side is byte-compatible; see the unit tests).
  const [space, secret, publicKey] = link.split('#troubleshootr=')[1].split('.')
  const res = await fetch(`${server.url}/api/s/${space}/inbox`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await dropToken(secret)}` },
    body: await sealReport(publicKey, report({ mode: 'new', customer: 'Jane Doe' }))
  })
  expect(res.status).toBe(200)

  await page.getByRole('button', { name: 'Check for reports' }).click()
  await expect(page.locator('.sync-setting li', { hasText: 'New ticket' })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'tr2-collected')

  const [ticket] = await page.evaluate(() => window.plannr.tickets.list({}))
  expect(ticket).toMatchObject({ device: 'Dell XPS 13 9310', customerName: 'Jane Doe' })
  await page.keyboard.press('Escape')
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.locator('.ticket-row', { hasText: 'Dell XPS 13 9310' }).click()
  await expect(page.getByText('[Critical] Disk 0 has unreadable sectors: Reallocated sectors: 312.')).toBeVisible()
  await expect(page.locator('.file-chip-name', { hasText: 'Troubleshootr Dell XPS 13 9310 2026-11-17.html' })).toBeVisible()
  await page.locator('.file-chip').scrollIntoViewIfNeeded()
  await shot(page, 'tr3-ticket')
})

// Owner, 2026-11-17: "dont see shit on my ticket". The scan was added to the ticket while it was open; the open page's
// next save wrote its older copy back over it. The page now reloads when its ticket changes from outside.
test('a scan added to the ticket that is open shows up, and typing afterwards keeps it', async () => {
  const { page } = a
  const open = await page.evaluate(() => window.plannr.tickets.create({}).then((t) => window.plannr.tickets.update(t.id, { device: 'Bench PC' }).then(() => t)))
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.locator('.ticket-row', { hasText: 'Bench PC' }).click()
  await page.locator('.editor .ProseMirror').click()
  await page.keyboard.type('Customer says it is slow')
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5_000 })
  await expect.poll(async () => JSON.stringify((await page.evaluate((id) => window.plannr.tickets.get(id), open.id))!.content)).toContain('it is slow')

  const link = (await page.evaluate(() => window.plannr.troubleshootr.status())).link!
  const [space, secret, publicKey] = link.split('#troubleshootr=')[1].split('.')
  const res = await fetch(`${server.url}/api/s/${space}/inbox`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await dropToken(secret)}` },
    body: await sealReport(publicKey, report({ mode: 'ticket', ticketNumber: open.number }))
  })
  expect(res.status).toBe(200)
  await page.evaluate(() => window.plannr.troubleshootr.checkNow())

  await expect(page.getByText('[Critical] Disk 0 has unreadable sectors: Reallocated sectors: 312.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Customer says it is slow')).toBeVisible()
  // Typing after the scan arrived saves the scan too, instead of the page's older copy.
  await page.locator('.editor .ProseMirror p', { hasText: 'Customer says it is slow' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' and loud')
  await expect
    .poll(async () => JSON.stringify((await page.evaluate((id) => window.plannr.tickets.get(id), open.id))!.content), { timeout: 10_000 })
    .toContain('slow and loud')
  const saved = JSON.stringify((await page.evaluate((id) => window.plannr.tickets.get(id), open.id))!.content)
  expect(saved).toContain('Diagnostic scan')
  expect(saved).toContain('fileAttachment')
  await page.locator('.file-chip').scrollIntoViewIfNeeded()
  await shot(page, 'tr4-open-ticket')
})

// Owner, 2026-11-17: "nope", looking about 30 s after sending (Plannr then checked every 5 minutes). With the window
// open it now checks every 20 s, so a scan shows up without pressing anything.
test('a sent scan shows up on its own within about 20 seconds while Plannr is open', async () => {
  const { page } = a
  const open = await page.evaluate(() => window.plannr.tickets.create({}).then((t) => window.plannr.tickets.update(t.id, { device: 'Waiting PC' }).then(() => t)))
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.locator('.ticket-row', { hasText: 'Waiting PC' }).click()
  await page.evaluate(() => window.plannr.troubleshootr.checkNow()) // starts the 20 s clock now
  const link = (await page.evaluate(() => window.plannr.troubleshootr.status())).link!
  const [space, secret, publicKey] = link.split('#troubleshootr=')[1].split('.')
  const sent = Date.now()
  const res = await fetch(`${server.url}/api/s/${space}/inbox`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await dropToken(secret)}` },
    body: await sealReport(publicKey, report({ mode: 'ticket', ticketNumber: open.number }))
  })
  expect(res.status).toBe(200)
  await expect(page.getByText('[Critical] Disk 0 has unreadable sectors: Reallocated sectors: 312.')).toBeVisible({ timeout: 30_000 })
  console.log(`arrived after ${Math.round((Date.now() - sent) / 1000)} s`)
})
