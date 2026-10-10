import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Building a real order form (a flower shop's) out of customizable fill-in fields, entirely through the app,
// then taking an order with it: linked fields fill in and update the ticket's customer.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-forms-'))
let app: ElectronApplication
let page: Page

const saved = () => expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
/** The ticket's own boxes at the top (customer, phone, dates) */
const prop = (label: string) => page.locator(`.props input[aria-label="${label}"]`)
const field = (label: string) => page.locator(`.prose .ff[data-label="${label}"]`)

interface FieldOptions {
  label?: string
  type?: string
  link?: string
  width?: 'Full' | 'Half' | 'Third' | 'Small'
  labelPos?: 'Left' | 'Above' | 'Hidden'
  height?: 'Short' | 'Medium' | 'Tall'
  choices?: string[]
  placeholder?: string
  hint?: string
  formula?: string
}

/** Types "/form", fills in the field's settings and clicks Done (the cursor carries on after the field). */
async function addField(o: FieldOptions): Promise<void> {
  await page.keyboard.type('/form')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Form field')
  await page.keyboard.press('Enter')
  const cfg = page.locator('.ff-config')
  await expect(cfg).toBeVisible()
  if (o.link) await cfg.getByLabel('Fills in from').selectOption({ label: o.link })
  if (o.label) await cfg.getByLabel('Field label').fill(o.label)
  if (o.type) await cfg.getByLabel('Field type').selectOption({ label: o.type })
  if (o.choices) await cfg.getByLabel('Choices').fill(o.choices.join('\n'))
  if (o.width) await cfg.getByRole('radiogroup', { name: 'Width' }).getByRole('radio', { name: o.width }).click()
  if (o.labelPos) await cfg.getByRole('radiogroup', { name: 'Label' }).getByRole('radio', { name: o.labelPos }).click()
  if (o.height) await cfg.getByRole('radiogroup', { name: 'Height' }).getByRole('radio', { name: o.height }).click()
  if (o.formula) await cfg.getByLabel('Formula').fill(o.formula)
  if (o.placeholder) await cfg.getByLabel('Placeholder').fill(o.placeholder)
  if (o.hint) await cfg.getByLabel('Hint').fill(o.hint)
  await cfg.getByRole('button', { name: 'Done' }).click()
  await expect(cfg).toHaveCount(0)
}

async function heading(text: string): Promise<void> {
  await page.keyboard.type('/h2')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Heading 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('build a flower shop order form from fill-in fields', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Templates' }).click()
  await page.getByRole('button', { name: 'New ticket template' }).click()
  await page.getByLabel('Template name').fill('Flower order')
  await page.locator('.prose').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')

  await heading('Customer')
  // Linked to the ticket's customer, two to a line, labels above
  await addField({ link: 'Customer name', width: 'Half', labelPos: 'Above' })
  await addField({ link: 'Customer phone', width: 'Half', labelPos: 'Above' })
  await page.keyboard.press('Enter')
  await addField({ link: 'Customer email', width: 'Half', labelPos: 'Above' })
  await page.keyboard.press('Enter')

  await heading('Delivery')
  await addField({ label: 'Order type', type: 'Pick one (buttons)', choices: ['Pickup', 'Delivery', 'Wire out'] })
  await page.keyboard.press('Enter')
  await addField({ label: 'Recipient', width: 'Half', labelPos: 'Above', placeholder: 'Who the flowers are for' })
  await addField({ label: 'Recipient phone', type: 'Phone', width: 'Half', labelPos: 'Above' })
  await page.keyboard.press('Enter')
  await addField({ label: 'Delivery address', type: 'Long text', labelPos: 'Above', hint: 'Include the buzzer or unit number' })
  await page.keyboard.press('Enter')
  // A sentence with small fields inside it
  await page.keyboard.type('Deliver on ')
  await addField({ label: 'Delivery date', type: 'Date', width: 'Small', labelPos: 'Hidden' })
  await page.keyboard.type('between ')
  await addField({ label: 'From', type: 'Time', width: 'Small', labelPos: 'Hidden' })
  await page.keyboard.type('and ')
  await addField({ label: 'To', type: 'Time', width: 'Small', labelPos: 'Hidden' })
  await page.keyboard.press('Enter')

  await heading('Arrangement')
  await addField({ label: 'Arrangement', type: 'Dropdown', choices: ['Hand-tied bouquet', 'Vase arrangement', 'Basket', 'Corsage', 'Sympathy wreath'], width: 'Half', labelPos: 'Above' })
  await addField({ label: 'Size', type: 'Pick one (buttons)', choices: ['Standard', 'Deluxe', 'Premium'], width: 'Half', labelPos: 'Above' })
  await page.keyboard.press('Enter')
  await addField({ label: 'Colours', type: 'Pick several', choices: ['Red', 'Pink', 'White', 'Yellow', 'Purple', 'Mixed'] })
  await page.keyboard.press('Enter')
  await addField({ label: 'Flowers', placeholder: 'e.g. roses, lilies, no carnations' })
  await page.keyboard.press('Enter')

  await heading('Card')
  await addField({ label: 'Card message', type: 'Long text', labelPos: 'Above', height: 'Medium', placeholder: 'What the card should say' })
  await page.keyboard.press('Enter')
  await addField({ label: 'Signed', width: 'Half', placeholder: 'From…' })
  await page.keyboard.press('Enter')

  await heading('Payment')
  await addField({ label: 'Flowers price', type: 'Money', width: 'Third', labelPos: 'Above' })
  await addField({ label: 'Delivery fee', type: 'Money', width: 'Third', labelPos: 'Above' })
  await addField({ label: 'Paid', type: 'Checkbox', width: 'Third', labelPos: 'Above' })
  await page.keyboard.press('Enter')
  // Worked out from the prices, with 12% tax
  await addField({ label: 'Total (with tax)', type: 'Calculated', formula: '({Flowers price} + {Delivery fee}) * 1.12', width: 'Half', labelPos: 'Above' })
  await page.keyboard.press('Enter')
  await addField({ link: 'Pickup date', label: 'Ready by', width: 'Half' })
  await saved()

  // Settings menu: compact, with the new options
  await field('Recipient').hover()
  await field('Recipient').locator('.ff-gear').click()
  await expect(page.locator('.ff-config')).toBeVisible()
  await shot(page, 'f0-field-settings')
  await page.locator('.ff-config').getByRole('button', { name: 'Cancel' }).click()

  // Linked fields say what they'll fill in with
  await expect(field('Customer name').locator('input')).toHaveAttribute('placeholder', 'From the ticket: customer name')
  await expect(field('Customer name').locator('.ff-link-badge')).toBeVisible()
  // Side by side: the two halves share a line
  const name = await field('Customer name').boundingBox()
  const phone = await field('Customer phone').boundingBox()
  expect(Math.abs(name!.y - phone!.y)).toBeLessThan(4)
  expect(phone!.x).toBeGreaterThan(name!.x + name!.width - 2)
  // The sentence: small fields inline with the text
  const date = await field('Delivery date').boundingBox()
  const to = await field('To').boundingBox()
  expect(Math.abs(date!.y - to!.y)).toBeLessThan(4)

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('.main').evaluate((el) => el.scrollTo(0, 0))
  await shot(page, 'f1-order-form-template')
  await page.locator('.main').evaluate((el) => el.scrollTo(0, 700))
  await shot(page, 'f2-order-form-template-2')
})

test('take an order: linked fields fill in the customer, choices light up', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).click()
  await page.getByRole('button', { name: 'Choose template' }).click()
  await page.locator('.menu-item', { hasText: 'Flower order' }).click()
  await expect(field('Customer name')).toBeVisible()

  // No customer yet: typing the name creates one and links it to the ticket
  await field('Customer name').locator('input').fill('Maya Fernandes')
  await field('Customer name').locator('input').press('Tab')
  await expect(prop('Customer name')).toHaveValue('Maya Fernandes')
  await expect(prop('Customer phone')).toBeEnabled()
  // The ticket's own phone box and the form's phone field are the same thing
  await prop('Customer phone').fill('555-0199')
  await expect(field('Customer phone').locator('input')).toHaveValue('555-0199')
  await field('Customer email').locator('input').fill('maya@example.com')
  await expect(prop('Customer email')).toHaveValue('maya@example.com')

  await field('Order type').getByText('Delivery', { exact: true }).click()
  await expect(field('Order type').locator('.ff-option.on')).toHaveText('Delivery')
  await field('Recipient').locator('input').fill('Grace Okafor')
  await field('Delivery address').locator('textarea').fill('42 Willow Lane, Unit 3')
  await field('Delivery date').locator('input').fill('2026-10-09')
  await field('From').locator('input').fill('10:00')
  await field('To').locator('input').fill('12:00')
  await field('Arrangement').locator('select').selectOption('Vase arrangement')
  await field('Size').getByText('Deluxe').click()
  await field('Colours').getByText('Pink').click()
  await field('Colours').getByText('White').click()
  await expect(field('Colours').locator('.ff-option.on')).toHaveText(['Pink', 'White'])
  await field('Card message').locator('textarea').fill('Happy anniversary! Love always.')
  await expect(field('Total (with tax)').locator('input')).toHaveValue('') // nothing to add up yet
  await field('Flowers price').locator('input').fill('85.00')
  await expect(field('Total (with tax)').locator('input')).toHaveValue('$95.20')
  await field('Delivery fee').locator('input').fill('12.00')
  await expect(field('Total (with tax)').locator('input')).toHaveValue('$108.64')
  await expect(field('Total (with tax)').locator('input')).toHaveAttribute('readonly', '')
  await field('Paid').locator('input').check()
  // Linked to the ticket's pickup date
  await field('Ready by').locator('input').fill('2026-10-09')
  await expect(prop('Pickup date')).toHaveValue('2026-10-09')
  await saved()
  await page.locator('.main').evaluate((el) => el.scrollTo(0, 420))
  await shot(page, 'f3-order-filled')
  await page.locator('.main').evaluate((el) => el.scrollTo(0, 1100))
  await shot(page, 'f4-order-filled-2')

  // The customer record has it all, and it's searchable
  const customers = await page.evaluate(() => window.plannr.customers.list({ query: 'Maya' }))
  expect(customers.map((c) => [c.name, c.phone, c.email])).toEqual([['Maya Fernandes', '555-0199', 'maya@example.com']])
  const found = await page.evaluate(() => window.plannr.search.query('anniversary'))
  expect(found.some((r) => r.type === 'ticket')).toBe(true)
})

