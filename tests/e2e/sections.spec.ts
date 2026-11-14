import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Flexible tickets: a new ticket holds the minimum; sections, parts and presets are added with + Add.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-sections-'))
let app: ElectronApplication
let page: Page
const nav = (name: string) => page.locator('.sidebar .nav-item', { hasText: name }).first()
const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const sections = () => page.locator('.ticket-body .ticket-section')
const sectionTitles = () => sections().locator('.ticket-section-title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
const openAdd = async () => {
  await page.locator('.ticket-add-row').getByRole('button', { name: 'Add a section' }).click()
  await expect(page.getByLabel('Search sections')).toBeFocused()
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('a new ticket is the minimum: no sections, no photos, no pickup date', async () => {
  await nav('Tickets').click()
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('Dell laptop')
  await page.getByLabel('What they need').fill('Runs slow, wants a tune-up')
  await expect(sections()).toHaveCount(0)
  await expect(page.getByLabel('Pickup date')).toHaveCount(0)
  await expect(page.locator('.photo-gallery, .photos')).toHaveCount(0)
  await expect(page.getByLabel('Price')).toBeVisible()
  await saved()
  await shot(page, 's1-minimal-ticket')
})

test('+ Add finds a section by typing and puts the cursor in its first box', async () => {
  await openAdd()
  await shot(page, 's2-add-menu')
  await page.keyboard.type('passcode')
  await page.keyboard.press('Enter')
  await expect(sections()).toHaveCount(1)
  await expect.poll(sectionTitles).toEqual(['Passcode & logins'])
  await page.keyboard.type('4540')
  await expect(sections().first().locator('input').nth(1)).toHaveValue('4540')
  await saved()
})

test('parts: photos and a pickup date appear when added, and go away when removed', async () => {
  await openAdd()
  await page.keyboard.type('pickup')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Pickup date')).toBeVisible()
  await openAdd()
  await page.keyboard.type('pickup')
  await expect(page.locator('.add-ticket-item.on', { hasText: 'Pickup / due date' })).toContainText('Remove')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Pickup date')).toHaveCount(0)
})

test('a preset adds its sections, skipping ones already there', async () => {
  await page.locator('.page-toolbar').getByRole('button', { name: 'Add', exact: true }).click()
  await page.keyboard.type('remote')
  await page.locator('.add-ticket-item', { hasText: 'Remote support' }).click()
  await expect.poll(sectionTitles).toEqual(['Passcode & logins', 'Remote session', 'Work done', 'Recommendations'])
  await expect(page.locator('.prop', { hasText: 'Warranty' })).toBeVisible() // the preset's part
  await saved()
  await shot(page, 's3-preset-added')
})

test('a section can be renamed, moved and removed (with undo)', async () => {
  const work = sections().filter({ has: page.locator('[data-preset="work"], .ticket-section-title') }).nth(2)
  await work.hover()
  await work.getByRole('button', { name: /Move “Work done” up/ }).click()
  await expect.poll(sectionTitles).toEqual(['Passcode & logins', 'Work done', 'Remote session', 'Recommendations'])
  const title = sections().nth(1).locator('.ticket-section-title')
  await title.fill('What I did')
  await sections().nth(3).hover()
  await sections().nth(3).getByRole('button', { name: /Remove/ }).click()
  await expect.poll(sectionTitles).toEqual(['Passcode & logins', 'What I did', 'Remote session'])
  await page.locator('.toast button', { hasText: 'Undo' }).click()
  await expect.poll(sectionTitles).toEqual(['Passcode & logins', 'What I did', 'Remote session', 'Recommendations'])
  await saved()
})

test('everything is still there after a restart, and search finds section text', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await nav('Tickets').click()
  await page.locator('.ticket-row, .list-row', { hasText: 'Dell laptop' }).first().click()
  await expect.poll(sectionTitles).toEqual(['Passcode & logins', 'What I did', 'Remote session', 'Recommendations'])
  await expect(sections().first().locator('input').nth(1)).toHaveValue('4540')
  await shot(page, 's4-after-restart')
})
