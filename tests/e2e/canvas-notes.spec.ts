import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Free-form pages in Notes: the same canvas as ticket templates (put anything anywhere), arranged or filled in.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let noteId = ''
const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const contentOf = () => page.evaluate((id) => window.plannr.notes.get(id).then((n) => n!.content), noteId)

test.beforeAll(async () => {
  ;({ app, page } = await launch(mkdtempSync(join(tmpdir(), 'plannr-e2e-canvas-notes-'))))
})
test.afterAll(async () => {
  await app?.close()
})

test('New note ▾ → Free-form page: arrange text and a field, then fill it in', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).click()
  await page.getByRole('button', { name: 'Choose note template' }).click()
  await page.locator('.menu-item', { hasText: 'Free-form page' }).click()
  await expect(page.locator('.cv-design')).toBeVisible()
  await page.getByLabel('Title').fill('Garden plan')
  await saved()
  noteId = await page.evaluate(() => window.plannr.notes.list().then((l) => l.find((n) => n.title === 'Garden plan')?.id ?? ''))
  expect(noteId).not.toBe('')
  // Notes don't offer the ticket's own parts
  const toolbar = page.locator('.cv-toolbar')
  for (const ticketOnly of ['Customer', 'Title', 'Dates', 'Photos', 'Payments']) await expect(toolbar.getByRole('button', { name: ticketOnly, exact: true })).toHaveCount(0)

  await toolbar.getByRole('button', { name: 'Heading', exact: true }).click()
  await page.locator('.cv-item.cv-type-canvasText').first().dblclick()
  await page.locator('.cv-edit-text').fill('Spring planting')
  await page.keyboard.press('Escape')
  await toolbar.getByRole('button', { name: 'Field', exact: true }).click()
  await page.locator('.ff-config').getByLabel('Field label').fill('Plants to buy')
  await page.locator('.ff-config').getByRole('button', { name: 'Done' }).click()
  await saved()
  await shot(page, 'cn1-arrange')

  await page.getByRole('radio', { name: 'Fill in' }).click()
  await expect(page.locator('.cv-live')).toBeVisible()
  await page.locator('.cv-live .ff[data-label="Plants to buy"] input').fill('Lavender and sage')
  await saved()
  await shot(page, 'cn2-fill')
  const content = await contentOf()
  expect(content?.type).toBe('canvas')
  expect(content?.content?.find((i) => i.type === 'formField')?.attrs?.value).toBe('Lavender and sage')
  expect(content?.content?.find((i) => i.type === 'canvasText')?.attrs?.text).toBe('Spring planting')
  // Searchable like any note
  const found = await page.evaluate(() => window.plannr.search.query('lavender'))
  expect(found.map((r) => r.id)).toContain(noteId)
})

test('reopening a page with fields opens it ready to fill in, with what was typed', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).click()
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await page.locator('.note-row', { hasText: 'Garden plan' }).first().click()
  await expect(page.locator('.cv-live')).toBeVisible()
  await expect(page.locator('.cv-live .ff[data-label="Plants to buy"] input')).toHaveValue('Lavender and sage')
  await expect(page.getByRole('radio', { name: 'Fill in' })).toHaveAttribute('aria-checked', 'true')
})
