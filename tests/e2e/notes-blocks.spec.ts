import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Notes as Word + Excel + Canva: formatting, spreadsheets with formulas and charts, calculations, drawings, columns,
// contents, outline, versions, copies; sorting the notes list; circles, arrows, sticky notes and drawings on pages.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let noteId = ''
const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const block = async (name: string, item: string) => {
  await page.keyboard.type(`/${name}`)
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText(item)
  await page.keyboard.press('Enter')
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(mkdtempSync(join(tmpdir(), 'plannr-e2e-notes-blocks-'))))
})
test.afterAll(async () => {
  await app?.close()
})

test('formatting: colour, size and alignment from the selection toolbar', async () => {
  const n = await page.evaluate(() => window.plannr.notes.create({ title: 'Kitchen reno' }))
  noteId = n.id
  await page.reload()
  await page.waitForSelector('.sidebar')
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await page.locator('.note-row', { hasText: 'Kitchen reno' }).click()
  await page.locator('.editor .ProseMirror').click()
  await page.keyboard.type('Budget and plan')
  await page.keyboard.press('Shift+Home')
  await page.getByRole('button', { name: 'Text colour and highlight' }).click()
  await page.getByRole('button', { name: 'Text colour #d23f3f' }).click()
  await page.getByRole('button', { name: 'Text size' }).click()
  await page.getByRole('button', { name: 'Large' }).click()
  await page.getByRole('button', { name: 'Centre' }).click()
  const p = page.locator('.editor .ProseMirror p').first()
  await expect(p).toHaveAttribute('style', /text-align: center/)
  await expect(p.locator('span[style*="color"]')).toHaveAttribute('style', /font-size: 19px/)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
})

test('a spreadsheet with formulas, money and a chart', async () => {
  await block('spreadsheet', 'Spreadsheet')
  const sheet = page.locator('.sheet-block')
  await expect(sheet).toBeVisible()
  // Starts as Item / Qty / Price / Total with =B2*C2 and a SUM: fill two rows
  const cell = (r: number, c: number) => sheet.locator('.sheet-grid tbody tr').nth(r).locator('td').nth(c)
  await cell(1, 0).click()
  await page.keyboard.type('Cabinets')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Tab')
  await page.keyboard.type('450')
  await page.keyboard.press('Enter')
  await cell(2, 0).click()
  await page.keyboard.type('Paint')
  await page.keyboard.press('Tab')
  await page.keyboard.type('4')
  await page.keyboard.press('Tab')
  await page.keyboard.type('38.5')
  await page.keyboard.press('Enter')
  await expect(cell(1, 3)).toHaveText('$900.00')
  await expect(cell(3, 3)).toHaveText('$1,054.00')
  await sheet.getByLabel('Chart', { exact: true }).selectOption('bar')
  await expect(sheet.locator('.sheet-chart svg rect')).toHaveCount(2)
  await expect(sheet.locator('.sheet-chart')).toContainText('900') // the totals column
  await saved()
  await shot(page, 'nb1-sheet')
  const content = await page.evaluate((id) => window.plannr.notes.get(id).then((n) => JSON.stringify(n!.content)), noteId)
  expect(content).toContain('Cabinets')
})

test('a calculation, a drawing, columns and a table of contents', async () => {
  await page.locator('.editor .ProseMirror > p').last().click() // the empty line at the end
  await block('calculation', 'Calculation')
  await page.getByLabel('Calculation').fill('1054 * 1.12')
  await expect(page.locator('.math-result')).toHaveText('= 1,180.48')

  await page.locator('.editor .ProseMirror > p').last().click() // the empty line at the end
  await block('drawing', 'Drawing')
  const surface = page.locator('.draw-surface').first()
  await surface.scrollIntoViewIfNeeded()
  const r = (await surface.boundingBox())!
  await page.mouse.move(r.x + 40, r.y + 40)
  await page.mouse.down()
  await page.mouse.move(r.x + 120, r.y + 90, { steps: 6 })
  await page.mouse.move(r.x + 220, r.y + 60, { steps: 6 })
  await page.mouse.up()
  await expect(surface.locator('path')).toHaveCount(1)
  await page.getByRole('button', { name: 'Box' }).click()
  await page.mouse.move(r.x + 260, r.y + 40)
  await page.mouse.down()
  await page.mouse.move(r.x + 360, r.y + 120, { steps: 5 })
  await page.mouse.up()
  await expect(surface.locator('rect')).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo drawing' }).click()
  await expect(surface.locator('rect')).toHaveCount(0)
  await shot(page, 'nb2-drawing')

  await page.locator('.editor .ProseMirror > p').last().click() // the empty line at the end
  await block('columns', '2 columns')
  await page.keyboard.type('Left side')
  await expect(page.locator('.columns .column').first()).toContainText('Left side')

  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await block('h2', 'Heading 2')
  await page.keyboard.type('Overview')
  await page.keyboard.press('Enter')
  await block('contents', 'Table of contents')
  await expect(page.locator('.toc-block')).toContainText('Overview')
  await saved()
  await shot(page, 'nb3-blocks')
})

test('outline, earlier versions and a copy', async () => {
  await page.getByRole('button', { name: 'Outline' }).click()
  await expect(page.locator('.note-outline')).toContainText('Overview')
  await page.getByRole('button', { name: 'Outline' }).click()
  await page.getByRole('button', { name: 'Earlier versions' }).click()
  const dialog = page.getByRole('dialog', { name: 'Earlier versions' })
  await expect(dialog.locator('.version-list li').first()).toBeVisible()
  await shot(page, 'nb4-versions')
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await page.getByRole('button', { name: 'Duplicate note' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Kitchen reno (copy)')
})

test('the notes list sorts and shows cards', async () => {
  await page.evaluate(() => window.plannr.notes.create({ title: 'Aardvark facts' }))
  await page.reload()
  await page.waitForSelector('.sidebar')
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await page.getByLabel('Sort notes').selectOption('title')
  await expect(page.locator('.note-row').first()).toContainText('Aardvark facts')
  await page.getByRole('radio', { name: 'Cards' }).click()
  await expect(page.locator('.note-list.cards')).toBeVisible()
  await shot(page, 'nb5-cards')
  await page.getByRole('radio', { name: 'List', exact: true }).click()
  await page.getByLabel('Sort notes').selectOption('updated')
})

test('free-form pages: circles, arrows, sticky notes and drawings', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).click()
  await page.getByRole('button', { name: 'Choose note template' }).click()
  await page.locator('.menu-item', { hasText: 'Free-form page' }).click()
  const toolbar = page.locator('.cv-toolbar')
  for (const tool of ['Circle', 'Arrow', 'Sticky', 'Draw']) await toolbar.getByRole('button', { name: tool, exact: true }).click()
  await expect(page.locator('.cv-item .cv-shape')).toHaveCount(1)
  await expect(page.locator('.cv-item .cv-arrow')).toHaveCount(1)
  await expect(page.locator('.cv-item .cv-sticky')).toHaveCount(1)
  const drawing = page.locator('.cv-item.cv-type-canvasDrawing')
  await drawing.dblclick()
  const pad = page.locator('.cv-draw-edit .draw-surface')
  const r = (await pad.boundingBox())!
  await page.mouse.move(r.x + 30, r.y + 30)
  await page.mouse.down()
  await page.mouse.move(r.x + 150, r.y + 100, { steps: 6 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(drawing.locator('path')).toHaveCount(1)
  await shot(page, 'nb6-canvas')
})
