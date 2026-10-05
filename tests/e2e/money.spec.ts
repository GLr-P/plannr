import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-money-'))
let app: ElectronApplication
let page: Page
let ticketId = ''

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inDays = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const tab = (name: string) => page.getByRole('tab', { name })
const item = (name: string) => page.locator('.recurring-item', { hasText: name })

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
  ticketId = await page.evaluate(async () => {
    const c = await window.plannr.customers.create({ name: 'Jane Doe' })
    const t = await window.plannr.tickets.create({ customerId: c.id, templateId: null })
    await window.plannr.tickets.update(t.id, { device: 'iPhone 13', priceCents: 15000, status: 'ready' })
    return t.id
  })
})
test.afterAll(async () => {
  await app?.close()
})

test('adds a subscription and an overdue bill', async () => {
  await nav('Money').click()
  await tab('Bills & subscriptions').click()

  await page.getByRole('button', { name: 'Subscription', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Adobe Creative Cloud')
  await page.getByLabel('Amount', { exact: true }).fill('59.99')
  await page.getByLabel('Next due', { exact: true }).fill(inDays(3))
  await page.getByLabel('Category', { exact: true }).fill('Software')
  await expect(page.getByLabel('Auto-pay (record the payment automatically on the due date)')).toBeChecked()
  await expect(page.getByLabel('Remind me', { exact: true })).toHaveValue('3')
  await expect(page.locator('.recurring-editor-foot')).toContainText('Saved')
  await expect(item('Adobe Creative Cloud')).toContainText('In 3 days')
  await expect(item('Adobe Creative Cloud')).toContainText('$59.99/mo')

  await page.getByRole('button', { name: 'Bill', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Shop rent')
  await page.getByLabel('Amount', { exact: true }).fill('1200')
  await page.getByLabel('Next due', { exact: true }).fill(inDays(-2))
  await expect(page.locator('.recurring-editor-foot')).toContainText('Saved')
  await expect(item('Shop rent')).toContainText('2 days overdue')
  await expect(item('Shop rent').locator('.badge')).toHaveCount(0) // bills aren't auto-pay by default
  await shot(page, 'm1-recurring')
})

test('overview: subscription cost, what is due, who owes; mark a bill paid', async () => {
  await tab('Overview').click()
  const subs = page.locator('.stat', { hasText: 'Subscriptions' })
  await expect(subs).toContainText('$59.99/mo')
  await expect(subs).toContainText('$719.88 a year')
  const due = page.locator('.money-columns section').first()
  await expect(due.locator('.due-row').first()).toContainText('Shop rent')
  await expect(due.locator('.due-row').first()).toContainText('overdue')
  await expect(page.locator('.money-columns section').nth(1)).toContainText('Owes $150.00')
  await shot(page, 'm2-overview')

  await due.locator('.due-row', { hasText: 'Shop rent' }).getByRole('button', { name: 'Paid' }).click()
  await expect(page.locator('.stat', { hasText: 'Expenses' })).toContainText('$1,200.00')
  await expect(due.locator('.due-row', { hasText: 'Shop rent' })).not.toContainText('overdue') // moved to next month
})

test('records a ticket payment; the ticket shows Paid and nobody owes', async () => {
  await page.locator('.due-row', { hasText: 'Jane Doe' }).click()
  await expect(page.locator('.ticket-no')).toHaveText('NT-0001')
  await expect(page.locator('.pay-badge')).toHaveText('Owes $150.00')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('150.00')
  await page.getByLabel('Payment method').selectOption('Card')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.pay-badge')).toHaveText('Paid')
  await expect(page.locator('.payment-list')).toContainText('Card')
  await shot(page, 'm3-ticket-payment')

  await nav('Tickets').click()
  await page.getByRole('tab', { name: 'All', exact: true }).click()
  await expect(page.locator('.ticket-row').first().locator('.pay-badge')).toHaveText('Paid')

  await nav('Money').click()
  await tab('Overview').click()
  await expect(page.locator('.stat', { hasText: 'Income' })).toContainText('$150.00')
  await expect(page.locator('.money-columns section').nth(1)).toContainText('Everyone’s paid up')
})

test('transactions: add an expense, filter, search', async () => {
  await tab('Transactions').click()
  await page.getByRole('button', { name: 'Expense', exact: true }).click()
  await page.getByLabel('Description', { exact: true }).fill('Screen parts')
  await page.getByLabel('Amount', { exact: true }).fill('45.50')
  await page.getByLabel('Category', { exact: true }).fill('Parts')
  await page.getByRole('button', { name: 'Save' }).click()

  const rows = page.locator('.tx-row')
  await expect(rows).toHaveCount(3) // rent, ticket payment, parts
  await expect(rows.filter({ hasText: 'Payment · NT-0001' })).toContainText('NT-0001 · Jane Doe')
  await expect(page.locator('.tx-totals')).toContainText('$150.00')
  await expect(page.locator('.tx-totals')).toContainText('$1,245.50')
  await page.locator('.tx-toolbar .chip-btn', { hasText: 'Income' }).click()
  await expect(rows).toHaveCount(1)
  await page.locator('.tx-toolbar .chip-btn', { hasText: 'All' }).click()
  await expect(rows).toHaveCount(3) // wait for the reload, so the next check can't pass on a stale list
  await page.getByLabel('Search transactions').fill('rent')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Shop rent')
  await page.getByLabel('Search transactions').fill('')
  await expect(rows).toHaveCount(3)
  await shot(page, 'm4-transactions')
})

test('due dates show on the calendar and on Home', async () => {
  await nav('Calendar').click()
  const due = inDays(3)
  const title = await page.locator('.cal-title').textContent()
  const dueMonth = new Date(`${due}T00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  if (title !== dueMonth) await page.getByRole('button', { name: 'Next' }).click()
  const chip = page.locator(`.fc-daygrid-day[data-date="${due}"] .ev-money`)
  await expect(chip).toContainText('Adobe Creative Cloud · $59.99')
  await chip.click() // opens it in Money
  await expect(item('Adobe Creative Cloud').locator('.recurring-editor')).toBeVisible()

  await nav('Home').click()
  await expect(page.locator('.history-row', { hasText: 'Adobe Creative Cloud' })).toContainText('renews (auto-pay)')
})

test('cancelling a subscription keeps it for reference and drops it from the totals', async () => {
  await nav('Money').click()
  await tab('Bills & subscriptions').click()
  await item('Adobe Creative Cloud').locator('.recurring-main').click()
  await page.getByRole('button', { name: 'Mark cancelled' }).click()
  await expect(page.getByRole('button', { name: /Show cancelled \(1\)/ })).toBeVisible()
  await tab('Overview').click()
  await expect(page.locator('.stat', { hasText: 'Subscriptions' })).toContainText('$0.00/mo')
})

test('everything is still there after a restart', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await nav('Money').click()
  await expect(page.locator('.stat', { hasText: 'Income' })).toContainText('$150.00')
  await expect(page.locator('.stat', { hasText: 'Expenses' })).toContainText('$1,245.50')
  expect(await page.evaluate(async (id) => (await window.plannr.tickets.get(id))!.paidCents, ticketId)).toBe(15000)
  await shot(page, 'm5-overview-after')
})
