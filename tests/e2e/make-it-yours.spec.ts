import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// "I want everything customizable, without waiting for an update": statuses, every box on a ticket, your own
// sections and presets, and customer pages, all changed right where they show.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-yours-'))
let app: ElectronApplication
let page: Page
const nav = (name: string) => page.locator('.sidebar .nav-item', { hasText: name }).first()
const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const sectionTitles = () => page.locator('.ticket-body .ticket-section .ticket-section-title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
const openAdd = async () => {
  await page.locator('.page-toolbar').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByLabel('Search sections')).toBeFocused()
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('statuses are edited from the status menu: rename, add, mark finished', async () => {
  await nav('Tickets').click()
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title').fill('Wedding flowers')
  await page.getByLabel('Status').selectOption({ label: 'Edit statuses…' })
  const editor = page.locator('.status-editor')
  await expect(editor).toBeVisible()
  await editor.getByLabel('Status name').first().fill('New order')
  await editor.getByLabel('Status name').first().press('Enter')
  await editor.getByRole('button', { name: 'New status' }).click()
  await page.keyboard.type('Delivered')
  await page.keyboard.press('Enter')
  await editor.locator('li', { has: page.locator('input[value="Delivered"]') }).getByLabel('Finished').check()
  await shot(page, 'y1-status-editor')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Status').locator('option')).toContainText(['New order', 'Diagnosing', 'Waiting on parts', 'Ready for pickup', 'Picked up', 'Delivered'])
  await page.getByLabel('Status').selectOption({ label: 'Delivered' })
  await saved()
  await nav('Tickets').click()
  await expect(page.locator('.chips')).toContainText('Delivered')
  await expect(page.locator('.ticket-row', { hasText: 'Wedding flowers' })).toHaveCount(0) // finished, so not "Open"
  await page.getByRole('tab', { name: 'Delivered' }).click()
  await expect(page.locator('.ticket-row', { hasText: 'Wedding flowers' })).toContainText('Delivered')
})

test('Customize renames and removes any box on a ticket; + Add brings them back', async () => {
  await page.locator('.ticket-row', { hasText: 'Wedding flowers' }).click()
  await page.getByRole('button', { name: 'Customize' }).click()
  await expect(page.locator('.customize-banner')).toBeVisible()
  await page.getByLabel('Name for Customer').fill('Client')
  await page.getByRole('button', { name: 'Remove Phone' }).click()
  await page.getByRole('button', { name: 'Remove Status' }).click()
  await page.getByLabel('Name for Title').fill('Order')
  await shot(page, 'y2-customizing')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.prop-label', { hasText: 'Client' })).toBeVisible()
  await expect(page.getByLabel('Customer phone')).toHaveCount(0)
  await expect(page.getByLabel('Status')).toHaveCount(0)
  await expect(page.getByLabel('Order')).toHaveValue('Wedding flowers')
  await saved()

  await openAdd()
  await expect(page.locator('.add-ticket-heading').first()).toHaveText('Removed from this ticket')
  await page.locator('.add-ticket-group').first().locator('.add-ticket-item', { hasText: 'Phone' }).click()
  await expect(page.getByLabel('Customer phone')).toBeVisible()
  await saved()

  // It sticks after a restart
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await nav('Tickets').click()
  await page.getByRole('tab', { name: 'All' }).click()
  await page.locator('.ticket-row', { hasText: 'Wedding flowers' }).click()
  await expect(page.locator('.prop-label', { hasText: 'Client' })).toBeVisible()
  await expect(page.getByLabel('Status')).toHaveCount(0)
})

test('your own section: make it, save it, and it is offered on the next ticket', async () => {
  await openAdd()
  await page.keyboard.type('new section')
  await page.locator('.add-ticket-item', { hasText: 'New section' }).click()
  await expect(page.getByLabel('Section name').last()).toBeFocused()
  await page.keyboard.type('Flower colours')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Blush and ivory')
  const section = page.locator('.ticket-body .ticket-section').last()
  await section.hover()
  await section.getByRole('button', { name: /More for/ }).click()
  await page.locator('.ctx-item', { hasText: 'Save as a new section' }).click()
  await expect(page.locator('.toast')).toContainText('Saved “Flower colours”')

  // A built-in one can be hidden from the list, and shown again
  await openAdd()
  await page.locator('.add-ticket-row', { hasText: 'Delivery' }).first().hover()
  await page.getByRole('button', { name: 'Hide Delivery' }).click()
  await expect(page.locator('.add-ticket-title', { hasText: /^Delivery$/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Show hidden sections/ }).click()
  await page.locator('.add-ticket-item', { hasText: 'Unhide' }).first().click()
  await page.keyboard.press('Escape')

  await nav('Tickets').click()
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await openAdd()
  await page.keyboard.type('flower')
  await expect(page.locator('.add-ticket-item').first()).toContainText('Flower colours')
  await page.keyboard.press('Enter')
  await expect.poll(sectionTitles).toEqual(['Flower colours'])
  await expect(page.locator('.ticket-body .ticket-section').last()).not.toContainText('Blush and ivory') // only the layout is saved
  await saved()
})

test('a ticket can be saved as a new preset, which then makes new tickets', async () => {
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('button', { name: 'Save as a new preset…' }).click()
  await page.getByLabel('Preset name').fill('Wedding order')
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast')).toContainText('Saved “Wedding order”')
  await page.getByRole('button', { name: 'Done' }).click()
  await nav('Tickets').click()
  await page.getByRole('button', { name: 'Choose template' }).click()
  await page.locator('.dropdown-menu .menu-item', { hasText: 'Wedding order' }).click()
  await expect.poll(sectionTitles).toEqual(['Flower colours'])
})

test('customer pages: rename and hide parts, add your own field, for every customer', async () => {
  await nav('Customers').click()
  await page.locator('.main').getByRole('button', { name: /New customer/ }).click()
  await page.keyboard.type('Maya')
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByLabel('New field name').fill('Birthday')
  await page.getByLabel('New field type').selectOption('date')
  await page.getByRole('button', { name: 'Add field' }).click()
  await page.getByLabel('Name for Phone').fill('Cell')
  await page.getByLabel('Name for Phone').press('Enter')
  await page.getByRole('button', { name: 'Hide Notes' }).click()
  await shot(page, 'y3-customer-customizing')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.prop-label', { hasText: 'Cell' })).toBeVisible()
  await expect(page.getByLabel('Customer notes')).toHaveCount(0)
  await page.locator('.add-chips').getByRole('button', { name: 'Birthday' }).click()
  await page.getByLabel('Birthday').fill('1990-05-04')
  await saved()

  // Another customer gets the same page
  await nav('Customers').click()
  await page.locator('.main').getByRole('button', { name: /New customer/ }).click()
  await page.keyboard.type('Ben')
  await expect(page.locator('.prop-label', { hasText: 'Cell' })).toBeVisible()
  await expect(page.locator('.add-chips')).toContainText('Birthday')
  await expect(page.getByLabel('Customer notes')).toHaveCount(0)
  await shot(page, 'y4-customer-page')
})
