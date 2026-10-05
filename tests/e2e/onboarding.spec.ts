import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// The welcome tour on a fresh install (other test files turn it off).
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-onboarding-'))
let app: ElectronApplication
let page: Page
const tour = () => page.getByRole('dialog', { name: 'Welcome to Plannr' })
const next = () => tour().getByRole('button', { name: /^(Next|Get started|Start using Plannr)$/ }).click()

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir, { PLANNR_ONBOARDING: '1' }))
})
test.afterAll(async () => {
  await app?.close()
})

test('walks through: business name sets the ticket prefix, unticked parts leave the menu', async () => {
  await expect(tour()).toContainText('Welcome to Plannr')
  await shot(page, 'o1-welcome')
  await next()

  await tour().getByLabel('Business name').fill('Acme Repairs') // the "Name" box (labelled for screen readers)
  await expect(tour().getByLabel('Ticket number prefix')).toHaveValue('AR-')
  await expect(tour()).toContainText('AR-0001')
  await shot(page, 'o2-business')
  await next()

  await tour().getByRole('checkbox', { name: 'Vault' }).click()
  await tour().getByRole('checkbox', { name: 'Money' }).click()
  await expect(tour().getByRole('checkbox', { name: 'Vault' })).toHaveAttribute('aria-checked', 'false')
  await shot(page, 'o3-features')
  await next()

  await expect(tour()).toContainText('QuickBooks Online')
  await shot(page, 'o4-connect')
  await next()

  await expect(tour()).toContainText('Search everything')
  await shot(page, 'o5-tips')
  await next()
  await expect(tour()).toHaveCount(0)

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
