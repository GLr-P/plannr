import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePng, shot } from './helpers'

// A repair from intake to pickup, the way the shop uses it.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-tickets-'))
let app: ElectronApplication
let page: Page

const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const field = (label: string) => page.locator(`.prose .ff[data-label="${label}"]`)
const pngFile = (name: string, w = 400, h = 300): string => {
  const p = join(dataDir, name)
  writeFileSync(p, makePng(w, h))
  return p
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('creates a ticket from the starter template with a new customer', async () => {
  await nav('Tickets').click()
  await expect(page.locator('.empty-state')).toHaveText('No open tickets.')
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()

  await expect(page.locator('.ticket-no')).toHaveText('NT-0001')
  await expect(page.getByLabel('Device')).toBeFocused()
  await page.keyboard.type('iPhone 13 Pro')
  await page.getByLabel('Issue').fill('Cracked screen, touch not working')

  // Starter template fields are there
  await expect(field('Passcode')).toBeVisible()
  await expect(field('Data backup').locator('select')).toBeVisible()

  // New customer straight from the ticket
  await page.getByLabel('Customer', { exact: true }).fill('Jane Doe')
  await expect(page.locator('.picker-menu .menu-item', { hasText: 'New customer “Jane Doe”' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Customer name')).toHaveValue('Jane Doe')
  await page.getByLabel('Customer phone').fill('(555) 123-4567')
  await page.getByLabel('Customer email').fill('jane@example.com')

  await page.getByLabel('Price').fill('129.99')
  await page.getByLabel('Price').press('Enter')
  await expect(page.getByLabel('Price')).toHaveValue('$129.99')
  await page.getByLabel('Pickup date').fill('2026-10-10')

  // Fill template fields
  await field('Passcode').locator('input').fill('1234')
  await field('Data backup').locator('select').selectOption('Needed')
  await field('Condition on arrival').locator('textarea').fill('Scuffed corners, screen shattered top-left')
  await page.locator('.prose ul[data-type="taskList"] li input[type="checkbox"]').first().check()

  await page.getByLabel('Status').selectOption('diagnosing')
  await saved()
  await expect(nav('Tickets').locator('.nav-count')).toHaveText('1')
  await shot(page, 'b1-ticket')
})

test('adds before/after photos, views them full screen, and moves one', async () => {
  const header = page.locator('.photos-header')
  await expect(header).toContainText('None yet')
  await header.click()

  let chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add before photos' }).click()
  await (await chooser).setFiles([pngFile('b1.png'), pngFile('b2.png', 300, 400)])
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add after photos' }).click()
  await (await chooser).setFiles([pngFile('a1.png')])

  const before = page.locator('.photo-column[data-kind="before"] .thumb:not(.add-tile)')
  const after = page.locator('.photo-column[data-kind="after"] .thumb:not(.add-tile)')
  await expect(before).toHaveCount(2)
  await expect(after).toHaveCount(1)
  await expect(header).toContainText('2 before · 1 after')
  await shot(page, 'b2-photos')

  await before.first().locator('.thumb-open').click()
  const box = page.locator('.lightbox')
  await expect(box).toContainText('Before · 1 of 3')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(box).toContainText('After · 3 of 3')
  await shot(page, 'b3-lightbox')
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)

  await before.nth(1).dragTo(page.locator('.photo-column[data-kind="after"]'))
  await expect(before).toHaveCount(1)
  await expect(after).toHaveCount(2)
})

test('ticket list filters by status, phone in any format, repair number and date', async () => {
  await nav('Tickets').click()
  const rows = page.locator('.ticket-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Jane Doe')
  await expect(rows.first()).toContainText('$129.99')
  await expect(rows.first()).toContainText('Diagnosing')

  const search = page.getByLabel('Search tickets')
  for (const q of ['5551234567', '123-4567', 'NT-0001', 'jane@example', 'iphone', '1234']) {
    await search.fill(q)
    await expect(rows, `search "${q}"`).toHaveCount(1)
  }
  await search.fill('nobody here')
  await expect(page.locator('.empty-state')).toHaveText('No tickets match.')
  await search.fill('')

  await page.getByRole('tab', { name: 'Picked up' }).click()
  await expect(rows).toHaveCount(0)
  await page.getByRole('tab', { name: 'Open' }).click()
  await page.getByLabel('Received from').fill('2099-01-01')
  await expect(rows).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear dates' }).click()
  await expect(rows).toHaveCount(1)
  await shot(page, 'b4-ticket-list')
})

test('customer page shows details and repair history; new ticket from there keeps the customer', async () => {
  await nav('Customers').click()
  const row = page.locator('.customer-row', { hasText: 'Jane Doe' })
  await expect(row).toContainText('(555) 123-4567')
  await row.click()

  await expect(page.getByLabel('Customer name')).toHaveValue('Jane Doe')
  await page.getByLabel('Address').fill('12 Main St, Springfield')
  await expect(page.locator('.history-row')).toHaveCount(1)
  await expect(page.locator('.history-row')).toContainText('NT-0001')
  await saved()
  await shot(page, 'b5-customer')

  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await expect(page.locator('.ticket-no')).toHaveText('NT-0002')
  await expect(page.getByLabel('Customer name')).toHaveValue('Jane Doe')
  await page.keyboard.type('MacBook Air')
  await saved()
})

test('global search finds customers and tickets', async () => {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('jane')
  const results = page.locator('.search-row')
  await expect(results.filter({ hasText: 'Customer' })).toHaveCount(1)
  await expect(results.filter({ hasText: 'NT-0001 · iPhone 13 Pro' })).toHaveCount(1)
  await shot(page, 'b6-search')
  await results.filter({ hasText: 'NT-0001' }).click()
  await expect(page.locator('.ticket-no')).toHaveText('NT-0001')
})

test('edits the template with a new form field; new tickets get it', async () => {
  await nav('Templates').click()
  await expect(page.locator('.note-row')).toContainText('Default')
  await page.locator('.note-row', { hasText: 'Repair intake' }).click()
  await page.locator('.prose > p').last().click()
  await page.keyboard.type('/form')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Form field')
  await page.keyboard.press('Enter')
  await expect(page.locator('.ff-config')).toBeVisible()
  await page.getByLabel('Field label').fill('Screen protector')
  await page.getByLabel('Field type').selectOption('checkbox')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(field('Screen protector').locator('input[type="checkbox"]')).toBeVisible()
  await saved()
  await shot(page, 'b7-template')

  await nav('Tickets').click()
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await expect(page.locator('.ticket-no')).toHaveText('NT-0003')
  await expect(field('Screen protector')).toBeVisible()
  // Blank ticket via the arrow menu
  await nav('Tickets').click()
  await page.getByRole('button', { name: 'Choose template' }).click()
  await page.locator('.dropdown-menu .menu-item', { hasText: 'Blank ticket' }).click()
  await expect(page.locator('.ticket-no')).toHaveText('NT-0004')
  await expect(page.locator('.prose .ff')).toHaveCount(0)
})

test('a note can @-link a ticket, and the ticket shows it', async () => {
  await page.keyboard.press('Control+n')
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('Screen supplier')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ordered for ')
  await page.keyboard.type('@iphone')
  await expect(page.locator('.menu-item').first()).toContainText('NT-0001 · iPhone 13 Pro')
  await page.keyboard.press('Enter')
  await saved()
  await page.locator('.prose .mention').click()
  await expect(page.locator('.ticket-no')).toHaveText('NT-0001')
  await expect(page.locator('.backlinks', { hasText: 'Linked from' })).toContainText('Screen supplier')
})

test('business details print on the intake slip and receipt; the passcode is left off', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Business' }).click()
  await page.getByLabel('Business name').fill('Nano Tech Services')
  await page.getByLabel('Tax name').fill('GST')
  await page.getByLabel('Tax rate (%)').fill('5')
  await page.getByLabel('Phone', { exact: true }).click() // leaving a field saves it
  await expect(page.locator('.saved-flash')).toBeVisible()
  await shot(page, 'b10-business')

  await nav('Tickets').click()
  await page.locator('.ticket-row', { hasText: 'NT-0001' }).click()
  const out = join(dataDir, 'last-print.html')
  const printed = async (kind: string): Promise<string> => {
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await page.getByRole('menuitem', { name: kind }).click()
    await expect.poll(() => (existsSync(out) ? readFileSync(out, 'utf8') : '')).toContain(kind === 'Receipt' ? '<h1>Receipt</h1>' : kind === 'Device label' ? '@page { size: 62mm 29mm' : 'Repair ticket NT-0001')
    return readFileSync(out, 'utf8')
  }

  const slip = await printed('Intake slip')
  expect(slip).toContain('Nano Tech Services')
  expect(slip).toContain('Jane Doe')
  expect(slip).toContain('Scuffed corners')
  expect(slip).not.toContain('1234') // passcodes never go on paper

  // Look at the slip as printed
  const viewer = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, file) => {
    const w = new BrowserWindow({ width: 820, height: 1000, show: false })
    void w.loadFile(file)
  }, out)
  const slipPage = await viewer
  await slipPage.waitForLoadState()
  await slipPage.screenshot({ path: join('test-results', 'screens', 'b11-intake-slip.png') })
  await slipPage.close()

  const label = await printed('Device label')
  expect(label).toContain('NT-0001')
  const receipt = await printed('Receipt')
  expect(receipt).toContain('No payments recorded yet')
  expect(receipt).toContain('Balance owing')
})

test('everything is still there after restarting', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await expect(page.locator('.history-row:has(.mono)', { hasText: 'NT-0001' })).toBeVisible() // Home: open tickets
  await page.locator('.history-row:has(.mono)', { hasText: 'NT-0001' }).click()
  await expect(page.getByLabel('Device')).toHaveValue('iPhone 13 Pro')
  await expect(page.getByLabel('Customer phone')).toHaveValue('(555) 123-4567')
  await expect(page.getByLabel('Pickup date')).toHaveValue('2026-10-10')
  await expect(page.getByLabel('Status')).toHaveValue('diagnosing')
  await expect(field('Passcode').locator('input')).toHaveValue('1234')
  await expect(field('Data backup').locator('select')).toHaveValue('Needed')
  await expect(page.locator('.photos-header')).toContainText('1 before · 2 after')

  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.locator('.photos-header').click()
  await shot(page, 'b8-ticket-dark')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await shot(page, 'b9-home-dark')
})
