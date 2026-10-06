import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, launchPhone, makePng, root, shot } from './helpers'
import { fakeServer, serveHttp } from '../support/d1'

// The phone web app (built into out/web by `npm run build:web`), served by the sync service, joined from a PC.
const pcDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-phone-pc-'))
const phoneProfile = mkdtempSync(join(tmpdir(), 'plannr-e2e-phone-profile-'))
const srv = fakeServer('test-setup-code', join(root, 'out', 'web'))
let server: Awaited<ReturnType<typeof serveHttp>>
let pc: { app: ElectronApplication; page: Page }
let phone: { app: ElectronApplication; page: Page }
const phoneErrors: string[] = []

test.beforeAll(async () => {
  server = await serveHttp(srv)
  pc = await launch(pcDir)
})
test.afterAll(async () => {
  await phone?.app.close().catch(() => undefined)
  await pc?.app.close().catch(() => undefined)
  await server?.close()
})

test('a phone joins with the link and gets everything', async () => {
  const { page } = pc
  const customer = await page.evaluate(() => window.plannr.customers.create({ name: 'Dana Whitfield', phone: '555-0142' }))
  const ticket = await page.evaluate(
    (id) => window.plannr.tickets.create({ customerId: id }).then((t) => window.plannr.tickets.update(t.id, { device: 'Pixel 7 screen' })),
    customer.id
  )
  const png = [...makePng(60, 40)]
  const file = await page.evaluate((bytes) => window.plannr.files.save({ name: 'board.png', mime: 'image/png', data: new Uint8Array(bytes) }), png)
  await page.evaluate(([t, f]) => window.plannr.photos.add(t, [f], 'before'), [ticket.id, file.id])
  await page.evaluate(() => window.plannr.notes.create({ title: 'Supplier list' }))
  await page.evaluate(() => window.plannr.tasks.create({ title: 'Order screen protectors' }))
  await page.evaluate(async () => {
    await window.plannr.vault.setup('shop vault passcode')
    const item = await window.plannr.vault.create('login')
    await window.plannr.vault.update(item.id, { title: 'Parts supplier', fields: { username: 'nano', password: 'pa55-word' } })
  })
  await page.evaluate(() => window.plannr.sync.setup(location.href, 'x').catch(() => null)) // warm-up no-op
  const status = await page.evaluate((url) => window.plannr.sync.setup(url, 'test-setup-code'), server.url)
  expect(status.enabled).toBe(true)
  const link = (await page.evaluate(() => window.plannr.sync.link()))!

  phone = await launchPhone(link, phoneProfile)
  phone.page.on('console', (m) => m.type() === 'error' && phoneErrors.push(m.text()))
  phone.page.on('pageerror', (e) => phoneErrors.push(String(e)))
  await expect(phone.page.getByText('Add Plannr to your Home Screen')).toBeVisible({ timeout: 20_000 })
  await shot(phone.page, 'w1-install')
  await phone.page.getByRole('button', { name: 'Or use it here in Safari' }).click()
  await expect(phone.page.locator('.app')).toBeVisible({ timeout: 30_000 })
  expect(new URL(phone.page.url()).hash).toBe('') // the key left the address bar
  await shot(phone.page, 'w2-home')
  for (const tab of ['Tasks', 'Tickets', 'Calendar']) {
    await phone.page.locator('.mobile-tabs button', { hasText: tab }).click()
    await phone.page.waitForTimeout(400)
    await shot(phone.page, 'w3-' + tab.toLowerCase())
  }
  await phone.page.locator('.mobile-tabs button', { hasText: 'More' }).click()
  await phone.page.waitForTimeout(400)
  await shot(phone.page, 'w4-drawer')
  await phone.page.locator('.sidebar .nav-item', { hasText: 'Customers' }).click()
  await phone.page.waitForTimeout(400)
  await shot(phone.page, 'w5-customers')
  await phone.page.locator('.mobile-tabs button', { hasText: 'Tickets' }).click()
  await phone.page.locator('.ticket-row').first().click()
  await phone.page.waitForTimeout(800)
  await shot(phone.page, 'w6-ticket')

  // The ticket's photo shows (served from the phone's own storage).
  await phone.page.getByRole('button', { name: /Photos/ }).click()
  const img = phone.page.locator('.thumb img').first()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 15_000 }).toBe(60)

  // Something added on the phone reaches the PC.
  await phone.page.locator('.mobile-tabs button', { hasText: 'Tasks' }).click()
  const add = phone.page.getByPlaceholder(/Add a task/)
  await add.fill('Call Dana back')
  await add.press('Enter')
  await expect.poll(() => phone.page.evaluate(() => window.plannr.sync.status().then((s) => s.pending)), { timeout: 15_000 }).toBe(0)
  await page.evaluate(() => window.plannr.sync.syncNow())
  expect(await page.evaluate(() => window.plannr.tasks.list().then((l) => l.map((t) => t.title).sort()))).toEqual(['Call Dana back', 'Order screen protectors'])

  // The vault opens on the phone with the PC's passcode.
  await phone.page.locator('.mobile-tabs button', { hasText: 'More' }).click()
  await phone.page.locator('.sidebar .nav-item', { hasText: 'Vault' }).click()
  await phone.page.getByLabel('Vault passcode').fill('shop vault passcode')
  await phone.page.getByLabel('Vault passcode').press('Enter')
  await expect(phone.page.getByText('Parts supplier').first()).toBeVisible({ timeout: 30_000 })
  expect(await phone.page.evaluate(() => window.plannr.vault.list().then((l) => l.map((i) => i.title)))).toEqual(['Parts supplier'])
  await shot(phone.page, 'w7-vault')

  // Closing and opening it again: everything is still there, no joining needed.
  await phone.page.reload()
  await expect(phone.page.locator('.app')).toBeVisible({ timeout: 20_000 })
  expect(await phone.page.evaluate(() => window.plannr.tickets.list({}).then((l) => l.length))).toBe(1)
  console.log('phone errors:', phoneErrors)
})
