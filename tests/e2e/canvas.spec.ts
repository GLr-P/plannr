import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, root, shot } from './helpers'

// Canvas templates: put anything anywhere and resize it (like Canva), then fill it in on a ticket.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-canvas-'))
let app: ElectronApplication
let page: Page
let templateId = ''

const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const item = (label: string) => page.locator(`.cv-item[data-label="${label}"]`)
const textItem = (text: string) => page.locator('.cv-item.cv-type-canvasText', { hasText: text })
type Box = { x: number; y: number; w: number; h: number }
const boxes = () =>
  page.evaluate(async (id) => {
    const t = await window.plannr.templates.get(id)
    return (t!.content!.content ?? []).map((i) => ({ type: i.type, label: String(i.attrs?.label ?? i.attrs?.text ?? ''), box: i.attrs?.box as Box, attrs: i.attrs }))
  }, templateId)
const boxOf = async (label: string) => (await boxes()).find((b) => b.label === label)!

/** Drags with the real mouse from the middle of an element by (dx, dy) screen pixels. */
async function dragBy(el: ReturnType<Page['locator']>, dx: number, dy: number, at?: { x: number; y: number }): Promise<void> {
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' })) // clear of the toolbar pinned at the top
  const r = (await el.boundingBox())!
  const x = at ? r.x + at.x : r.x + r.width / 2
  const y = at ? r.y + at.y : r.y + r.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('a new canvas template starts with a heading, the customer and the dates', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Templates' }).click()
  await page.getByRole('button', { name: 'New canvas template' }).click()
  await page.getByLabel('Template name').fill('Canvas order')
  await expect(page.locator('.cv-design')).toBeVisible()
  await expect(textItem('Order form')).toBeVisible()
  for (const label of ['Customer name', 'Phone', 'Email', 'Address', 'Received', 'Pickup', 'Notes']) await expect(item(label)).toBeVisible()
  await saved()
  templateId = await page.evaluate(() => window.plannr.templates.list().then((l) => l.find((t) => t.name === 'Canvas order')!.id))
  await shot(page, 'cv1-designer')
})

test('drag anything anywhere, resize from the corners, with alignment guides', async () => {
  const before = await boxOf('Notes')
  // Select it, then resize from the bottom-right corner: narrower and taller
  await item('Notes').click()
  await expect(item('Notes')).toHaveClass(/selected/)
  await dragBy(item('Notes').locator('.cv-handle-se'), -300, 40)
  await expect.poll(async () => (await boxOf('Notes')).box.w).toBeLessThan(before.box.w - 250)
  const resized = await boxOf('Notes')
  expect(resized.box.h).toBeGreaterThan(before.box.h + 20)

  // Drag it down and right: it moves by that much (the page is shown at about 1:1)
  await dragBy(item('Notes'), 120, 60)
  await expect.poll(async () => (await boxOf('Notes')).box.x).toBeGreaterThan(resized.box.x + 100)
  expect((await boxOf('Notes')).box.y).toBeGreaterThan(resized.box.y + 40)
  await shot(page, 'cv1b-moved')

  // While dragging near another item's edge, a guide shows and the edges line up
  const name = await boxOf('Customer name')
  const notes = item('Notes')
  await notes.evaluate((n) => n.scrollIntoView({ block: 'center' }))
  const r = (await notes.boundingBox())!
  const nameBox = (await item('Customer name').boundingBox())!
  await page.mouse.move(r.x + 20, r.y + 20)
  await page.mouse.down()
  await page.mouse.move(nameBox.x + 20 + 3, r.y + 20, { steps: 6 }) // left edge 3px off the name field's
  await expect(page.locator('.cv-guide-x')).toBeVisible()
  await shot(page, 'cv2-guides')
  // A screenshot can report where the real (Windows) mouse is: put the test mouse back before letting go
  await page.mouse.move(nameBox.x + 20 + 3, r.y + 20)
  await page.mouse.up()
  await expect.poll(async () => (await boxOf('Notes')).box.x).toBe(name.box.x)

  // Arrow keys nudge; Ctrl+Z puts it back
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await boxOf('Notes')).box.x).toBe(name.box.x + 1)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await boxOf('Notes')).box.x).toBe(name.box.x)
  await saved()
})

