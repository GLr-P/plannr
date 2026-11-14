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
