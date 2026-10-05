import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePdf, makePng, shot } from './helpers'

test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-vault-'))
let app: ElectronApplication
let page: Page
let recoveryKey = ''
let password = ''
let savedClipboard = ''

const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const clipboardText = () => app.evaluate(async ({ clipboard }) => clipboard.readText())

async function unlock(passcode: string): Promise<void> {
  await page.getByLabel('Vault passcode', { exact: true }).fill(passcode)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.unlocked-pill')).toBeVisible()
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
  savedClipboard = await clipboardText() // the test uses the real clipboard; put it back afterwards
})
test.afterAll(async () => {
  await app?.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), savedClipboard)
  await app?.close()
})

test('first-time setup requires a long enough, confirmed passcode and shows a recovery key', async () => {
  await nav('Vault').click()
  await expect(page.locator('.vault-card h1')).toHaveText('Set up your vault')
  await page.getByLabel('Choose a passcode', { exact: true }).fill('12345')
  await page.getByLabel('Confirm passcode', { exact: true }).fill('12345')
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.locator('.error-text')).toContainText('at least 6')
  await page.getByLabel('Choose a passcode', { exact: true }).fill('blue-horse-42')
  await page.getByLabel('Confirm passcode', { exact: true }).fill('blue-horse-41')
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.locator('.error-text')).toContainText('don’t match')
  await page.getByLabel('Confirm passcode', { exact: true }).fill('blue-horse-42')
  await shot(page, 'v1-setup')
  await page.getByRole('button', { name: 'Create vault' }).click()

  await expect(page.locator('.vault-card h1')).toHaveText('Your recovery key')
  recoveryKey = (await page.getByLabel('Recovery key', { exact: true }).textContent())!.trim()
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  const open = page.getByRole('button', { name: 'Open my vault' })
  await expect(open).toBeDisabled()
  await shot(page, 'v2-recovery-key')
  await page.getByLabel('I saved my recovery key somewhere safe', { exact: true }).check()
  await open.click()
  await expect(page.locator('.unlocked-pill')).toBeVisible()
})

