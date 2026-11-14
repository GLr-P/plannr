import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePng, shot } from './helpers'

// Collapsible sections ("dropdowns"), mainly used to tuck away photos.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-toggle-'))
let app: ElectronApplication
let page: Page

const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const toggle = () => page.locator('.prose [data-type="details"]').first()
const body = () => toggle().locator('[data-type="detailsContent"]')

async function pastePng(name: string): Promise<void> {
  const b64 = makePng(320, 180).toString('base64')
  await page.evaluate(
    ([data, fileName]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], fileName, { type: 'image/png' }))
      document.querySelector('.prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [b64, name]
  )
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('Enter in a toggle title moves into the toggle, and pasted photos go inside it', async () => {
  await page.getByRole('button', { name: 'New note' }).first().click()
  await expect(page.getByLabel('Title')).toBeFocused() // the new note is open
  await page.keyboard.type('iPhone 13 screen')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/toggle')
  await page.keyboard.press('Enter')
  await expect(toggle()).toHaveClass(/is-open/) // starts open so you can fill it
  await page.keyboard.type('Before photos')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Cracked top-left corner')
  await pastePng('before-1.png')
  await pastePng('before-2.png')

  await expect(toggle().locator('summary')).toHaveText('Before photos')
  await expect(body()).toContainText('Cracked top-left corner')
  await expect(body().locator('img')).toHaveCount(2)
  await expect(page.locator('.prose img')).toHaveCount(2) // nothing landed outside
  await saved()
  await shot(page, 't1-toggle-open')
})

test('collapsing hides the photos and stays collapsed after restart', async () => {
  await toggle().locator('> button').click()
  await expect(toggle()).not.toHaveClass(/is-open/)
  await expect(body().locator('img').first()).toBeHidden()
  await saved()
  await shot(page, 't2-toggle-closed')

  await app.close()
  ;({ app, page } = await launch(dataDir))
  await page.locator('.simple-list button', { hasText: 'iPhone 13 screen' }).click()
  await expect(toggle()).not.toHaveClass(/is-open/)
  await expect(body().locator('img').first()).toBeHidden()

  await toggle().locator('> button').click()
  await expect(body().locator('img')).toHaveCount(2)
  await expect(body().locator('img').first()).toBeVisible()
})

test('Enter on a collapsed toggle title opens it instead of jumping out', async () => {
  await toggle().locator('> button').click() // collapse again
  await expect(toggle()).not.toHaveClass(/is-open/)
  await toggle().locator('summary').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(toggle()).toHaveClass(/is-open/)
  await page.keyboard.type('Note inside')
  await expect(body().locator('p').first()).toHaveText('Note inside') // new line at the top, not merged
  await expect(body().locator('p').nth(1)).toHaveText('Cracked top-left corner')
  await expect(toggle().locator('summary')).toHaveText('Before photos')
})

test('"/Photo dropdown" makes a Photos toggle and puts the picked photos inside', async () => {
  const files = [1, 2, 3].map((i) => {
    const p = join(dataDir, `after-${i}.png`)
    writeFileSync(p, makePng(300, 200))
    return p
  })
  const previous = (await page.locator('.prose').textContent()) ?? ''
  await page.keyboard.press('Control+n')
  await page.keyboard.type('X') // typed instantly, before the new note opens
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.getByRole('button', { name: 'Back', exact: true }).click() // back to the previous note
  await expect(page.locator('.prose')).toHaveText(previous) // the previous note must be untouched
  await page.keyboard.press('Control+n')
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('Galaxy S22 battery')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/photo')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Photo dropdown')
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles(files)

  await expect(toggle().locator('summary')).toHaveText('Photos')
  await expect(body().locator('img')).toHaveCount(3)
  await expect(page.locator('.prose img')).toHaveCount(3)
  await saved()
  await shot(page, 't3-photo-dropdown')
})

/** Fires a paste carrying these clipboard types at the editor */
async function pasteData(types: Record<string, string>): Promise<void> {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(t)) dt.setData(k, v)
    document.querySelector('.prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, types)
}

