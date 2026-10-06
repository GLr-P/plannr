import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, launchPhone, root, shot } from './helpers'
import { fakeServer, serveHttp } from '../support/d1'

// Two profiles on the PC, each with its own sync space on the same service; the phone holds both, separately.
test.describe.configure({ mode: 'serial' })

const pcDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-phoneprof-pc-'))
const phoneDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-phoneprof-phone-'))
const srv = fakeServer('test-setup-code', join(root, 'out', 'web'))
let server: Awaited<ReturnType<typeof serveHttp>>
let pc: { app: ElectronApplication; page: Page }
let phone: { app: ElectronApplication; page: Page }
let workLink = ''
let personalLink = ''
const phoneErrors: string[] = []

const noteTitles = (page: Page) => page.evaluate(() => window.plannr.notes.list().then((ns) => ns.map((n) => n.title).sort()))
const phoneSwitcher = () => phone.page.locator('.drawer-profile .brand-switch')

/** On the phone: opening a join link (as scanning the QR code does). */
async function openLink(link: string): Promise<void> {
  await phone.page.goto(link)
  await phone.page.reload() // a link that only changes the part after # doesn't load the page by itself
}

async function useHereInSafari(): Promise<void> {
  await expect(phone.page.getByText('Add Plannr to your Home Screen')).toBeVisible({ timeout: 20_000 })
  await phone.page.getByRole('button', { name: 'Or use it here in Safari' }).click()
  await expect(phone.page.locator('.app')).toBeVisible({ timeout: 30_000 })
}

test.beforeAll(async () => {
  server = await serveHttp(srv)
})
test.afterAll(async () => {
  await phone?.app.close().catch(() => undefined)
  await pc?.app.close().catch(() => undefined)
  await server?.close()
})

test('each PC profile syncs to its own space, and its link names the profile', async () => {
  pc = await launch(pcDir)
  await pc.page.evaluate(() => window.plannr.notes.create({ title: 'Work note' }))
  await pc.page.evaluate((url) => window.plannr.sync.setup(url, 'test-setup-code'), server.url)
  workLink = (await pc.page.evaluate(() => window.plannr.sync.link()))!
  expect(workLink).toMatch(/#join=[\w-]{43}&name=Main&color=[0-9a-f]{6}$/)

  const personal = await pc.page.evaluate(() => window.plannr.profiles.add('Personal', '#16a34a'))
  const closed = pc.app.waitForEvent('close')
  await pc.page.evaluate((id) => window.plannr.profiles.switch(id), personal.id).catch(() => undefined)
  await closed
  pc = await launch(pcDir)
  expect(await noteTitles(pc.page)).toEqual([])
  await pc.page.evaluate(() => window.plannr.notes.create({ title: 'Personal note' }))
  const status = await pc.page.evaluate((url) => window.plannr.sync.setup(url, 'test-setup-code'), server.url)
  expect(status.enabled).toBe(true)
  personalLink = (await pc.page.evaluate(() => window.plannr.sync.link()))!
  expect(personalLink).toContain('&name=Personal&color=16a34a')
  expect(personalLink.split('&')[0]).not.toBe(workLink.split('&')[0]) // a different space
})

test('the phone joins the first profile', async () => {
  phone = await launchPhone(workLink, phoneDir)
  phone.page.on('pageerror', (e) => phoneErrors.push(String(e)))
  await useHereInSafari()
  await expect.poll(() => noteTitles(phone.page), { timeout: 20_000 }).toEqual(['Work note'])
  await phone.page.locator('.mobile-tabs button', { hasText: 'More' }).click()
  await expect(phoneSwitcher()).toContainText('Plannr') // just one profile on this phone so far
})

test('opening the other profile’s link adds it as a separate profile', async () => {
  await openLink(personalLink)
  await useHereInSafari()
  await expect.poll(() => noteTitles(phone.page), { timeout: 20_000 }).toEqual(['Personal note'])
  expect(new URL(phone.page.url()).hash).toBe('')
  await phone.page.locator('.mobile-tabs button', { hasText: 'More' }).click()
  await expect(phoneSwitcher()).toContainText('Personal')
  await shot(phone.page, 'w10-drawer-profile')
  await phoneSwitcher().click()
  await expect(phone.page.getByRole('menuitem', { name: 'Main' })).toBeVisible()
  await shot(phone.page, 'w11-profile-menu')

  // Switch back: only the first profile's things
  await phone.page.getByRole('menuitem', { name: 'Main' }).click()
  await expect(phone.page.locator('.app')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => noteTitles(phone.page), { timeout: 20_000 }).toEqual(['Work note'])
  await phone.page.locator('.mobile-tabs button', { hasText: 'More' }).click()
  await expect(phoneSwitcher()).toContainText('Main')
})

test('opening a profile’s link again just opens that profile (no duplicate)', async () => {
  await openLink(personalLink)
  await expect(phone.page.locator('.app')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => noteTitles(phone.page), { timeout: 20_000 }).toEqual(['Personal note'])
  const state = await phone.page.evaluate(() => window.plannr.profiles.list())
  expect(state.profiles.map((p) => p.name)).toEqual(['Main', 'Personal'])
})

test('changes on the phone go to the right profile on the PC', async () => {
  await phone.page.evaluate(() => window.plannr.notes.create({ title: 'From the phone' }))
  await pc.page.evaluate(() => window.plannr.sync.syncNow()) // the PC has the Personal profile open
  await expect
    .poll(async () => {
      await phone.page.evaluate(() => window.plannr.sync.syncNow())
      await pc.page.evaluate(() => window.plannr.sync.syncNow())
      return noteTitles(pc.page)
    }, { timeout: 30_000 })
    .toEqual(['From the phone', 'Personal note'])

  // Settings on the phone lists both; removing one deletes it from the phone only
  await phone.page.evaluate(() => window.plannr.profiles.switch('main')).catch(() => undefined)
  await expect(phone.page.locator('.app')).toBeVisible({ timeout: 30_000 })
  await phone.page.locator('.mobile-tabs button', { hasText: 'More' }).click()
  await phone.page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await expect(phone.page.locator('.profile-row')).toHaveCount(2)
  await phone.page.waitForTimeout(400) // the menu slides away
  await shot(phone.page, 'w12-settings-profiles')
  expect(phoneErrors).toEqual([])
})
