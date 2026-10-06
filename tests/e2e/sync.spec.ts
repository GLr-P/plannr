import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePng, shot } from './helpers'
import { fakeServer, serveHttp } from '../support/d1'

// Two copies of Plannr and a sync server on this computer: turn sync on in one, join from the other, edit both ways.
const dirA = mkdtempSync(join(tmpdir(), 'plannr-e2e-sync-a-'))
const dirB = mkdtempSync(join(tmpdir(), 'plannr-e2e-sync-b-'))
const srv = fakeServer('test-setup-code')
let server: Awaited<ReturnType<typeof serveHttp>>
let a: { app: ElectronApplication; page: Page }
let b: { app: ElectronApplication; page: Page }

test.beforeAll(async () => {
  server = await serveHttp(srv)
  a = await launch(dirA)
  b = await launch(dirB)
})
test.afterAll(async () => {
  await a?.app.close()
  await b?.app.close()
  await server?.close()
})

const openSync = async (page: Page): Promise<void> => {
  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'Sync & devices' }).click()
}

test('turn on, add a second PC with the link, and changes go both ways (files too)', async () => {
  const { page } = a
  const customer = await page.evaluate(() => window.plannr.customers.create({ name: 'Dana Whitfield', phone: '555-0142' }))
  await page.evaluate((id) => window.plannr.tickets.create({ customerId: id }).then((t) => window.plannr.tickets.update(t.id, { device: 'Pixel 7 screen' })), customer.id)
  const png = [...makePng(40, 30)]
  const file = await page.evaluate((bytes) => window.plannr.files.save({ name: 'board.png', mime: 'image/png', data: new Uint8Array(bytes) }), png)
  await page.evaluate(() => window.plannr.business.set({ name: 'Northside Repairs' }))

  await openSync(page)
  await page.getByRole('button', { name: 'Start syncing from this PC' }).click()
  await page.getByLabel('Sync server address').fill(server.url)
  await page.getByLabel('Setup code').fill('wrong')
  await page.getByRole('button', { name: 'Turn on sync' }).click()
  await expect(page.locator('.error-text')).toContainText('Wrong setup code')
  await page.getByLabel('Setup code').fill('test-setup-code')
  await page.getByRole('button', { name: 'Turn on sync' }).click()
  await expect(page.locator('.integration-status')).toContainText('Synced', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Show code and link' }).click()
  await expect(page.locator('.sync-qr')).toBeVisible()
  const link = (await page.locator('.sync-link .path').textContent())!
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#join=[A-Za-z0-9_-]{43}$/)
  await shot(page, 's1-sync-on')

  // Second PC (fresh): joins and receives everything, without a second set of starter templates.
  await openSync(b.page)
  await b.page.getByRole('button', { name: 'Join with a link' }).click()
  await b.page.getByLabel('Join link').fill(link)
  await b.page.getByRole('button', { name: 'Join' }).click()
  await expect(b.page.locator('.integration-status')).toContainText('Synced', { timeout: 15_000 })
  const tickets = await b.page.evaluate(() => window.plannr.tickets.list({}))
  expect(tickets.map((t) => t.device)).toEqual(['Pixel 7 screen'])
  expect(tickets[0].customerName).toBe('Dana Whitfield')
  expect(await b.page.evaluate(() => window.plannr.business.get())).toMatchObject({ name: 'Northside Repairs' })
  const [ta, tb] = await Promise.all([a.page.evaluate(() => window.plannr.templates.list('ticket')), b.page.evaluate(() => window.plannr.templates.list('ticket'))])
  expect(tb.map((t) => t.id)).toEqual(ta.map((t) => t.id))
  expect((await b.page.evaluate(() => window.plannr.search.query('Whitfield'))).length).toBeGreaterThan(0) // search index rebuilt
  await expect.poll(() => existsSync(join(dirB, 'attachments', file.id.slice(0, 2), `${file.id}.png`)), { timeout: 15_000 }).toBe(true)
  await shot(b.page, 's2-joined')

  // An edit on the second PC shows up on the first, in the list that's open there.
  await a.page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await expect(a.page.locator('.ticket-row', { hasText: 'Pixel 7 screen' })).toBeVisible()
  await b.page.evaluate((id) => window.plannr.tickets.update(id, { device: 'Pixel 7 Pro screen' }), tickets[0].id)
  await expect.poll(() => b.page.evaluate(() => window.plannr.sync.status().then((s) => s.pending)), { timeout: 15_000 }).toBe(0) // sent by itself
  await a.page.evaluate(() => window.plannr.sync.syncNow())
  await expect(a.page.locator('.ticket-row', { hasText: 'Pixel 7 Pro screen' })).toBeVisible()

  // Turning off keeps everything.
  await openSync(b.page)
  await b.page.getByRole('button', { name: 'Turn off' }).click()
  await b.page.getByRole('button', { name: 'Stop syncing' }).click()
  await expect(b.page.getByRole('button', { name: 'Join with a link' })).toBeVisible()
  expect(await b.page.evaluate(() => window.plannr.tickets.list({}).then((l) => l.length))).toBe(1)
})