/** What Plannr puts on the clipboard when the current selection is copied */
const copyData = (): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const dt = new DataTransfer()
    document.querySelector('.prose')!.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
    return Object.fromEntries(dt.types.map((k) => [k, dt.getData(k)]))
  })

test('pasting onto a toggle title keeps the toggle whole', async () => {
  await page.keyboard.press('Control+n')
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('Paste test')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/toggle')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Parts')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Screen')
  const summary = () => toggle().locator('summary').first()

  // One line of text goes into the title
  await summary().click()
  await page.keyboard.press('End')
  await pasteData({ 'text/plain': ' ordered' })
  await expect(summary()).toHaveText('Parts ordered')

  // Several lines go at the top of the toggle's body
  await pasteData({ 'text/plain': 'Battery\nCharging port' })
  await expect(summary()).toHaveText('Parts ordered')
  await expect(body().locator('p')).toHaveText(['Battery', 'Charging port', 'Screen'])

  // A copied toggle pasted onto the title lands inside the body, not split across the page
  await summary().click()
  await page.keyboard.press('Control+a')
  const copied = await copyData()
  expect(copied['text/html']).toContain('data-plannr-copy')
  await summary().click()
  await page.keyboard.press('End')
  await pasteData(copied)
  await expect(summary()).toHaveText('Parts ordered')
  await expect(page.locator('.prose > [data-type="details"]')).toHaveCount(1)
  await expect(body().first().locator('[data-type="details"]')).toHaveCount(1)
  await expect(body().first()).toContainText('Screen')
  await saved()
  await shot(page, 't4-paste-title')
})

test('copying a toggle title with Ctrl+C pastes its text, not a new toggle', async () => {
  // The real Windows clipboard: put back whatever was on it
  const before = await app.evaluate(async ({ clipboard }) => {
    const out: Record<string, string> = {}
    for (const item of await clipboard.read())
      for (const type of item.types) if (type === 'text/plain' || type === 'text/html') out[type] = await (await item.getType(type)).text()
    return out
  })
  try {
    await page.keyboard.press('Control+n')
    await expect(page.getByLabel('Title')).toBeFocused()
    await page.keyboard.type('Copy test')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Intro')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toggle')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Parts')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Screen')
    const top = page.locator('.prose > p')
    // (a click there would hit the formatting bar shown above the selection)
    const toStartOfIntro = () =>
      page.evaluate(() => (document.querySelector('.prose') as unknown as { editor: { commands: { setTextSelection: (p: number) => void } } }).editor.commands.setTextSelection(1))
    await expect(top).toHaveText(['Intro', ''])

    // Triple-click the title line, copy, paste at the start of Intro
    await toggle().locator('summary').first().click({ clickCount: 3 })
    await page.keyboard.press('Control+c')
    await toStartOfIntro()
    await page.keyboard.press('Control+v')
    await expect(top.first()).toHaveText('PartsIntro')
    await expect(page.locator('.prose [data-type="details"]')).toHaveCount(1) // no new toggle

    // Title + body copies the whole toggle, and pasting it doesn't pull Intro into it
    await page.keyboard.press('Control+z')
    await expect(top.first()).toHaveText('Intro')
    const summary = await toggle().locator('summary').boundingBox()
    const line = await body().locator('p').first().boundingBox()
    await page.mouse.move(summary!.x + 1, summary!.y + summary!.height / 2)
    await page.mouse.down()
    await page.mouse.move(line!.x + line!.width + 20, line!.y + line!.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.press('Control+c')
    await toStartOfIntro()
    await page.keyboard.press('Control+v')
    // Pasted at the start of Intro: the toggle goes above it, Intro stays its own line
    await expect(page.locator('.prose > *')).toHaveText(['PartsScreen', 'Intro', 'PartsScreen', ''])
    await expect(page.locator('.prose > [data-type="details"]')).toHaveCount(2)
    await expect(top).toHaveText(['Intro', ''])
    await expect(page.locator('.prose > [data-type="details"] summary')).toHaveText(['Parts', 'Parts'])
    await saved()
    await shot(page, 't5-copy-title')
  } finally {
    await app.evaluate(async ({ clipboard, ClipboardItem }, types) => {
      if (Object.keys(types).length) await clipboard.write([new ClipboardItem(types)])
    }, before)
  }
})
