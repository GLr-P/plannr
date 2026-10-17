import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePng, shot } from './helpers'

// Copying to other programs keeps the formatting (and pictures); pasting back into Plannr keeps everything;
// printing shows a preview first, with paper, orientation, margins, Print… and Save as PDF.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let dataDir = ''
/** The clipboard is the real Windows one: whatever was on it goes back afterwards */
let before: Record<string, string> = {}

/** What the Windows clipboard holds, by type */
const clipboard = (): Promise<Record<string, string>> =>
  app.evaluate(async ({ clipboard }) => {
    const out: Record<string, string> = {}
    for (const item of await clipboard.read())
      for (const type of item.types) {
        const value = await item.getType(type)
        if (value instanceof Blob) out[type] = await value.text()
      }
    return out
  })

const openNote = async (title: string): Promise<void> => {
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await page.locator('.note-row', { hasText: title }).click()
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-copy-print-'))
  ;({ app, page } = await launch(dataDir))
  before = await clipboard()
})
test.afterAll(async () => {
  await app?.evaluate(async ({ clipboard, ClipboardItem }, saved) => {
    const types = Object.fromEntries(Object.entries(saved).filter(([type]) => type === 'text/plain' || type === 'text/html'))
    if (Object.keys(types).length) await clipboard.write([new ClipboardItem(types)])
  }, before)
  await app?.close()
})

test('copying a note gives other programs its formatting and tidy text', async () => {
  await page.evaluate(() => window.plannr.notes.create({ title: 'Repair steps' }))
  await page.reload()
  await page.waitForSelector('.sidebar')
  await openNote('Repair steps')
  await page.locator('.editor .ProseMirror').click()
  const k = page.keyboard
  await k.type('## Screen swap')
  await k.press('Enter')
  await k.type('Use ')
  await k.press('Control+b')
  await k.type('gentle')
  await k.press('Control+b')
  await k.type(' heat and ')
  await k.press('Control+i')
  await k.type('patience')
  await k.press('Control+i')
  await k.press('Enter')
  await k.type('- Heat the edges')
  await k.press('Enter')
  await k.type('Lift with a suction cup')
  await k.press('Enter')
  await k.press('Enter')
  await k.type('[ ] Test the touch screen')
  await k.press('Enter')
  await k.press('Enter')
  await k.type('Done.')
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')

  await k.press('Control+a')
  await k.press('Control+c')
  await expect.poll(async () => (await clipboard())['text/plain'] ?? '').toContain('Done.')
  const clip = await clipboard()
  expect(clip['text/plain']).toBe(['Screen swap', 'Use gentle heat and patience', '• Heat the edges', '• Lift with a suction cup', '☐ Test the touch screen', 'Done.'].join('\n'))
  const html = clip['text/html']
  expect(html).toContain('<b>gentle</b>')
  expect(html).toContain('<i>patience</i>')
  expect(html).toContain('<li>Heat the edges</li>')
  expect(html).toContain('☐ Test the touch screen')
  expect(html).not.toContain('<input')

  // A few words from inside a line: just those words, still bold
  await page.locator('.editor .ProseMirror strong', { hasText: 'gentle' }).dblclick()
  await k.press('Control+c')
  await expect.poll(async () => (await clipboard())['text/plain']).toBe('gentle')
  expect((await clipboard())['text/html']).toMatch(/<b>gentle<\/b>/)
})

test('pasting a copy back into Plannr keeps lists and checkboxes', async () => {
  const editor = page.locator('.editor .ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+v')
  await expect(editor.locator('ul[data-type="taskList"] > li')).toHaveCount(2)
  await expect(editor.locator('h2', { hasText: 'Screen swap' })).toHaveCount(2)
  await expect(editor.locator('ul:not([data-type]) > li')).toHaveCount(4)
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
  await shot(page, 'cp1-pasted-back')
})

test('pictures go along as the pictures themselves', async () => {
  await page.evaluate(async (png) => {
    const data = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    const file = await window.plannr.files.save({ name: 'board.png', mime: 'image/png', data })
    const n = await window.plannr.notes.create({ title: 'Board photo' })
    await window.plannr.notes.update(n.id, {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The board:' }] }, { type: 'image', attrs: { src: `plannr://file/${file.id}` } }] }
    })
  }, makePng(120, 80).toString('base64'))
  await page.reload()
  await page.waitForSelector('.sidebar')
  await openNote('Board photo')
  await page.locator('.editor .ProseMirror p').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  await expect.poll(async () => (await clipboard())['text/html'] ?? '').toContain('src="data:image/png;base64,')

  // The note's right-click menu copies the whole note, title too
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await page.locator('.note-row', { hasText: 'Board photo' }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy text' }).click()
  await expect.poll(async () => (await clipboard())['text/plain']).toBe('Board photo\nThe board:')
  expect((await clipboard())['text/html']).toContain('<h1')
})

test('printing a note shows a preview first', async () => {
  await openNote('Repair steps')
  await page.getByRole('button', { name: 'Print note' }).click()
  const preview = page.getByRole('dialog', { name: 'Print preview' })
  await expect(preview.locator('.pp-page canvas')).toHaveCount(1)
  await expect(preview.locator('.pp-count')).toHaveText('1 page')
  await expect(preview).toContainText('Repair steps')
  await shot(page, 'pp1-note-preview')
  // Landscape makes the page wider than tall
  await preview.getByRole('radio', { name: 'Landscape' }).click()
  await expect.poll(async () => preview.locator('.pp-page canvas').first().evaluate((c: HTMLCanvasElement) => c.width > c.height)).toBe(true)
  await shot(page, 'pp2-note-landscape')
  await preview.getByRole('radio', { name: 'Portrait' }).click()
  // Save as PDF (tests save into the data folder instead of asking where)
  const pdf = join(dataDir, 'last-print.pdf')
  await preview.getByRole('button', { name: 'Save as PDF' }).click()
  await expect.poll(() => existsSync(pdf)).toBe(true)
  expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
  await preview.locator('.pp-pages').click()
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
})
