import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-cal-'))
let app: ElectronApplication
let page: Page
let janeTicket = ''
let bobTicket = ''

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const today = `${ym}-${pad(now.getDate())}`
const D10 = `${ym}-10`
const D15 = `${ym}-15`
const D16 = `${ym}-16`
const D20 = `${ym}-20`
const D22 = `${ym}-22`

const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()
const dayCell = (date: string) => page.locator(`.fc-daygrid-day[data-date="${date}"]`)
const popover = () => page.locator('.event-popover')
const pickupOf = (id: string) => page.evaluate(async (tid) => (await window.plannr.tickets.get(tid))!.pickupOn, id)

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
  // Setup through the app's own API: two customers with tickets, and a note.
  ;({ janeTicket, bobTicket } = await page.evaluate(async () => {
    const p = window.plannr
    const jane = await p.customers.create({ name: 'Jane Doe' })
    const bob = await p.customers.create({ name: 'Bob Smith' })
    const t1 = await p.tickets.create({ customerId: jane.id, templateId: null })
    const t2 = await p.tickets.create({ customerId: bob.id, templateId: null })
    await p.tickets.update(t1.id, { device: 'iPhone 13' })
    await p.tickets.update(t2.id, { device: 'Dell XPS' })
    const note = await p.notes.create({ title: 'Order screens' })
    await p.notes.update(note.id, { pinned: true }) // pinned notes stay in the sidebar
    return { janeTicket: t1.id, bobTicket: t2.id }
  }))
  await page.reload()
  await page.waitForSelector('.sidebar')
})
test.afterAll(async () => {
  await app?.close()
})

test('a pickup date set on the ticket shows on the calendar', async () => {
  await nav('Tickets').click()
  await page.locator('.ticket-row', { hasText: 'Jane Doe' }).click()
  await page.getByLabel('Pickup date').fill(D15)
  await expect(page.locator('.save-status')).toHaveAttribute('data-status', 'saved')
  await expect(page.locator('.backlinks', { hasText: 'On the calendar' })).toContainText('Jane Doe pickup')

  await nav('Calendar').click()
  await expect(dayCell(D15).locator('.fc-event')).toContainText('Jane Doe pickup')
  await shot(page, 'c1-month')
})

test('dragging a ticket from the tray onto a day sets its pickup, and the text can be edited', async () => {
  await page.getByRole('button', { name: 'Tickets', exact: true }).click()
  const item = page.locator('.tray-item', { hasText: 'Bob Smith' })
  await item.dragTo(dayCell(D20))

  await expect(popover()).toBeVisible()
  const title = page.getByLabel('Event title')
  await expect(title).toHaveValue('Bob Smith pickup')
  await expect(popover().locator('.popover-link')).toContainText('T-0002 · Dell XPS (Bob Smith)')
  await title.fill('Bob picks up laptop')
  await expect(popover().locator('.popover-foot')).toContainText('Saved')
  await page.keyboard.press('Escape')
  await expect(popover()).toHaveCount(0)
  await expect(dayCell(D20).locator('.fc-event')).toContainText('Bob picks up laptop')
  expect(await pickupOf(bobTicket)).toBe(D20)
  await expect(item).toContainText('Pickup') // tray shows the new pickup
})

test('dragging a note from the sidebar creates a linked event', async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Order screens' }).dragTo(dayCell(D10))
  await expect(page.getByLabel('Event title')).toHaveValue('Order screens')
  await expect(popover().locator('.popover-link')).toContainText('Order screens')
  await page.keyboard.press('Escape')
  await expect(dayCell(D10).locator('.fc-event')).toContainText('Order screens')
})

