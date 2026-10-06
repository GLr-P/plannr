import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Quotes & invoices with line items, and the parts inventory they draw from.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-quotes-'))
let app: ElectronApplication
let page: Page
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
  await page.evaluate(() => window.plannr.business.set({ name: 'Maple Repair Co.', taxName: 'GST', taxRate: 5 }))
})
test.afterAll(async () => {
  await app?.close()
})

test('inventory: add a part with stock, cost, price and a reorder level', async () => {
  await nav('Inventory').click()
  await expect(page.locator('.empty-state')).toContainText('No parts yet')
  await page.getByRole('button', { name: 'New part' }).click()
  const row = page.locator('.part-row').first()
  await expect(row.getByLabel('Part name')).toBeFocused()
  await page.keyboard.type('iPhone 13 screen')
  await row.getByLabel('In stock').fill('3')
  await row.getByLabel('Reorder at').fill('2')
  await row.getByLabel('Cost').fill('80')
  await row.getByLabel('Selling price').fill('129')
  await row.getByLabel('Supplier').fill('Parts supplier')
  await row.getByLabel('Supplier').blur()
  await expect(row.getByLabel('Selling price')).toHaveValue('$129.00')
  await expect(page.locator('.tx-totals')).toContainText('$240.00') // stock value: 3 × $80
})

test('ticket lines: a part from inventory and labour; tax on top; the price follows; stock goes down', async () => {
  await page.keyboard.press('Control+t')
  await page.getByLabel('Device').fill('iPhone 13')
  await page.getByRole('button', { name: 'Add line items' }).click()
  const lines = page.locator('.lines-table tbody tr')
  await expect(lines).toHaveCount(1)
  await lines.first().getByLabel('Line type').selectOption('part')
  await lines.first().getByLabel('Description').fill('iPhone 13 screen') // picks it from inventory
  await expect(lines.first()).toContainText('2 left in stock')
  await expect(lines.first().getByLabel('Unit price')).toHaveValue('$129.00')

  await page.locator('.lines-add').getByRole('button', { name: 'Labour' }).click()
  await expect(lines).toHaveCount(2)
  await lines.nth(1).getByLabel('Description').fill('Install and test')
  await lines.nth(1).getByLabel('Unit price').fill('60')
  await lines.nth(1).getByLabel('Unit price').blur()

  await expect(page.locator('.lines-total')).toHaveText('$198.45') // (129 + 60) + 5% GST
  await expect(page.getByLabel('Price', { exact: true })).toHaveValue('$198.45')
  await expect(page.locator('.lines-profit')).toContainText('profit $109.00') // 189 − 80 cost
  await expect(page.locator('.pay-badge')).toHaveText('Owes $198.45')
  await expect(nav('Inventory').locator('.nav-count')).toHaveText('1') // now at the reorder level
  await shot(page, 'q1-ticket-lines')

  await page.getByLabel('No tax').check()
  await expect(page.locator('.lines-total')).toHaveText('$189.00')
  await page.getByLabel('No tax').uncheck()
  await expect(page.locator('.lines-total')).toHaveText('$198.45')
})

test('print a quote and an invoice', async () => {
  const out = join(dataDir, 'last-print.html')
  const printed = async (kind: string, marker: string): Promise<string> => {
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await page.getByRole('menuitem', { name: kind, exact: true }).click()
    await expect.poll(() => (existsSync(out) ? readFileSync(out, 'utf8') : '')).toContain(marker)
    return readFileSync(out, 'utf8')
  }
  const quote = await printed('Quote', '<h1>Quote</h1>')
  expect(quote).toContain('Part: iPhone 13 screen')
  expect(quote).toContain('Labour: Install and test')
  expect(quote).toContain('$198.45')
  const invoice = await printed('Invoice', '<h1>Invoice')
  expect(invoice).toContain('Balance owing: $198.45')

  await nav('Inventory').click()
  await expect(page.locator('.part-row').first().getByLabel('In stock')).toHaveValue('2')
  await expect(page.locator('.part-row').first()).toHaveClass(/low/)
  await shot(page, 'q2-inventory')
})

test('reports: GST collected on the payment minus GST on an expense, and the charts', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.locator('.ticket-row').first().click()
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('198.45')
  await page.getByLabel('Tax', { exact: true }).selectOption('included')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.pay-badge')).toHaveText('Paid')
  await page.evaluate(() => window.plannr.money.addTransaction({ type: 'expense', amountCents: 5250, description: 'Adhesive', category: 'Parts' }))

  await nav('Money').click()
  await page.getByRole('tab', { name: 'Reports' }).click()
  const gst = page.locator('.gst-card')
  await expect(gst.locator('.stat').nth(0)).toContainText('$9.45') // 198.45 − 198.45 / 1.05
  await expect(gst.locator('.stat').nth(1)).toContainText('$2.50') // 52.50 − 52.50 / 1.05
  await expect(gst.locator('.gst-net')).toContainText('Net to remit')
  await expect(gst.locator('.gst-net')).toContainText('$6.95')
  await expect(page.locator('.chart')).toHaveCount(2)
  await expect(page.locator('.report-stats')).toContainText('Received')
  await shot(page, 'q3-reports')
})

test('messages: setting Ready offers to message the customer; the template is filled in; copy for a text', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.getByRole('tab', { name: 'All', exact: true }).click().catch(() => undefined)
  await page.locator('.ticket-row').first().click()
  await page.getByLabel('Status').selectOption('ready')
  const toast = page.locator('.app-toast')
  await expect(toast).toContainText('Let the customer know?')
  await toast.getByRole('button', { name: 'Message' }).click()
  const dialog = page.getByRole('dialog', { name: 'Message: Ready for pickup' })
  await expect(dialog.getByLabel('Subject')).toHaveValue('Your iPhone 13 is ready (T-0001)')
  await expect(dialog.getByLabel('Message')).toHaveValue(/Hi there,\n\nGood news: your iPhone 13 is ready for pickup\. The total is \$198\.45, already paid\./)
  await expect(dialog.getByLabel('Message')).toHaveValue(/Maple Repair Co\./)
  await shot(page, 'q4-message')
  await dialog.getByRole('button', { name: 'Copy text' }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Good news: your iPhone 13 is ready')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // The Message button lists every template
  await page.getByRole('button', { name: 'Message', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Waiting on parts' })).toBeVisible()
  await page.keyboard.press('Escape')
})
