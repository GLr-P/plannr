import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, root, shot } from './helpers'

// Uses a saved copy of Google's real US holiday feed instead of the internet.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const cell = (date: string) => page.locator(`.fc-daygrid-day[data-date="${date}"]`)

/** Clicks next/previous until the calendar shows the given month title, e.g. "November 2026". */
async function gotoMonth(title: string, target: Date): Promise<void> {
  for (let i = 0; i < 36; i++) {
    const current = await page.locator('.cal-title').textContent()
    if (current === title) return
    const shown = new Date(`${current} 1`)
    await page.getByRole('button', { name: shown < target ? 'Next' : 'Previous' }).click()
  }
  throw new Error(`Could not reach ${title}`)
}

test.beforeAll(async () => {
  ;({ app, page } = await launch(mkdtempSync(join(tmpdir(), 'plannr-e2e-hol-')), {
    PLANNR_HOLIDAY_FIXTURE: join(root, 'tests', 'fixtures', 'us-holidays.ics')
  }))
})
test.afterAll(async () => {
  await app?.close()
})

test('US holidays are on by default and downloaded automatically', async () => {
  await nav('Settings').click()
  await expect(page.getByLabel('Holiday country')).toHaveValue('en.usa')
  await expect(page.locator('.holiday-status')).toContainText(/\d+ holidays · updated just now/)
  await shot(page, 'h1-settings')
})

test('holidays show on the calendar, read-only', async () => {
  await nav('Calendar').click()
  await gotoMonth('November 2026', new Date(2026, 10, 1))
  const thanksgiving = cell('2026-11-26').locator('.ev-holiday')
  await expect(thanksgiving).toContainText('Thanksgiving Day')
  await expect(cell('2026-11-11').locator('.ev-holiday')).toContainText('Veterans Day')
  await expect(cell('2026-11-01').locator('.ev-observance')).toContainText('Daylight Saving Time ends')
  await shot(page, 'h2-calendar')
  await thanksgiving.click()
  await expect(page.locator('.event-popover')).toHaveCount(0) // no editing holidays
})

test('observances can be hidden and holidays turned off', async () => {
  await nav('Settings').click()
  await page.getByLabel('Also show observances (Valentine’s Day, Daylight Saving…)').uncheck()
  await nav('Calendar').click()
  await expect(cell('2026-11-26').locator('.ev-holiday')).toContainText('Thanksgiving Day')
  await expect(cell('2026-11-01').locator('.ev-holiday')).toHaveCount(0)

  await nav('Settings').click()
  await page.getByLabel('Holiday country').selectOption('off')
  await nav('Calendar').click()
  await expect(cell('2026-11-26')).toBeVisible()
  await expect(page.locator('.ev-holiday')).toHaveCount(0)
})