test('clicking an event shows why it is linked and opens the ticket', async () => {
  await dayCell(D15).locator('.fc-event').click()
  await expect(popover().locator('.popover-link')).toContainText('T-0001 · iPhone 13 (Jane Doe)')
  await expect(popover().getByLabel('This is the ticket’s pickup date')).toBeChecked()
  await popover().getByLabel('Day before (9 AM)').uncheck()
  await page.getByLabel('Event notes').fill('Bring charger')
  await expect(popover().locator('.popover-foot')).toContainText('Saved')
  await shot(page, 'c2-popover')

  await popover().locator('.popover-link').click()
  await expect(page.locator('.ticket-no')).toHaveText('T-0001')
  const ev = await page.evaluate(async (id) => (await window.plannr.calendar.forLink(id))[0], janeTicket)
  expect(ev.reminders).toEqual(['day_of'])
  expect(ev.notes).toBe('Bring charger')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
})

test('dragging an event to another day moves the ticket pickup too', async () => {
  const ev = dayCell(D15).locator('.fc-event')
  const from = (await ev.boundingBox())!
  const to = (await dayCell(D16).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(dayCell(D16).locator('.fc-event')).toContainText('Jane Doe pickup')
  await expect.poll(() => pickupOf(janeTicket)).toBe(D16)
})

test('clicking an empty day adds an event', async () => {
  await dayCell(D22).click({ position: { x: 40, y: 60 } })
  await expect(page.getByLabel('New event title')).toBeVisible()
  await page.keyboard.type('Supplier visit')
  await page.keyboard.press('Enter')
  await expect(dayCell(D22).locator('.fc-event')).toContainText('Supplier visit')
})

test('week view: dropping a ticket on a time slot schedules a timed pickup', async () => {
  await page.getByRole('tab', { name: 'Week' }).click()
  const col = page.locator(`.fc-timegrid-col[data-date="${today}"]`)
  const slot = page.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]')
  await slot.scrollIntoViewIfNeeded()
  const colBox = (await col.boundingBox())!
  const slotBox = (await slot.boundingBox())!
  // Native drag with the mouse (the time-slot grid overlays the day column, so dragTo's target check refuses it)
  await page.locator('.tray-item', { hasText: 'Bob Smith' }).hover()
  await page.mouse.down()
  await page.mouse.move(colBox.x + colBox.width / 2, slotBox.y + slotBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByLabel('Start time')).toHaveValue('10:00')
  await page.keyboard.press('Escape')
  await expect(col.locator('.fc-event')).toContainText('Bob picks up laptop')
  expect(await pickupOf(bobTicket)).toBe(today) // moved, not duplicated
  await shot(page, 'c3-week')
  await page.getByRole('tab', { name: 'Month' }).click()
})

test('Home shows what is coming up', async () => {
  await nav('Home').click()
  const row = page.locator('.history-row', { hasText: 'Bob picks up laptop' })
  await expect(row).toContainText('Today')
  await expect(row).toContainText('10:00 AM')
  await shot(page, 'c4-home')
  await row.click()
  await expect(page.getByLabel('Event title')).toHaveValue('Bob picks up laptop')
  await page.keyboard.press('Escape')
})

test('settings and events survive a restart', async () => {
  await nav('Settings').click()
  await expect(page.getByRole('switch', { name: 'Start with Windows' })).toBeVisible()
  const tray = page.getByRole('switch', { name: 'Keep running in the tray' })
  await expect(tray).toHaveAttribute('aria-checked', 'true')
  await tray.click()
  await expect(tray).toHaveAttribute('aria-checked', 'false')
  await shot(page, 'c5-settings')

  await app.close()
  ;({ app, page } = await launch(dataDir))
  await nav('Settings').click()
  await expect(page.getByRole('switch', { name: 'Keep running in the tray' })).toHaveAttribute('aria-checked', 'false')
  await nav('Calendar').click()
  await expect(dayCell(D16).locator('.fc-event')).toContainText('Jane Doe pickup')
  await expect(dayCell(D10).locator('.fc-event')).toContainText('Order screens')
  await expect(dayCell(D22).locator('.fc-event')).toContainText('Supplier visit')
})
