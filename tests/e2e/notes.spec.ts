import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePng, shot } from './helpers'

// One app session walked through like a real user; later steps build on earlier ones.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-'))
let app: ElectronApplication
let page: Page

const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const title = () => page.getByLabel('Title')

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('starts on Home with a welcome message', async () => {
  await expect(page.locator('.home h1')).toBeVisible()
  await expect(page.locator('.welcome')).toContainText('Welcome to Plannr')
  await shot(page, '01-home-empty')
})

test('creates a note with title, text, to-dos and a toggle section', async () => {
  await page.getByRole('button', { name: 'New note' }).first().click()
  await expect(title()).toBeFocused()
  await page.keyboard.type('Laptop repair checklist')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Customer dropped off a Dell XPS with a cracked screen.')
  await page.keyboard.press('Enter')

  await page.keyboard.type('/to-do')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('To-do list')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Order replacement screen')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Test battery health')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // leave the list

  await page.keyboard.type('/toggle')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Toggle section')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Before photos')

  await expect(page.locator('.prose ul[data-type="taskList"] li')).toHaveCount(2)
  await expect(page.locator('.prose [data-type="details"]')).toHaveCount(1)
  await page.locator('.prose ul[data-type="taskList"] li input[type="checkbox"]').first().check()
  await saved()
  await expect(page.locator('.sidebar')).not.toContainText('Laptop repair checklist') // recent notes are off by default
  await shot(page, '02-note-editor')
})

test('pastes an image into the note and shows it', async () => {
  await page.locator('.prose p').first().click()
  await page.keyboard.press('End')
  const png = makePng(480, 270).toString('base64')
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'before.png', { type: 'image/png' }))
    document.querySelector('.prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png)
  const img = page.locator('.prose img')
  await expect(img).toHaveAttribute('src', /^plannr:\/\/file\/[0-9a-f-]{36}$/)
  const width = await img.evaluate(
    (el: HTMLImageElement) => (el.complete && el.naturalWidth) || new Promise<number>((r) => (el.onload = () => r(el.naturalWidth)))
  )
  expect(width).toBe(480)
  await saved()
  await shot(page, '03-note-image')
})

test('formats selected text with the selection toolbar', async () => {
  await page.locator('.prose p').first().dblclick({ position: { x: 30, y: 10 } }) // on the word "Customer"
  await expect(page.locator('.bubble')).toBeVisible()
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Customer')
  await shot(page, '03b-selection-toolbar')
  await page.getByRole('button', { name: 'Bold (Ctrl+B)' }).click()
  await expect(page.locator('.prose p strong')).toHaveCount(1)
  await saved()
})

test('links notes with @ and shows backlinks', async () => {
  await page.keyboard.press('Control+n')
  await expect(title()).toBeFocused()
  await page.keyboard.type('Supplier list')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Screens from iFixit, see ')
  await page.keyboard.type('@lapt')
  await expect(page.locator('.menu-item').first()).toContainText('Laptop repair checklist')
  await page.keyboard.press('Enter')
  await expect(page.locator('.prose .mention')).toContainText('Laptop repair checklist')
  await saved()

  await page.locator('.prose .mention').click()
  await expect(title()).toHaveValue('Laptop repair checklist')
  await expect(page.locator('.backlinks')).toContainText('Supplier list')
  await shot(page, '04-backlinks')

  // Back button returns to the previous note
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(title()).toHaveValue('Supplier list')
})

test('searches instantly from the title bar and opens the result', async () => {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('cracked')
  const row = page.locator('.search-row').first()
  await expect(row).toContainText('Laptop repair checklist')
  await expect(row.locator('mark')).toHaveText('cracked')
  await shot(page, '05-search')
  await page.keyboard.press('Enter')
  await expect(title()).toHaveValue('Laptop repair checklist')
  await expect(page.locator('.search-results')).toHaveCount(0)
})

test('tags a note and filters by tag', async () => {
  await page.getByLabel('Add tag').fill('repairs')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tag')).toContainText('#repairs')
  await saved()
  await page.locator('.tag-label').click()
  await expect(page.locator('.list-header h1')).toHaveText('#repairs')
  await expect(page.locator('.note-row')).toHaveCount(1)
})

