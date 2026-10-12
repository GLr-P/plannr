import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Entertainment, lists and habits, packages, weather on the calendar, Home tiles, warranty, free trials, mail
// and the assistant's setup. Downloads come from saved copies of the real sources (tests/fixtures/news).
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

test.beforeAll(async () => {
  ;({ app, page } = await launch(mkdtempSync(join(tmpdir(), 'plannr-e2e-extras-'))))
  await page.evaluate(() =>
    window.plannr.news.configure({ prefs: { place: { name: 'Osoyoos', region: 'British Columbia', country: 'Canada', countryCode: 'CA', lat: 49.03, lon: -119.45 } } })
  )
})
test.afterAll(async () => {
  await app?.close()
})

test('Entertainment: add a YouTube channel and Twitch streamers; see new videos and who is live', async () => {
  await nav('Entertainment').click()
  await page.getByLabel('Channel to add').fill('https://www.youtube.com/@LinusTechTips')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.ent-video').first()).toBeVisible()
  await expect(page.locator('.ent-video').first()).toContainText('Linus Tech Tips')
  await page.getByRole('radio', { name: 'Twitch' }).click()
  await page.getByLabel('Channel to add').fill('shroud')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Channel to add').fill('xqc')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.ent-live')).toHaveCount(1)
  await expect(page.locator('.ent-live')).toContainText(/shroud/i)
  await expect(page.locator('.ent-offline')).toContainText(/xqc/i)
  await shot(page, 'x1-entertainment')
})

test('Lists and habits: add, tick and clear; a daily habit with a streak', async () => {
  await nav('Lists').click()
  await page.getByLabel('New item').fill('Milk, Eggs, Bread')
  await page.getByLabel('New item').press('Enter')
  await expect(page.locator('.list-item')).toHaveCount(3)
  await page.getByRole('checkbox', { name: 'Tick Milk' }).click()
  await expect(page.locator('.list-items.done .list-item')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear ticked' }).click()
  await expect(page.locator('.list-item')).toHaveCount(2)
  await page.getByLabel('New habit').fill('Drink water')
  await page.getByLabel('New habit').press('Enter')
  await page.getByRole('checkbox', { name: 'Done today: Drink water' }).click()
  await expect(page.locator('.habit', { hasText: 'Drink water' }).locator('.habit-streak')).toHaveText('1')
  await shot(page, 'x2-lists')
})

test('Packages: the carrier from the number, and the expected day on the calendar', async () => {
  await nav('Packages').click()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  await page.getByLabel('Tracking number').fill('1Z999AA10123456784')
  await page.getByLabel('What it is').fill('RTX card')
  await page.getByLabel('Expected').fill(iso(tomorrow))
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.pkg')).toContainText('RTX card')
  await expect(page.locator('.pkg')).toContainText('UPS')
  await shot(page, 'x3-packages')
  await nav('Calendar').click()
  if (tomorrow.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('.fc-event.ev-package', { hasText: 'RTX card' })).toBeVisible()
  await expect(page.locator('.cal-weather').first()).toBeVisible() // the forecast in the month
  await shot(page, 'x4-calendar-weather')
})

test('Warranty on a ticket, and a free trial with a price increase', async () => {
  const customer = await page.evaluate(() => window.plannr.customers.create({ name: 'Rosa Lima' }))
  const ticket = await page.evaluate((id) => window.plannr.tickets.create({ customerId: id }), customer.id)
  await page.evaluate((id) => window.plannr.tickets.update(id, { device: 'Laptop' }), ticket.id)
  await nav('Tickets').click()
  await page.locator('.ticket-row, tr', { hasText: 'Laptop' }).first().click()
  await page.getByLabel('Warranty length').selectOption('90')
  await expect(page.getByLabel('Warranty until')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
  await expect.poll(() => page.evaluate((id) => window.plannr.tickets.get(id).then((t) => t!.warrantyUntil), ticket.id)).not.toBeNull()
  const sub = await page.evaluate(() => window.plannr.money.createRecurring('subscription'))
  const trial = new Date()
  trial.setDate(trial.getDate() + 10)
  await page.evaluate(({ id, date }) => window.plannr.money.updateRecurring(id, { name: 'Game Pass', amountCents: 1999, trialEnds: date }), { id: sub.id, date: iso(trial) })
  await page.evaluate((id) => window.plannr.money.updateRecurring(id, { amountCents: 2299 }), sub.id)
  await nav('Money').click()
  await page.getByRole('tab', { name: 'Bills & subscriptions' }).click()
  await expect(page.locator('.recurring-item', { hasText: 'Game Pass' }).locator('.trial-badge')).toBeVisible()
  await expect(page.locator('.recurring-item', { hasText: 'Game Pass' }).locator('.price-up-badge')).toContainText('$19.99')
})

test('Home as tiles: weather, habits, lists, packages', async () => {
  await nav('Home').click()
  await expect(page.locator('.home-grid')).toBeVisible()
  await expect(page.locator('.home-forecast .home-day')).toHaveCount(7)
  await expect(page.locator('.home-grid')).toContainText('Drink water')
  await expect(page.locator('.home-grid')).toContainText('RTX card')
  await expect(page.locator('.home-grid')).toContainText('Eggs')
  await shot(page, 'x5-home-tiles')
})

test('Mail asks to connect Zoho; the assistant asks for a key', async () => {
  await nav('Mail').click()
  await expect(page.locator('.mail-page')).toContainText('Connect your Zoho Mail')
  await nav('Assistant').click()
  await expect(page.getByLabel('Ask the assistant')).toBeDisabled() // no key yet
  await expect(page.getByLabel('Which AI')).toHaveValue('gemini') // free Gemini unless you choose another
  await expect(page.getByLabel('API key')).toHaveAttribute('placeholder', /Gemini/)
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemini-3.8-flash')
  await page.getByLabel('Which AI').selectOption('ollama')
  await expect(page.getByLabel('API key')).toHaveCount(0) // runs on this PC: no key
  await expect(page.getByLabel('Ask the assistant')).toBeEnabled()
  // Sending a message keeps the page working (it used to crash) and explains a problem in plain words
  const crashes: string[] = []
  page.on('pageerror', (e) => crashes.push(e.message))
  await page.getByLabel('Ask the assistant').fill('What is coming up this week?')
  await page.getByLabel('Ask the assistant').press('Enter')
  await expect(page.locator('.chat-msg.user')).toContainText('What is coming up this week?')
  await expect(page.locator('.assistant-page .danger-text')).toContainText('Ollama')
  await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible()
  expect(crashes).toEqual([])
  await page.getByLabel('Which AI').selectOption('openai')
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-5-mini')
  await page.getByLabel('Which AI').selectOption('gemini')
  await shot(page, 'x6-assistant')
})