test('add text, a box and a picture-free design; style and edit them', async () => {
  await page.locator('.cv-toolbar').getByRole('button', { name: 'Text', exact: true }).click()
  const added = textItem('Text')
  await expect(added).toHaveClass(/selected/)
  await added.dblclick()
  await page.locator('.cv-edit-text').fill('Thank you for your order!')
  await page.keyboard.press('Escape')
  await expect(textItem('Thank you for your order!')).toBeVisible()
  await page.locator('.cv-props').getByLabel('Size').fill('22')
  await page.locator('.cv-props').getByRole('button', { name: 'Bold' }).click()
  await page.locator('.cv-props').getByRole('radio', { name: '#db2777' }).click()
  await expect.poll(async () => (await boxOf('Thank you for your order!'))?.attrs?.style).toMatchObject({ size: 22, bold: true, color: '#db2777' } as never)

  await page.locator('.cv-toolbar').getByRole('button', { name: 'Box', exact: true }).click()
  await page.locator('.cv-props').getByRole('radiogroup', { name: 'Fill' }).getByRole('radio', { name: '#fdf2f8' }).click()
  await page.locator('.cv-props').getByRole('button', { name: 'Send to back' }).click()
  // Behind everything, with its fill
  await expect.poll(async () => (await boxes()).map((b) => [b.type, b.attrs?.fill ?? null])[0]).toEqual(['canvasShape', '#fdf2f8'])

  // Field settings from the bar
  await item('Notes').click()
  await page.locator('.cv-props').getByRole('button', { name: 'Field settings' }).click()
  await page.locator('.ff-config').getByLabel('Field label').fill('Special instructions')
  await page.locator('.ff-config').getByRole('radiogroup', { name: 'Lines when printed' }).getByRole('radio', { name: 'None' }).click()
  await page.locator('.ff-config').getByRole('button', { name: 'Answer italic' }).click()
  await page.locator('.ff-config').getByLabel('Answer size').fill('18')
  await page.locator('.ff-config').getByLabel('Answer size').scrollIntoViewIfNeeded()
  await shot(page, 'cv2c-field-text-style')
  await page.locator('.ff-config').getByRole('button', { name: 'Done' }).click()
  await expect(item('Special instructions')).toBeVisible()

  // Delete removes; undo brings it back
  await page.locator('.cv-toolbar').getByRole('button', { name: 'Line', exact: true }).click()
  await expect.poll(async () => (await boxes()).filter((b) => b.type === 'canvasShape').length).toBe(2) // the line is saved
  const count = (await boxes()).length
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await boxes()).length).toBe(count - 1)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await boxes()).length).toBe(count)
  // A calculated field: worked out from another field
  await page.locator('.cv-toolbar').getByRole('button', { name: 'Field', exact: true }).click()
  let cfg = page.locator('.ff-config')
  await cfg.getByLabel('Field label').fill('Deposit')
  await cfg.getByLabel('Field type').selectOption({ label: 'Money' })
  await cfg.getByRole('button', { name: 'Done' }).click()
  await page.locator('.cv-toolbar').getByRole('button', { name: 'Field', exact: true }).click()
  cfg = page.locator('.ff-config')
  await cfg.getByLabel('Field label').fill('Balance')
  await cfg.getByLabel('Field type').selectOption({ label: 'Calculated' })
  await cfg.getByLabel('Formula').fill('250 - ')
  await cfg.locator('.ff-formula-names').getByRole('button', { name: 'Deposit' }).click() // puts {Deposit} in
  await expect(cfg.getByLabel('Formula')).toHaveValue('250 - {Deposit}')
  await expect(cfg.locator('.ff-config-note')).not.toHaveClass(/warn/)
  await shot(page, 'cv3b-formula')
  await cfg.getByRole('button', { name: 'Done' }).click()
  await expect(item('Balance')).toBeVisible()

  await page.keyboard.press('Escape') // clears the selection
  await saved()
  await page.locator('.main').evaluate((el) => el.scrollTo(0, 0))
  await shot(page, 'cv3-designed')
})

test('a ticket from the canvas: fill it in; linked fields fill the customer', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).click()
  await page.getByRole('button', { name: 'Choose template' }).click()
  await page.locator('.menu-item', { hasText: 'Canvas order' }).click()
  await expect(page.locator('.cv-live')).toBeVisible()
  await expect(page.locator('.props')).toHaveCount(0) // the canvas holds the customer and dates
  const field = (label: string) => page.locator(`.cv-live .ff[data-label="${label}"]`)
  await field('Customer name').locator('input').fill('Rosa Lima')
  await field('Customer name').locator('input').press('Tab')
  await field('Phone').locator('input').fill('555-0123')
  await field('Special instructions').locator('textarea').fill('Leave at the side door')
  await field('Pickup').locator('input').fill('2026-10-24')
  await field('Deposit').locator('input').fill('100')
  await expect(field('Balance').locator('input')).toHaveValue('$150.00')
  await saved()
  await shot(page, 'cv4-ticket')

  const t = await page.evaluate(() => window.plannr.tickets.list({ query: 'Rosa' }).then((l) => l[0]))
  expect(t.customerName).toBe('Rosa Lima')
  expect(t.customerPhone).toBe('555-0123')
  expect(t.pickupOn).toBe('2026-10-24')
  const found = await page.evaluate(() => window.plannr.search.query('side door'))
  expect(found.some((r) => r.type === 'ticket')).toBe(true)

  // Print → Form: the canvas as designed, with everything filled in
  const out = join(dataDir, 'last-print.html')
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Form (everything, as designed)' }).click()
  await expect.poll(() => (existsSync(out) ? readFileSync(out, 'utf8') : '')).toContain('Leave at the side door')
  const printed = readFileSync(out, 'utf8')
  for (const text of ['Rosa Lima', '555-0123', '$150.00', 'Thank you for your order!', 'Special instructions']) expect(printed).toContain(text)
  expect(printed).toMatch(/bare">Leave at the side door/) // printed without its line or box
  expect(printed).toMatch(/class="ff top vi"><div class="fl"[^>]*>Special instructions<\/div><div style="font-size:18px"/) // italic answer, its own size
  // What it looks like on paper
  const preview = await app.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({ show: false, width: 820, height: 1060, webPreferences: { javascript: false } })
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const img = await w.webContents.capturePage()
    w.destroy()
    return img.toPNG().toString('base64')
  }, printed)
  writeFileSync(join(root, 'test-results', 'screens', 'cv5-printed-form.png'), Buffer.from(preview, 'base64'))

  // After a restart the canvas and what was typed are still there
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).click()
  await page.locator('.ticket-row').first().click()
  await expect(page.locator('.cv-live .ff[data-label="Special instructions"] textarea')).toHaveValue('Leave at the side door')
})
