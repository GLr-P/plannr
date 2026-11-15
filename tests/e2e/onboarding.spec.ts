import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// The setup walkthrough on a fresh install (other test files turn it off).
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-onboarding-'))
let app: ElectronApplication
let page: Page
const tour = () => page.getByRole('dialog', { name: 'Welcome to Plannr' })
const steps = () => tour().getByRole('navigation', { name: 'Setup steps' })
const next = () => tour().getByRole('button', { name: /^(Next|Get started|Start using Plannr)$/ }).click()
const heading = () => tour().locator('.onboard-body h2').first()
/** Jump to a step from the side list */
const goStep = (title: string) => steps().getByRole('button').filter({ hasText: new RegExp(`^\\d+${title}$`) }).click()
/** Next until the last step, then start */
const finishTour = async (): Promise<void> => {
  for (let i = 0; i < 25 && !(await tour().textContent())?.includes('You’re all set'); i++) await next()
  await next()
  await expect(tour()).toHaveCount(0)
}
const fresh = async (name: string): Promise<void> => {
  await app.close()
  ;({ app, page } = await launch(mkdtempSync(join(tmpdir(), `plannr-e2e-onboarding-${name}-`)), { PLANNR_ONBOARDING: '1' }))
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir, { PLANNR_ONBOARDING: '1' }))
})
test.afterAll(async () => {
  await app?.close()
})

test('repair: every step in order, the business name sets the ticket prefix, unticked parts leave the menu and the steps', async () => {
  await expect(tour()).toContainText('Welcome to Plannr')
  await shot(page, 'o1-welcome')
  await next()

  await expect(heading()).toHaveText('What will you use Plannr for?')
  await tour().getByRole('checkbox', { name: 'Repair & tech services' }).click()
  await shot(page, 'o1b-uses')
  await next()

  await expect(heading()).toHaveText('Your business')
  await tour().getByLabel('Business name').fill('Acme Repairs')
  await expect(tour().getByLabel('Ticket number prefix')).toHaveValue('AR-')
  await expect(tour()).toContainText('AR-0001')
  await shot(page, 'o2-business')
  await next()

  await expect(heading()).toHaveText('Your menu')
  await tour().getByRole('checkbox', { name: 'Vault' }).click()
  await tour().getByRole('checkbox', { name: 'Money' }).click()
  await expect(tour().getByRole('checkbox', { name: 'Vault' })).toHaveAttribute('aria-checked', 'false')
  await expect(steps()).not.toContainText('Vault') // its setup step goes too
  await shot(page, 'o3-features')
  await next()

  await expect(heading()).toHaveText('How it looks')
  await next()
  await expect(heading()).toHaveText('Your Home page')
  await next()

  await expect(heading()).toHaveText('Tickets')
  await expect(tour().getByLabel('What tickets are called')).toHaveValue('Tickets')
  await expect(tour().getByLabel('Status name').first()).toHaveValue('Intake') // repair keeps its own statuses
  await shot(page, 'o4-tickets')
  await next()

  await expect(heading()).toHaveText('Your ticket page')
  await expect(tour().getByLabel('Preview')).toBeVisible()
  await shot(page, 'o4b-ticket-page')
  await next()

  await expect(heading()).toHaveText('Presets')
  await expect(tour().getByRole('checkbox', { name: 'Shop repair (drop-off)' })).toBeChecked()
  await shot(page, 'o4c-presets')
  await next()

  await expect(heading()).toHaveText('Sections')
  await expect(tour().getByRole('checkbox', { name: 'Passcode' })).toBeChecked()
  await shot(page, 'o4d-sections')
  await next()

  await expect(heading()).toHaveText('Customers')
  await next()
  await expect(heading()).toHaveText('Notes')
  await shot(page, 'o4e-notes')
  await next()
  await expect(heading()).toHaveText('Calendar & reminders')
  await next()
  await expect(heading()).toHaveText('Money & printouts') // a business still gets its printout details with Money hidden
  await next()

  await goStep('Sync & accounts')
  await expect(tour()).toContainText('QuickBooks')
  await shot(page, 'o5-connect')
  await next()

  await expect(tour()).toContainText('Search everything')
  await shot(page, 'o5b-tips')
  await finishTour()

  await expect(page.locator('.sidebar .nav-item', { hasText: 'Vault' })).toHaveCount(0)
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Money' })).toHaveCount(0)
  await page.keyboard.press('Control+t')
  await expect(page.locator('.ticket-no')).toHaveText('AR-0001')
})

