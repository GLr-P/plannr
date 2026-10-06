import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Quick capture: the small box (opened by the global shortcut, the tray menu or Settings) adds a task or a note.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-capture-'))
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('the box adds a task for today, then a note with a title and text; Plannr shows them', async () => {
  const opened = app.waitForEvent('window')
  await page.evaluate(() => window.plannr.app.openCapture())
  const box = await opened
  await box.waitForSelector('.capture')
  await expect(box.getByLabel('New task')).toBeFocused()
  await box.keyboard.type('Call back Priya')
  await box.locator('.capture-dates').getByRole('button', { name: 'Today' }).click()
  await shot(box, 'c6-capture')
  await box.keyboard.press('Enter')
  await expect(box.locator('.capture-saved')).toHaveText('Task added')
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length)).toBe(1) // the box hid itself

  await expect(page.locator('.sidebar .nav-item', { hasText: 'Tasks' }).first().locator('.nav-count')).toHaveText('1')

  // Open it again: fresh, and Tab switches to a note
  await page.evaluate(() => window.plannr.app.openCapture())
  await expect(box.getByLabel('New task')).toHaveValue('')
  await box.keyboard.press('Tab')
  await expect(box.getByLabel('New note')).toBeFocused()
  await box.keyboard.type('Supplier price list')
  await box.keyboard.press('Shift+Enter')
  await box.keyboard.type('Screens went up 5%')
  await box.keyboard.press('Enter')
  await expect(box.locator('.capture-saved')).toHaveText('Note saved')

  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  const row = page.locator('.note-row', { hasText: 'Supplier price list' })
  await expect(row).toContainText('Screens went up 5%')
})
