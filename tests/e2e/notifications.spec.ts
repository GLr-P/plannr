import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Choosing whether and when an event notifies you, and the defaults for new events.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-notify-'))
let app: ElectronApplication
let page: Page

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-12`
const popover = () => page.locator('.event-popover')
const chip = (scope: ReturnType<Page['locator']>, name: string) => scope.getByRole('button', { name, exact: true })
const remindersOf = (id: string) => page.evaluate(async (eid) => (await window.plannr.calendar.get(eid))!.reminders, id)

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
})
test.afterAll(async () => {
  await app?.close()
})

test('an event with a time: pick when it notifies you, or not at all', async () => {
  const ev = await page.evaluate((date) => window.plannr.calendar.create({ title: 'Dentist', date, startTime: '15:00', endTime: '16:00' }), day)
  expect(ev.reminders).toEqual(['before:15']) // the default for events with a time
  await page.locator('.sidebar .nav-item', { hasText: 'Calendar' }).first().click()
  await page.locator(`.fc-daygrid-day[data-date="${day}"] .fc-event`, { hasText: 'Dentist' }).click()
  const notify = popover().getByRole('group', { name: 'Notify me' })
  await expect(chip(notify, '15 min before')).toHaveAttribute('aria-pressed', 'true')
  await chip(notify, '1 hour before').click()
  await chip(notify, 'When it starts').click()
  await expect.poll(() => remindersOf(ev.id)).toEqual(['before:15', 'before:60', 'before:0'])
  await shot(page, 'n1-notify-me')

  await chip(notify, 'Don’t notify').click()
  await expect(chip(notify, 'Don’t notify')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => remindersOf(ev.id)).toEqual([])

  // All day: the choices change to morning of / day before / week before
  await popover().getByLabel('All day').check()
  await expect(chip(notify, 'Week before (9 AM)')).toBeVisible()
  await chip(notify, 'Week before (9 AM)').click()
  await expect.poll(() => remindersOf(ev.id)).toEqual(['week_before'])
  await page.keyboard.press('Escape')
})

test('Settings: defaults for new events, and a test notification', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await page.getByRole('tab', { name: 'General' }).click()
  const timed = page.getByRole('group', { name: 'Events with a time' })
  const allDay = page.getByRole('group', { name: 'All-day events' })
  await timed.scrollIntoViewIfNeeded()
  await expect(chip(timed, '15 min before')).toHaveAttribute('aria-pressed', 'true')
  await chip(timed, '15 min before').click()
  await chip(timed, 'When it starts').click()
  await chip(allDay, 'Don’t notify').click()
  await page.getByRole('button', { name: 'Test notification' }).click()
  await expect(page.locator('.toast')).toContainText('Sent')
  await shot(page, 'n2-notification-settings')

  const made = await page.evaluate(async (date) => {
    const timedEv = await window.plannr.calendar.create({ title: 'Call', date, startTime: '10:00' })
    const allDayEv = await window.plannr.calendar.create({ title: 'Day off', date })
    return [timedEv.reminders, allDayEv.reminders]
  }, day)
  expect(made).toEqual([['before:0'], []])
})
