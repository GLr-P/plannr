import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// The News page: choosing your place, the suggested sources, adding a web page, topics, saving stories and
// putting one on the calendar. Every download comes from saved copies of the real sources (tests/fixtures/news).
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()

test.beforeAll(async () => {
  ;({ app, page } = await launch(mkdtempSync(join(tmpdir(), 'plannr-e2e-news-'))))
})
test.afterAll(async () => {
  await app?.close()
})

test('set up: find your town, take the suggested sources, add your town’s news page', async () => {
  await nav('News').click()
  await expect(page.getByRole('heading', { name: 'What’s happening around you' })).toBeVisible()
  await page.getByLabel('Your town or city').fill('Osoyoos')
  await page.getByRole('button', { name: 'Find' }).click()
  await page.locator('.news-place-results button', { hasText: 'British Columbia' }).first().click()
  const list = page.locator('.news-source-list')
  await expect(list).toContainText('Osoyoos news (Google News)')
  await expect(list).toContainText('Weather – Osoyoos')
  await expect(list).toContainText('Roads near Osoyoos (DriveBC)')
  await expect(list).toContainText('Castanet – Oliver / Osoyoos')
  await page.getByLabel('Add a source link').fill('https://www.osoyoos.ca/community/news-alerts')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(list.locator('li')).toHaveCount(6)
  await shot(page, 'news1-setup')
  await page.getByRole('button', { name: 'Show me the news' }).click()

  await expect(page.locator('.news-header h1')).toHaveText('News')
  await expect(page.locator('.news-place')).toContainText('Osoyoos')
  await expect(page.locator('.news-weather-temp')).toHaveText('14°')
  await expect(page.locator('.news-card', { hasText: 'Osoyoos Fire Rescue welcomes more than 70 visitors' })).toBeVisible()
  await expect(page.locator('.news-main')).toContainText('Agricultural Irrigation Systems') // from the town's page
  await expect(page.locator('.news-main')).toContainText('Osoyoos – News')
  // The same story from Castanet and Google News shows once
  await expect(page.locator('.news-card', { hasText: 'Osoyoos community groups could receive $11,200' })).toHaveCount(1)
  await expect(page.locator('.news-errors')).toHaveCount(0)
  await shot(page, 'news2-feed')
})

test('topics: show one topic, and hide or show sad news', async () => {
  await page.getByRole('tab', { name: 'Council & elections' }).click()
  const cards = page.locator('.news-card')
  await expect(cards.first()).toBeVisible()
  for (const t of await cards.locator('.news-topic').allTextContents()) expect(t).toBe('Council & elections')
  await page.getByRole('tab', { name: 'For you' }).click()

  await page.getByRole('button', { name: 'Sources & topics' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources and topics' })
  await expect(dialog.getByRole('button', { name: 'Sad news' })).toHaveAttribute('aria-pressed', 'false') // left out by default
  await dialog.getByLabel('Muted words').fill('aurora')
  await shot(page, 'news3-settings')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.news-card', { hasText: 'aurora' })).toHaveCount(0)
  await page.locator('.news-filtered').click() // "Show N stories left out…"
  await expect(page.locator('.news-card', { hasText: 'aurora' }).first()).toBeVisible()
})

test('save a story, hide one (with undo), and put one on the calendar', async () => {
  const fire = page.locator('.news-card', { hasText: 'Osoyoos Fire Rescue welcomes' })
  await fire.getByRole('button', { name: 'Save for later' }).click()
  await page.getByRole('tab', { name: /^Saved/ }).click()
  await expect(page.locator('.news-card')).toHaveCount(1)
  await page.getByRole('tab', { name: 'For you' }).click()

  const grants = page.locator('.news-card', { hasText: 'community groups could receive' })
  await grants.getByRole('button', { name: 'Hide this story' }).click()
  await expect(grants).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(grants).toHaveCount(1)

  await fire.getByRole('button', { name: 'Add to calendar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to calendar' })
  await dialog.getByLabel('Event title').fill('Fire hall open house')
  await dialog.getByLabel('Start time').fill('10:00')
  const date = await dialog.getByLabel('Event date').inputValue()
  await shot(page, 'news4-add-to-calendar')
  await dialog.getByRole('button', { name: 'Add to calendar' }).click()
  await expect(fire.getByRole('button', { name: 'On your calendar' })).toBeVisible()
  const events = await page.evaluate((d) => window.plannr.calendar.range(d, d), date)
  const ev = events.find((e) => e.title === 'Fire hall open house')!
  expect(ev.startTime).toBe('10:00')
  expect(ev.notes).toContain('https://www.castanet.net/news/Oliver-Osoyoos/634086/')
  // "On your calendar" opens it there
  await fire.getByRole('button', { name: 'On your calendar' }).click()
  await expect(page.locator('.fc-event', { hasText: 'Fire hall open house' }).first()).toBeVisible()
})

test('Home shows the local news', async () => {
  await nav('Home').click()
  const section = page.locator('section', { has: page.locator('.section-title', { hasText: 'Around Osoyoos' }) })
  await expect(section).toBeVisible()
  await expect(section.locator('.history-row').first()).toBeVisible()
  await shot(page, 'news5-home')
  await section.locator('.history-row').first().click()
  await expect(page.locator('.news-header h1')).toHaveText('News')
})