test('it only shows once, and can be reopened from Settings', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir, { PLANNR_ONBOARDING: '1' }))
  await page.waitForTimeout(500) // give it the chance to (wrongly) appear
  await expect(tour()).toHaveCount(0)

  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: 'Show the tour' }).click()
  await expect(tour()).toBeVisible()
  await tour().getByRole('button', { name: 'Skip' }).click()
  await expect(tour()).toHaveCount(0)
})

test('nothing picked: neutral words everywhere, no repair statuses or presets', async () => {
  await fresh('neutral')
  await next()
  await next() // no use picked
  await expect(heading()).toHaveText('About you')
  await expect(tour().getByLabel('Business name')).toHaveCount(0)
  await goStep('Presets')
  await tour().locator('summary', { hasText: 'More presets' }).click() // the repair ones are offered, not made
  await expect(tour().getByRole('checkbox', { name: 'Shop repair (drop-off)' })).not.toBeChecked()
  await tour().getByRole('button', { name: 'Finish later' }).click()
  await expect(tour()).toHaveCount(0)

  await page.keyboard.press('Control+t')
  const title = page.getByRole('textbox', { name: 'Name', exact: true })
  await expect(title).toHaveAttribute('placeholder', 'Give it a name')
  await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('New')
  await expect(page.locator('.ticket-body')).not.toContainText(/what'?s wrong|device|intake/i)
  await shot(page, 'o8-neutral-ticket')
})

test('art commissions: tickets become Commissions with their own statuses, sections, preset and client fields', async () => {
  await fresh('art')
  await next()
  await tour().getByRole('checkbox', { name: 'Art & commissions' }).click()
  await next()
  await goStep('Commissions')
  await expect(tour().getByLabel('What tickets are called')).toHaveValue('Commissions')
  await expect(tour().getByLabel('What customers are called')).toHaveValue('Clients')
  await expect(tour().getByLabel('Status name').first()).toHaveValue('Inquiry')
  await shot(page, 'o6-art-setup')
  await goStep('Presets')
  await expect(tour().getByRole('checkbox', { name: 'Commission', exact: true })).toBeChecked()
  await goStep('Sections')
  await expect(tour().getByRole('checkbox', { name: 'Size & medium' })).toBeChecked()
  await expect(tour().getByRole('checkbox', { name: 'Passcode' })).not.toBeChecked() // repair sections are off for art
  await goStep('Clients')
  await expect(tour()).toContainText('Social handle')
  await finishTour()

  await expect(page.locator('.sidebar .nav-item', { hasText: 'Commissions' })).toBeVisible()
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Inventory' })).toHaveCount(0)
  await page.keyboard.press('Control+t')
  await expect(page.getByLabel('Status')).toHaveValue('inquiry')
  await expect(page.locator('.ticket-body .ticket-section .ticket-section-title').first()).toHaveValue('Brief')
  await page.locator('.page-toolbar').getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Search sections').fill('passcode')
  await expect(page.locator('.add-ticket-item', { hasText: 'Passcode' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await shot(page, 'o7-art-ticket')
})

test('school: tickets become Assignments, no customers, and no business questions', async () => {
  await fresh('school')
  await next()
  await tour().getByRole('checkbox', { name: 'School & studying' }).click()
  await next()
  await expect(heading()).toHaveText('About you')
  await expect(tour().getByLabel('Business name')).toHaveCount(0)
  await expect(steps()).toContainText('The assignment page')
  await expect(steps()).not.toContainText('Customers')
  await expect(steps()).not.toContainText('Money')
  await shot(page, 'o9-school')
  await goStep('Presets')
  await expect(tour().getByRole('checkbox', { name: 'Assignment', exact: true })).toBeChecked()
  await finishTour()
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Assignments' })).toBeVisible()
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Customers' })).toHaveCount(0)
  await expect(page.locator('.sidebar .nav-item', { hasText: 'Tasks' })).toBeVisible()
})
