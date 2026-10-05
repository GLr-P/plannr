import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Note templates ("types" of note), tables and callouts.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-templates-'))
let app: ElectronApplication
let page: Page
const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('New note ▾ offers the starter templates; a Repair guide comes with fields, a callout and a table', async () => {
  await page.getByRole('button', { name: 'Choose note template' }).click()
  const menu = page.locator('.dropdown-menu')
  for (const name of ['Blank note', 'Meeting notes', 'Checklist', 'Repair guide', 'Supplier', 'Inventory', 'Weekly plan', 'Daily log']) {
    await expect(menu).toContainText(name)
  }
  await menu.locator('.menu-item', { hasText: 'Repair guide' }).click()
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('iPhone 13 screen')
  await expect(page.locator('.prose .ff[data-label="Difficulty"] select')).toBeVisible()
  await expect(page.locator('.prose .callout-warning')).toContainText('Disconnect the battery')
  await expect(page.locator('.prose table th')).toHaveText(['Part', 'Supplier', 'Cost'])
  await expect(page.locator('.doc-icon svg.lucide-wrench')).toHaveCount(1) // the template's icon
  await saved()
  await shot(page, 't3-repair-guide')
})

test('tables: type in cells, right-click to add a row; callouts change kind when clicking the icon', async () => {
  await page.locator('.prose table td').first().click()
  await page.keyboard.type('Screen assembly')
  const rows = page.locator('.prose table tr')
  const before = await rows.count()
  await page.locator('.prose table td').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add row below' }).click()
  await expect(rows).toHaveCount(before + 1)

  const icon = page.locator('.prose .callout .callout-icon').first()
  await icon.click()
  await expect(page.locator('.prose .callout').first()).toHaveClass(/callout-danger/) // warning → important
  await saved()

  // A new table and callout from the / menu
  await page.locator('.prose > p').last().click()
  await page.keyboard.type('/table')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Table')
  await page.keyboard.press('Enter')
  await expect(page.locator('.prose table')).toHaveCount(2)
  await saved()
})

test('save a note as a template; it shows under Note templates and in New note ▾', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await page.locator('.note-row', { hasText: 'iPhone 13 screen' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Save as template' }).click()
  await expect(page.locator('.app-toast')).toContainText('iPhone 13 screen')

  await page.locator('.sidebar .nav-item', { hasText: 'Templates' }).click()
  await page.getByRole('tab', { name: 'Note templates' }).click()
  await expect(page.locator('.note-row', { hasText: 'iPhone 13 screen' })).toBeVisible()
  await expect(page.locator('.note-row', { hasText: 'Meeting notes' })).toBeVisible()
  await shot(page, 't4-note-templates')
  await page.getByRole('tab', { name: 'Ticket templates' }).click()
  await expect(page.locator('.note-row', { hasText: 'Repair intake' })).toBeVisible()
  await expect(page.locator('.note-row', { hasText: 'Meeting notes' })).toHaveCount(0)
})