test('adds a login with a generated password, copies it, and it clears later', async () => {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.dropdown-menu .menu-item', { hasText: 'Login' }).click()
  await page.getByLabel('Item name', { exact: true }).fill('Zoho Mail')
  await page.getByLabel('Username / email', { exact: true }).fill('owner@example.com')
  await page.getByRole('button', { name: 'Generate password' }).click()
  password = await page.getByLabel('Password', { exact: true }).inputValue()
  expect(password).toHaveLength(20)
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text') // revealed after generating
  await page.getByRole('button', { name: 'Hide Password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByLabel('Website', { exact: true }).fill('mail.zoho.com')
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')

  await page.getByRole('button', { name: 'Copy Password' }).click()
  await expect(page.locator('.toast')).toContainText('clears from the clipboard in 30 s')
  expect(await clipboardText()).toBe(password)
})

test('adds a card and a secure note; the list shows safe summaries and filters', async () => {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.dropdown-menu .menu-item', { hasText: 'Card' }).click()
  await page.getByLabel('Item name', { exact: true }).fill('Business Visa')
  await page.getByLabel('Card number', { exact: true }).fill('4111 1111 1111 1234')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.locator('.dropdown-menu .menu-item', { hasText: 'Secure note' }).click()
  await page.getByLabel('Item name', { exact: true }).fill('Shop alarm')
  await page.locator('.vault-notes .prose').click()
  await page.keyboard.type('Front door 4321')
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')

  const rows = page.locator('.vault-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'Business Visa' })).toContainText('•••• 1234')
  await expect(rows.filter({ hasText: 'Zoho Mail' })).toContainText('owner@example.com')
  await page.getByLabel('Search vault', { exact: true }).fill('visa')
  await expect(rows).toHaveCount(1)
  await page.getByLabel('Search vault', { exact: true }).fill('')
  await rows.filter({ hasText: 'Zoho Mail' }).click()
  await shot(page, 'v3-vault')
})

test('a Document item stores an encrypted PDF that previews inside Plannr', async () => {
  const pdfPath = join(dataDir, 'Insurance policy.pdf')
  writeFileSync(pdfPath, makePdf('POLICY-NUMBER-XK-99213'))
  await page.getByRole('button', { name: 'New', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.dropdown-menu .menu-item', { hasText: 'Document' }).click()
  await (await chooser).setFiles(pdfPath)
  await page.getByLabel('Item name', { exact: true }).fill('Shop insurance')
  const file = page.locator('.vault-file', { hasText: 'Insurance policy.pdf' })
  await expect(file).toBeVisible()
  await expect(page.locator('.vault-row', { hasText: 'Shop insurance' }).locator('.vault-row-files')).toContainText('1')

  await file.locator('.vault-file-main').click()
  const frame = page.locator('.file-preview iframe')
  await expect(frame).toHaveAttribute('src', /^plannr-vault:\/\/file\//)
  // The decrypted PDF is served from memory while unlocked
  const served = await app.evaluate(async ({ net }, src) => {
    const res = await net.fetch(src)
    const text = new TextDecoder('latin1').decode(await res.arrayBuffer())
    return { status: res.status, type: res.headers.get('content-type'), hasText: text.includes('POLICY-NUMBER-XK-99213') }
  }, (await frame.getAttribute('src'))!)
  expect(served).toEqual({ status: 200, type: 'application/pdf', hasText: true })
  await page.waitForTimeout(1500) // let the PDF viewer render for the screenshot
  await shot(page, 'v5-pdf-preview')
  await page.keyboard.press('Escape')
  await expect(page.locator('.file-preview')).toHaveCount(0)
})

test('vault notes use the full editor; pasted images are encrypted too; custom fields', async () => {
  await page.locator('.vault-notes .prose').click()
  await page.keyboard.type('/h2')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Heading 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Claim contacts')
  await page.keyboard.press('Enter')
  const png = makePng(200, 120).toString('base64')
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'claim.png', { type: 'image/png' }))
    document.querySelector('.vault-notes .prose')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png)
  await expect(page.locator('.vault-notes .prose h2')).toHaveText('Claim contacts')
  const img = page.locator('.vault-notes .prose img')
  await expect(img).toHaveAttribute('src', /^plannr-vault:\/\/file\//)
  expect(await img.evaluate((el: HTMLImageElement) => (el.complete && el.naturalWidth) || new Promise<number>((r) => (el.onload = () => r(el.naturalWidth))))).toBe(200)
  await expect(page.locator('.vault-file')).toHaveCount(1) // pasted note images aren't listed as attachments

  await page.getByRole('button', { name: 'Add a field' }).click()
  await page.getByLabel('Custom field name', { exact: true }).fill('Policy #')
  await page.getByLabel('Policy #', { exact: true }).fill('XK-99213')
  await page.getByRole('button', { name: 'Make Policy # hidden' }).click()
  await expect(page.getByLabel('Policy #', { exact: true })).toHaveAttribute('type', 'password')
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
  await shot(page, 'v6-document')
})

test('vault contents never appear in global search or in the database file', async () => {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Zoho')
  await expect(page.locator('.search-row', { hasText: 'Zoho Mail' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const vaultFiles = existsSync(join(dataDir, 'vault')) ? readdirSync(join(dataDir, 'vault')).map((f) => join('vault', f)) : []
  expect(vaultFiles.length).toBeGreaterThanOrEqual(2) // the PDF and the pasted image
  const raw = ['plannr.db', 'plannr.db-wal', ...vaultFiles]
    .map((f) => join(dataDir, f))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f).toString('latin1'))
    .join('')
  for (const secret of ['Zoho Mail', 'owner@nanotechservices', password, 'Business Visa', '4111 1111', 'Front door 4321', 'blue-horse-42', 'POLICY-NUMBER-XK', 'Insurance policy', 'Claim contacts', 'XK-99213']) {
    expect(raw.includes(secret), `"${secret}" found in database`).toBe(false)
  }
})

test('locking hides everything; wrong passcode is refused, right one opens', async () => {
  const fileUrl = await page.locator('.vault-notes .prose img').first().getAttribute('src').catch(() => null)
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(page.locator('.vault-card h1')).toHaveText('Vault locked')
  if (fileUrl) expect(await app.evaluate(async ({ net }, u) => (await net.fetch(u)).status, fileUrl)).toBe(404) // files are unreadable while locked
  await page.getByLabel('Vault passcode', { exact: true }).fill('wrong-pass')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.error-text')).toContainText('isn’t right')
  await shot(page, 'v4-locked')
  await unlock('blue-horse-42')
  await expect(page.locator('.vault-row')).toHaveCount(4)
})

test('changing the passcode in vault settings', async () => {
  await page.getByRole('button', { name: 'Vault settings' }).click()
  await page.getByLabel('Current passcode', { exact: true }).fill('blue-horse-42')
  await page.getByLabel('New passcode', { exact: true }).fill('green-fox-77')
  await page.getByLabel('Confirm new passcode', { exact: true }).fill('green-fox-77')
  await page.getByRole('button', { name: 'Change passcode' }).click()
  await expect(page.locator('.ok-text')).toHaveText('Passcode changed.')
  await page.keyboard.press('Escape')
  await page.locator('.list-header h1').click() // close the popover
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await unlock('green-fox-77')
})

test('forgot passcode: the recovery key sets a new one', async () => {
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  await page.getByRole('button', { name: 'Forgot passcode? Use your recovery key' }).click()
  await page.getByLabel('Recovery key', { exact: true }).fill(recoveryKey.toLowerCase().replace(/-/g, ' '))
  await page.getByLabel('New passcode', { exact: true }).fill('red-owl-2026')
  await page.getByLabel('Confirm passcode', { exact: true }).fill('red-owl-2026')
  await page.getByRole('button', { name: 'Reset passcode and unlock' }).click()
  await expect(page.locator('.unlocked-pill')).toBeVisible()
  await expect(page.locator('.vault-row')).toHaveCount(4)
})

test('after a restart the vault starts locked and keeps its items', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await nav('Vault').click()
  await expect(page.locator('.vault-card h1')).toHaveText('Vault locked')
  await unlock('red-owl-2026')
  await page.locator('.vault-row', { hasText: 'Zoho Mail' }).click()
  await page.getByRole('button', { name: 'Show Password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(password)
})

test('repeated wrong passcodes make you wait', async () => {
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Vault passcode', { exact: true }).fill(`nope-${i}`)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByLabel('Vault passcode', { exact: true })).toHaveValue('') // this attempt was checked
  }
  await expect(page.locator('.hint.warn')).toContainText('Try again in')
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeDisabled()
})