test('the template decides the top of its tickets: names, and which parts show', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Templates' }).click()
  await page.locator('.note-row', { hasText: 'Flower order' }).click()
  await page.locator('.layout-panel summary').click()
  const panel = page.locator('.layout-panel')
  await panel.locator('.layout-group', { hasText: 'Title box' }).getByLabel('Name').fill('Order')
  await panel.getByLabel('Example text').first().fill('e.g. Anniversary bouquet')
  await panel.getByLabel('Show it').uncheck()
  await panel.locator('.layout-check', { hasText: 'First date' }).getByLabel('Called').fill('Ordered')
  await panel.locator('.layout-check', { hasText: 'Second date' }).getByLabel('Called').fill('Delivery')
  await panel.getByLabel('Quote & invoice lines').uncheck()
  await panel.getByLabel('Photos').uncheck()
  await panel.getByLabel('Emails with the customer').uncheck()
  await panel.getByLabel('Email', { exact: true }).uncheck() // this business doesn't take emails
  await saved()
  await shot(page, 'f5-template-top-panel')

  // "/Customer details" drops the customer section into a form (here, a blank ticket template)
  await page.locator('.sidebar .nav-item', { hasText: 'Templates' }).click()
  await page.getByRole('button', { name: 'New ticket template' }).click()
  await page.getByLabel('Template name').fill('Quick order')
  await page.locator('.prose').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type('/customer')
  await expect(page.locator('.menu-item[data-selected="true"]')).toContainText('Customer details')
  await page.keyboard.press('Enter')
  for (const label of ['Customer name', 'Phone', 'Email', 'Address']) await expect(field(label).locator('.ff-link-badge')).toBeVisible()
  await saved()
  // Ordinary notes don't offer it
  await page.keyboard.press('Control+n')
  await page.keyboard.type('Plain note')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/customer')
  await expect(page.locator('.menu-item', { hasText: 'Customer details' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A new order: the ticket follows the template
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).click()
  await page.getByRole('button', { name: 'Choose template' }).click()
  await page.locator('.menu-item', { hasText: 'Flower order' }).click()
  await expect(page.getByLabel('Order', { exact: true })).toHaveAttribute('placeholder', 'e.g. Anniversary bouquet')
  await expect(page.locator('.doc-subtitle')).toHaveCount(0)
  await expect(page.locator('.props')).toContainText('Ordered')
  await expect(page.locator('.props')).toContainText('Delivery')
  await expect(page.locator('.photos-header')).toHaveCount(0)
  await expect(prop('Customer phone')).toHaveCount(1)
  await expect(prop('Customer email')).toHaveCount(0)
  await page.getByLabel('Order', { exact: true }).fill('Birthday bouquet')

  // Typing a returning customer's name offers them; picking links them instead of making a duplicate
  await field('Customer name').locator('input').fill('Maya')
  const suggestion = field('Customer name').locator('.ff-suggest-item', { hasText: 'Maya Fernandes' })
  await expect(suggestion).toBeVisible()
  await shot(page, 'f6-customer-suggestion')
  await suggestion.click()
  await expect(prop('Customer name')).toHaveValue('Maya Fernandes')
  await expect(field('Customer phone').locator('input')).toHaveValue('555-0199')
  const mayas = await page.evaluate(() => window.plannr.customers.list({ query: 'Maya' }))
  expect(mayas).toHaveLength(1)

  // The calendar entry uses the template's name for the date
  await prop('Pickup date').fill('2026-10-20')
  await saved()
  const ticketId = await page.evaluate(() => window.plannr.tickets.list({ query: 'Birthday bouquet' }).then((t) => t[0].id))
  const events = await page.evaluate((id) => window.plannr.calendar.forLink(id), ticketId)
  expect(events.map((e) => e.title)).toEqual(['Maya Fernandes delivery'])
  await page.locator('.main').evaluate((el) => el.scrollTo(0, 0))
  await shot(page, 'f7-order-ticket-top')
})

test('everything is kept after a restart; the phone layout stacks fields', async () => {
  await app.close()
  ;({ app, page } = await launch(dataDir))
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).click()
  await page.locator('.ticket-row', { hasText: 'T-0001' }).click()
  await expect(field('Customer name').locator('input')).toHaveValue('Maya Fernandes')
  await expect(field('Colours').locator('.ff-option.on')).toHaveText(['Pink', 'White'])
  await expect(field('Size').locator('.ff-option.on')).toHaveText('Deluxe')
  await expect(field('From').locator('input')).toHaveValue('10:00')
  await expect(field('Paid').locator('input')).toBeChecked()
})
