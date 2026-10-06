import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Repeating events: set in the event's popover; every occurrence shows; delete one or all.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-repeat-'))
let app: ElectronApplication
let page: Page
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const first = new Date()
first.setDate(1) // the 1st of this month, so every week of it is on screen
const D1 = iso(first)
const plus = (days: number) => iso(new Date(first.getFullYear(), first.getMonth(), first.getDate() + days))

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
  await page.evaluate((date) => window.plannr.calendar.create({ title: 'Staff meeting', date, startTime: '09:00', endTime: '09:30' }), D1)
})
test.afterAll(async () => {
  await app?.close()
})

test('make an event repeat weekly; each week shows it; delete one occurrence, then all', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Calendar' }).first().click()
  const day = (d: string) => page.locator(`.fc-daygrid-day[data-date="${d}"]`)
  await day(D1).locator('.fc-event', { hasText: 'Staff meeting' }).click()
  await page.getByLabel('Repeat', { exact: true }).selectOption('weekly')
  await expect(page.locator('.popover-foot')).toContainText('Saved')
  await page.keyboard.press('Escape')
  for (const d of [D1, plus(7), plus(14), plus(21)]) await expect(day(d).locator('.fc-event', { hasText: 'Staff meeting' })).toHaveCount(1)
  await shot(page, 'r1-repeating')

  await day(plus(7)).locator('.fc-event', { hasText: 'Staff meeting' }).click()
  await page.getByRole('button', { name: 'Delete this one' }).click()
  await expect(day(plus(7)).locator('.fc-event', { hasText: 'Staff meeting' })).toHaveCount(0)
  await expect(day(plus(14)).locator('.fc-event', { hasText: 'Staff meeting' })).toHaveCount(1)

  await day(plus(14)).locator('.fc-event', { hasText: 'Staff meeting' }).click()
  const all = page.getByRole('button', { name: 'Delete every occurrence' })
  await all.click()
  await all.click() // second click confirms
  await expect(page.locator('.fc-event', { hasText: 'Staff meeting' })).toHaveCount(0)
})