test('creates a folder and moves a note into it by drag and drop', async () => {
  await page.locator('.sidebar .nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Notes$/ }) }).hover() // its buttons show on hover
  await page.getByRole('button', { name: 'New folder', exact: true }).click()
  await page.keyboard.type('Clients')
  await page.keyboard.press('Enter')
  const folder = page.locator('.sidebar .nav-item', { hasText: 'Clients' })
  await expect(folder).toBeVisible()

  await page.locator('.sidebar .nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Notes$/ }) }).click()
  const row = page.locator('.note-row', { hasText: 'Supplier list' })
  await row.dragTo(folder)
  await expect(row.locator('.chip')).toHaveText('Clients')

  await expect(page.locator('.sidebar')).toContainText('Supplier list') // the folder opens to show what was dropped in
  await folder.click()
  await expect(page.locator('.note-row')).toHaveCount(1)
  await shot(page, '06-folder')
})

test('right-click: rename a folder, give it an icon and colour, move a note out and back', async () => {
  const folder = page.locator('.sidebar .nav-item', { hasText: 'Clients' })
  await folder.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByLabel('New name').fill('Customers A-Z')
  await page.keyboard.press('Enter')
  const renamed = page.locator('.sidebar .nav-item', { hasText: 'Customers A-Z' })
  await expect(renamed).toBeVisible()

  await renamed.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Icon & colour' }).click()
  await page.getByRole('radio', { name: 'orange' }).click()
  await page.getByLabel('Icon Truck').click()
  await expect(renamed.locator('svg.lucide-truck')).toHaveCount(1)
  await shot(page, '06b-icon-picker')
  await page.keyboard.press('Escape')
  await expect(page.locator('.ctx-menu')).toHaveCount(0)

  const inSidebar = page.locator('.sidebar .nav-item', { hasText: 'Supplier list' })
  await inSidebar.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to folder' }).click()
  await page.getByRole('menuitem', { name: 'No folder' }).click()
  await expect(inSidebar).toHaveCount(0) // unfiled and unpinned notes aren't listed in the sidebar

  await page.locator('.sidebar .nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Notes$/ }) }).click()
  await page.locator('.note-row', { hasText: 'Supplier list' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to folder' }).click()
  await page.getByRole('menuitem', { name: 'Customers A-Z' }).click()
  await expect(page.locator('.note-row', { hasText: 'Supplier list' }).locator('.chip')).toHaveText('Customers A-Z')
  await renamed.click()
  await expect(page.locator('.note-row')).toHaveCount(1)
})

test('organise the sidebar: reorder the menu, add a section, drag a folder into it', async () => {
  const menu = () => page.locator('.sidebar > .nav-item .nav-label').allTextContents()
  const tickets = page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first()
  await page.locator('.sidebar .nav-item', { hasText: 'Calendar' }).first().dragTo(tickets, { targetPosition: { x: 40, y: 4 } })
  await expect.poll(async () => (await menu()).slice(0, 3)).toEqual(['Home', 'Calendar', 'Tickets'])

  await page.locator('.add-section').click()
  await page.getByLabel('New name').fill('Work')
  await page.keyboard.press('Enter')
  const work = page.locator('.section-header', { hasText: 'Work' })
  await expect(work).toBeVisible()
  await page.locator('.sidebar .nav-item', { hasText: 'Customers A-Z' }).dragTo(work)
  await expect(page.locator('.sidebar-group', { has: work }).locator('.nav-item', { hasText: 'Customers A-Z' })).toBeVisible()
  await expect(page.locator('.section-header', { hasText: 'Folders' })).toHaveCount(0) // empty built-in sections hide

  await expect(page.locator('.sidebar-divider + .nav-item')).toContainText('Vault') // Vault sits apart at the bottom
  await shot(page, '06c-sections')
})

test('moves a note to trash and restores it', async () => {
  await page.locator('.note-row', { hasText: 'Supplier list' }).click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Supplier list' })).toHaveCount(0)
  await expect(page.locator('.app-toast')).toContainText('Note moved to trash')

  await page.locator('.sidebar .nav-item', { hasText: 'Trash' }).click()
  await expect(page.locator('.note-row')).toHaveCount(1)
  await page.locator('.note-row').hover() // row actions appear on hover
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.locator('.empty-state')).toHaveText('Trash is empty.')
  await expect(page.locator('.sidebar .nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Notes$/ }) }).locator('.nav-count')).toHaveText('2')
})

test('switches to dark theme', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await shot(page, '07-settings-dark')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('laptop')
  await page.keyboard.press('Enter') // immediately, before results render: must open the match, not create a note
  await expect(title()).toHaveValue('Laptop repair checklist')
  await expect(page.locator('.sidebar .nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Notes$/ }) }).locator('.nav-count')).toHaveText('2')
  await shot(page, '08-note-dark')
})

test('keeps everything after restarting the app', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const updatedAt = () =>
    page.evaluate(async () => (await window.plannr.notes.list()).find((n) => n.title === 'Laptop repair checklist')!.updatedAt)
  const before = await updatedAt()
  await page.locator('.simple-list button', { hasText: 'Laptop repair checklist' }).click()
  await page.waitForTimeout(800) // longer than the autosave delay
  expect(await updatedAt()).toBe(before) // just opening a note must not modify it
  await expect(page.locator('.prose')).toContainText('cracked screen')
  await expect(page.locator('.prose ul[data-type="taskList"] li')).toHaveCount(2)
  await expect(page.locator('.prose ul[data-type="taskList"] li').first()).toHaveAttribute('data-checked', 'true')
  await expect(page.locator('.prose img')).toHaveCount(1)
  await expect(page.locator('.tag')).toContainText('#repairs')
  await expect(page.locator('.backlinks')).toContainText('Supplier list')
})
