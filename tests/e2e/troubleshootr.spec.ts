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
  a = await launch(dir)
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
