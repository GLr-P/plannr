import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Import contacts from a CSV, and export everything to plain files.
const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-portability-'))
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('contacts come in from a CSV; everything goes out as Markdown and CSV', async () => {
  const csv = join(dataDir, 'contacts.csv')
  writeFileSync(csv, 'Name,Mobile Phone,E-mail Address\nPriya Sharma,(555) 014-8821,priya@example.com\nMarcus Lee,555-019-4410,\n')
  expect(await page.evaluate((f) => window.plannr.data.importContacts(f), csv)).toEqual({ added: 2, skipped: 0 })
  await page.locator('.sidebar .nav-item', { hasText: 'Customers' }).first().click()
  await expect(page.locator('.customer-row, tr', { hasText: 'Priya Sharma' }).first()).toBeVisible()

  await page.evaluate(() => window.plannr.notes.create({ title: 'Shop hours' }))
  const out = mkdtempSync(join(tmpdir(), 'plannr-e2e-export-'))
  const r = await page.evaluate((f) => window.plannr.data.exportAll(f), out)
  expect(r?.notes).toBe(1)
  expect(existsSync(join(r!.folder, 'Notes', 'Shop hours.md'))).toBe(true)
  expect(readFileSync(join(r!.folder, 'Customers.csv'), 'utf8')).toContain('Priya Sharma,(555) 014-8821,priya@example.com')

  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'Backups & data' }).click()
  await expect(page.getByRole('button', { name: 'Export…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import CSV…' })).toBeVisible()
  await shot(page, 'p1-data')
})
