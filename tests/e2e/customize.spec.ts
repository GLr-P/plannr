import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Making Plannr your own: look, menu, Home, ticket numbers and statuses, money display, calendar.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-customize-'))
let app: ElectronApplication
let page: Page
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const tab = (name: string) => page.getByRole('tab', { name, exact: true })
const settings = async (tabName: string) => {
  await page.keyboard.press('Control+,')
  await tab(tabName).click()
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('look: accent colour, compact spacing and text size', async () => {
  await settings('General')
  await page.getByRole('radio', { name: 'Green' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'green')
  await page.getByRole('radio', { name: 'Compact' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await page.getByRole('radio', { name: 'Large', exact: true }).click()
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(1.1)
  await shot(page, 'z1-look')
  await page.getByRole('radio', { name: 'Default' }).click() // back to normal size for the screenshots that follow
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(1)
})

test('layout: hide a menu item; reorder and hide Home sections', async () => {
  await settings('Layout')
  await page.locator('.check-row', { hasText: 'Money' }).locator('input').uncheck()
  await expect(nav('Money')).toHaveCount(0)
  await page.getByRole('button', { name: 'Move recent up' }).click()
  await page.getByRole('button', { name: 'Move recent up' }).click()
  await page.locator('.order-list .check-row', { hasText: 'Coming up' }).locator('input').uncheck()
  await shot(page, 'z2-layout')

  await page.evaluate(() => window.plannr.notes.create({ title: 'Shop hours' }))
  await page.reload()
  await page.waitForSelector('.sidebar')
  await nav('Home').click()
  const titles = await page.locator('.home .section-title').allTextContents()
  expect(titles[0]).toBe('Recent') // moved above Open tickets/Pinned
  expect(titles).not.toContain('Coming up')
  await page.keyboard.press('Control+6') // Money is hidden, so the 6th item is Inventory (Home, Tasks, Tickets, Customers, Calendar, Inventory)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inventory')
})

test('tickets: your own number prefix and status names', async () => {
  await settings('Tickets')
  await page.getByLabel('Ticket number prefix').fill('AB-')
  await page.getByLabel('Name for Intake').fill('Checked in')
  await page.getByLabel('Name for Ready for pickup').click() // leaving a field saves it
  await expect(page.locator('.setting', { hasText: 'Ticket numbers' })).toContainText('AB-0007')
  await shot(page, 'z3-tickets')

  await page.keyboard.press('Control+t')
  await expect(page.locator('.ticket-no')).toHaveText('AB-0001')
  await expect(page.getByLabel('Status')).toContainText('Checked in')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('ab1')
  await expect(page.locator('.search-row').first()).toContainText('AB-0001')
  await page.keyboard.press('Escape')
})

test('business: currency and payment methods; calendar: week starts on Monday', async () => {
  await settings('Business')
  await page.getByLabel('Currency').selectOption('EUR')
  await page.getByLabel('Payment methods').fill('Cash\nInterac e-Transfer\nCard')
  await page.locator('.setting', { hasText: 'Payment methods' }).locator('p').click() // leaving the box saves it

  await nav('Tickets').click()
  await page.locator('.ticket-row', { hasText: 'AB-0001' }).click()
  await page.getByLabel('Price').fill('100')
  await page.getByLabel('Price').press('Enter')
  await expect(page.getByLabel('Price')).toHaveValue('€100.00')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByLabel('Payment method').locator('option')).toHaveText(['Cash', 'Interac e-Transfer', 'Card'])
  await page.keyboard.press('Escape')

  await settings('General')
  await page.getByRole('radio', { name: 'Monday' }).click()
  await nav('Calendar').click()
  await expect(page.locator('.fc-col-header-cell').first()).toContainText(/Mon/i)
})
