import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePdf, shot } from './helpers'

// Two completely separate profiles (e.g. work and personal), switched from the title bar.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-profiles-'))
let app: ElectronApplication
let page: Page

const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
const switcher = () => page.locator('.titlebar .brand-switch')
const notesNav = () => page.locator('.sidebar .nav-item').filter({ has: page.locator('.nav-label', { hasText: /^Notes$/ }) })
const noteRow = (name: string) => page.locator('.note-row', { hasText: name })
const profilesFile = () => JSON.parse(readFileSync(join(dataDir, 'profiles.json'), 'utf8')) as { active: string; profiles: { id: string; name: string }[] }

/** Picks a profile in the switcher; Plannr restarts in it (tests start it again themselves). */
async function switchTo(name: string): Promise<void> {
  await switcher().click()
  const closed = app.waitForEvent('close')
  await page.getByRole('menuitem', { name }).click().catch(() => undefined) // the app exits during the click
  await closed
  ;({ app, page } = await launch(dataDir))
}

async function newNote(title: string, text: string): Promise<void> {
  await page.keyboard.press('Control+n')
  await expect(page.getByLabel('Title')).toBeFocused()
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('a note can hold any file (PDF) as a file block', async () => {
  await expect(switcher()).toContainText('Plannr') // only one profile so far
  await newNote('Shared checklist', 'Things to bring.')
  await page.keyboard.press('Enter')
  const pdf = makePdf('Invoice 42').toString('base64')
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'invoice.pdf', { type: 'application/pdf' }))
    document.querySelector('.prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, pdf)
  await expect(page.locator('.prose .file-chip-name')).toHaveText('invoice.pdf')
  await expect(page.locator('.prose .file-chip-size')).toHaveText(/bytes|KB/)
  await saved()

  // "/File" is in the block menu
  await page.keyboard.type('/file')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('File')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await saved()
  await shot(page, 'p1-file-block')

  await newNote('Work only', 'Stays in this profile.')
  await saved()
})

test('adds a second profile from the title bar', async () => {
  await switcher().click()
  await page.getByRole('menuitem', { name: 'Add a profile…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a profile' })
  await expect(dialog.getByLabel('Profile name')).toBeFocused()
  await shot(page, 'p2-add-profile')
  await dialog.getByLabel('Profile name').fill('Personal')
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Added Personal')
  // The first profile now shows its name; the window title says which profile is open
  await expect(switcher()).toContainText('Main')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('Plannr · Main')

  // Names must be unique
  await switcher().click()
  await page.getByRole('menuitem', { name: 'Add a profile…' }).click()
  await dialog.getByLabel('Profile name').fill('personal')
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog.locator('.error-text')).toContainText('already a profile called')
  await page.keyboard.press('Escape')
})

test('copies a note (with its file) to the other profile', async () => {
  await notesNav().click()
  await noteRow('Shared checklist').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy to profile' }).click()
  await shot(page, 'p3-copy-menu')
  await page.getByRole('menuitem', { name: 'Personal' }).click()
  await expect(page.locator('.toast')).toContainText('Copied “Shared checklist” to Personal')
  await expect(noteRow('Shared checklist')).toHaveCount(1) // copying keeps the original
})

test('Settings lists the profiles', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  const rows = page.locator('.profile-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Open now')
  await expect(page.getByLabel('Name of Personal')).toHaveValue('Personal')
  await shot(page, 'p4-settings-profiles')
})

test('switching opens the other profile: only what was copied is there', async () => {
  await switchTo('Personal')
  await expect(switcher()).toContainText('Personal')
  expect(profilesFile().active).not.toBe('main')
  await notesNav().click()
  await expect(page.locator('.note-row')).toHaveCount(1)
  await expect(noteRow('Work only')).toHaveCount(0)
  await noteRow('Shared checklist').click()
  await expect(page.locator('.prose')).toContainText('Things to bring.')
  await expect(page.locator('.prose .file-chip-name')).toHaveText('invoice.pdf')
  // The file was copied into this profile's own folder
  const id = profilesFile().profiles.find((p) => p.name === 'Personal')!.id
  const attachments = join(dataDir, 'profiles', id, 'attachments')
  expect(existsSync(attachments) && readdirSync(attachments).length).toBeTruthy()
  await shot(page, 'p5-personal-note')

  // Separate everything: no tickets, customers or money from the other profile
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  await expect(page.locator('.profile-row').nth(1)).toContainText('Open now')
})

test('switching back; moving a note sends it across and trashes the original', async () => {
  await switchTo('Main')
  await expect(switcher()).toContainText('Main')
  await notesNav().click()
  await expect(page.locator('.note-row')).toHaveCount(2)
  await noteRow('Work only').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to profile' }).click()
  await page.getByRole('menuitem', { name: 'Personal' }).click()
  await expect(page.locator('.toast')).toContainText('Moved “Work only” to Personal')
  await expect(noteRow('Work only')).toHaveCount(0)
})

test('a profile can be renamed and removed (not the open one)', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  const name = page.getByLabel('Name of Personal')
  await name.fill('Home')
  await name.press('Enter')
  await expect(page.getByLabel('Name of Home')).toHaveValue('Home')
  expect(profilesFile().profiles.map((p) => p.name)).toEqual(['Main', 'Home'])

  const remove = page.locator('.profile-row', { has: page.getByLabel('Name of Home') }).getByRole('button', { name: /Remove Home/ })
  await remove.click()
  await expect(remove).toContainText('Click again')
  await remove.click()
  await expect(page.locator('.profile-row')).toHaveCount(1)
  await expect(switcher()).toContainText('Plannr') // back to a single profile
  const id = profilesFile().profiles.find((p) => p.name === 'Home')
  expect(id).toBeUndefined()
})
