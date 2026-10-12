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

test('make a task from a story; mark a source as always need-to-know', async () => {
  await nav('News').click()
  const card = page.locator('.news-card', { hasText: 'community groups could receive' }).first()
  await card.getByRole('button', { name: 'Make a task' }).click()
  await expect(page.locator('.toast', { hasText: 'Added to your tasks' })).toBeVisible()
  const tasks = await page.evaluate(() => window.plannr.tasks.list())
  expect(tasks.some((t) => t.title === 'Osoyoos community groups could receive $11,200 in grant funding')).toBe(true)

  await page.getByRole('button', { name: 'Sources & topics' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources and topics' })
  await dialog.getByRole('button', { name: 'Always need to know: Castanet – Oliver / Osoyoos' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  const feed = await page.evaluate(() => window.plannr.news.feed())
  expect(feed.sources.find((x) => x.name === 'Castanet – Oliver / Osoyoos')?.important).toBe(true)
})

test('the calendar shows dates from the news; click one to add it', async () => {
  const feed = await page.evaluate(() => window.plannr.news.feed())
  const dated = feed.items.find((i) => i.when && !i.filtered && !i.eventId)
  test.skip(!dated, 'no story with an upcoming date in the saved sources any more')
  await nav('Calendar').click()
  await expect(page.getByRole('button', { name: 'Local events' })).toHaveAttribute('aria-pressed', 'true')
  // Go to the story's month
  const target = new Date(dated!.when!.date + 'T12:00')
  for (let i = 0; i < 6; i++) {
    const shown = new Date((await page.locator('.cal-title').textContent()) + ' 1')
    if (shown.getMonth() === target.getMonth() && shown.getFullYear() === target.getFullYear()) break
    await page.getByRole('button', { name: shown < target ? 'Next' : 'Previous' }).click()
  }
  const chip = page.locator('.fc-event.ev-news', { hasText: dated!.title.slice(0, 20) }).first()
  await expect(chip).toBeVisible()
  await shot(page, 'news6-calendar')
  await chip.click()
  const dialog = page.getByRole('dialog', { name: 'Add to calendar' })
  await expect(dialog.getByLabel('Event date')).toHaveValue(dated!.when!.date)
  await dialog.getByRole('button', { name: 'Add to calendar' }).click()
  await expect(page.locator('.fc-event:not(.ev-news)', { hasText: dated!.title.slice(0, 20) }).first()).toBeVisible()
  // Turn the layer off
  await page.getByRole('button', { name: 'Local events' }).click()
  await expect(page.locator('.fc-event.ev-news')).toHaveCount(0)
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

test('a sync from another device doesn’t jump back to the top of the page', async () => {
  await nav('News').click()
  await page.locator('.news-card').first().waitFor()
  await page.locator('.main').evaluate((el) => (el.scrollTop = 600))
  const before = await page.locator('.main').evaluate((el) => el.scrollTop)
  expect(before).toBeGreaterThan(300)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('data-changed'))
  await page.waitForTimeout(800)
  expect(await page.locator('.main').evaluate((el) => el.scrollTop)).toBe(before)
})

test('add a Games page: free games and big deals are Top picks, release dates are Coming up', async () => {
  await nav('News').click()
  await page.getByRole('button', { name: 'Add a news page' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a news page' })
  await dialog.getByRole('radio', { name: /Games/ }).click()
  await shot(page, 'news7-add-page')
  await dialog.getByRole('button', { name: 'Add page' }).click()
  await expect(page.getByRole('tab', { name: 'Games' })).toHaveAttribute('aria-selected', 'true')
  const picks = page.locator('.news-picks')
  await expect(picks).toContainText('Top picks')
  await expect(page.locator('.news-main')).toContainText('Bad Cheese') // free next week
  await expect(page.locator('.news-main')).toContainText('Silver Pines – US$22.26 (38% off)')
  await expect(page.locator('.news-card', { hasText: 'Silver Pines' }).locator('.news-discount')).toHaveText('−38%')
  // Nothing from Local here, and nothing from here on Local
  await expect(page.locator('.news-main')).not.toContainText('Osoyoos Fire Rescue')
  await shot(page, 'news8-games')
  await page.getByRole('tab', { name: 'Local' }).click()
  await expect(page.locator('.news-main')).not.toContainText('Silver Pines')
  await expect(page.locator('.news-weather')).toBeVisible()
})

test('add a PC parts page and tune it', async () => {
  await page.getByRole('button', { name: 'Add a news page' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a news page' })
  await dialog.getByRole('radio', { name: /PC parts/ }).click()
  await dialog.getByLabel('Page name').fill('Shop deals')
  await dialog.getByRole('button', { name: 'Add page' }).click()
  await expect(page.getByRole('tab', { name: 'Shop deals' })).toHaveAttribute('aria-selected', 'true')
  const main = page.locator('.news-main')
  await expect(main).toContainText('Acer Predator X32')
  await expect(main).not.toContainText('Laundry Detergent') // not a PC part
  await shot(page, 'news9-pc-parts')

  await page.getByRole('button', { name: 'Page settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Page settings' })
  await expect(settings.getByLabel('Only words')).toHaveValue(/gpu, graphics card/)
  await settings.getByLabel('Important words').fill('keyboard')
  await settings.getByRole('checkbox', { name: 'Notify me about new Top picks' }).check()
  await shot(page, 'news10-page-settings')
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.news-picks')).toContainText('Wireless Keyboard')
  const feed = await page.evaluate(() => window.plannr.news.feed())
  expect(feed.pages.find((p) => p.name === 'Shop deals')).toMatchObject({ boost: ['keyboard'], notify: true })

  // Delete it: its sources go too
  await page.getByRole('button', { name: 'Page settings' }).click()
  await settings.getByRole('button', { name: 'Delete page' }).click()
  await settings.getByRole('button', { name: /Delete “Shop deals”/ }).click()
  await expect(page.getByRole('tab', { name: 'Shop deals' })).toHaveCount(0)
  const after = await page.evaluate(() => window.plannr.news.feed())
  expect(after.sources.some((s) => /redflagdeals/.test(s.url))).toBe(false)
})
