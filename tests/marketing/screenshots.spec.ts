import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, root } from '../e2e/helpers'

/*
 * Screenshots for the README and the website, taken with made-up demo data (no real customers).
 * Run: npm run build && npx playwright test --config tests/marketing/playwright.config.ts
 * Output: docs/screenshots/*.png
 */

const out = join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}

test('website screenshots', async () => {
  test.setTimeout(180_000)
  const dataDir = mkdtempSync(join(tmpdir(), 'plannr-shots-'))
  const { app, page } = await launch(dataDir)
  const shot = (name: string) => page.screenshot({ path: join(out, `${name}.png`) })

  await page.evaluate(
    async ({ d }) => {
      const p = window.plannr
      await p.business.set({ name: 'Maple Repair Co.', phone: '(555) 010-2030', taxName: 'GST', taxRate: 5 })
      await p.display.set({ ticketPrefix: 'MR-' })
      const people = [
        ['Priya Sharma', '(555) 014-8821', 'priya@example.com'],
        ['Marcus Lee', '(555) 019-4410', 'marcus@example.com'],
        ['Sofia Rossi', '(555) 012-7733', 'sofia@example.com'],
        ['Daniel Okafor', '(555) 016-2290', 'daniel@example.com'],
        ['Emma Tremblay', '(555) 011-5567', 'emma@example.com']
      ]
      const customers = []
      for (const [name, phone, email] of people) customers.push(await p.customers.create({ name, phone, email }))
      const jobs: [number, string, string, string, number, number | null][] = [
        [0, 'iPhone 14 Pro', 'Cracked screen, Face ID works', 'ready', 28999, 0],
        [1, 'MacBook Air M2', 'Liquid spill, won’t power on', 'diagnosing', 45000, 3],
        [2, 'Galaxy S23', 'Battery drains by noon', 'waiting_parts', 12999, 5],
        [3, 'Nintendo Switch', 'Joy-Con drift (both)', 'intake', 7999, 2],
        [4, 'iPad 9th gen', 'Charging port loose', 'ready', 9999, 1],
        [0, 'Dell XPS 13', 'Keyboard keys sticking', 'picked_up', 15999, null]
      ]
      const tickets = []
      for (const [c, device, issue, status, price, pickup] of jobs) {
        const t = await p.tickets.create({ customerId: customers[c].id })
        await p.tickets.update(t.id, {
          device,
          issue,
          status: status as never,
          priceCents: price,
          receivedOn: d[0],
          pickupOn: pickup === null ? null : d[pickup]
        })
        tickets.push(t)
      }
      // Fill the first ticket's check-in form
      const first = await p.tickets.get(tickets[0].id)
      const fill: Record<string, string> = {
        'Condition on arrival': 'Small dent bottom-left corner; screen shattered from top edge',
        'Accessories left': 'Case',
        'Data backup': 'Not needed',
        'Problem (customer’s words)': 'Dropped it on the sidewalk, touch still works',
        'Parts used': 'OLED screen assembly',
        'Warranty (days)': '90'
      }
      const walk = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
        if (n.type === 'formField' && typeof n.attrs?.label === 'string' && fill[n.attrs.label]) n.attrs.value = fill[n.attrs.label]
        if (n.type === 'taskItem' && n.attrs) n.attrs.checked = true
        for (const c of (n.content ?? []) as (typeof n)[]) walk(c)
      }
      if (first?.content) {
        walk(first.content as never)
        await p.tickets.update(first.id, { content: first.content })
      }
      await p.money.addTransaction({ type: 'income', amountCents: 15999, ticketId: tickets[5].id, method: 'Card', date: d[0], description: 'Payment' })
      await p.money.addTransaction({ type: 'income', amountCents: 9999, method: 'e-Transfer', date: d[0], description: 'Data recovery' })
      await p.money.addTransaction({ type: 'expense', amountCents: 18400, category: 'Parts', description: 'iPhone screens ×2', method: 'Card', date: d[0] })
      const rent = await p.money.createRecurring('bill')
      await p.money.updateRecurring(rent.id, { name: 'Shop rent', amountCents: 180000, nextDue: d[6], category: 'Rent' })
      const adobe = await p.money.createRecurring('subscription')
      await p.money.updateRecurring(adobe.id, { name: 'Accounting software', amountCents: 3500, nextDue: d[3], autopay: true, category: 'Software' })
      await p.calendar.create({ title: 'Parts order arrives', date: d[2], startTime: '10:00' })
      await p.calendar.create({ title: 'Supplier call', date: d[4], startTime: '14:30' })

      // Notes, organised
      const work = await p.sidebar.createSection('Shop')
      const guides = await p.folders.create('Repair guides', { sectionId: work.id })
      const tpl = (await p.templates.list('note')).find((t) => t.name === 'Repair guide')!
      const guide = await p.notes.create({ templateId: tpl.id, title: 'iPhone 14 Pro screen', folderId: guides.id })
      await p.notes.update(guide.id, { icon: 'Smartphone', color: 'blue' })
      // Fill the guide so it looks like a real one
      const g = await p.notes.get(guide.id)
      type N = { type: string; attrs?: Record<string, unknown>; content?: N[]; text?: string }
      const para = (t: string): N => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
      const items = (...t: string[]): N[] => t.map((x) => ({ type: 'listItem', content: [para(x)] }))
      const values: Record<string, string> = { Device: 'iPhone 14 Pro', Difficulty: 'Moderate', Time: '45 minutes' }
      const rows = [
        ['OLED screen assembly', 'Parts supplier', '$129'],
        ['Adhesive strips', 'Parts supplier', '$4']
      ]
      const fillGuide = (n: N): void => {
        if (n.type === 'formField' && n.attrs && values[String(n.attrs.label)]) n.attrs.value = values[String(n.attrs.label)]
        if (n.type === 'bulletList') n.content = items('Pentalobe P2 screwdriver', 'Heat pad or heat gun', 'Suction cup and opening picks')
        if (n.type === 'orderedList')
          n.content = items('Heat the edges, then lift with a suction cup', 'Disconnect the battery first', 'Swap the screen and move the earpiece over', 'Test Face ID, touch and True Tone before sealing')
        if (n.type === 'table')
          n.content?.slice(1).forEach((row, r) => row.content?.forEach((cell, c) => (cell.content = [para(rows[r]?.[c] ?? '')])))
        n.content?.forEach(fillGuide)
      }
      if (g?.content) {
        fillGuide(g.content as N)
        await p.notes.update(guide.id, { content: g.content })
      }
      const sup = (await p.templates.list('note')).find((t) => t.name === 'Supplier')!
      const s = await p.notes.create({ templateId: sup.id, title: 'Parts supplier' })
      await p.sidebar.move({ type: 'note', id: s.id }, { sectionId: work.id }, [
        { type: 'folder', id: guides.id },
        { type: 'note', id: s.id }
      ])
      await p.notes.update(s.id, { icon: 'Truck', color: 'orange' })
      const hours = await p.notes.create({ title: 'Shop hours & policies' })
      await p.notes.update(hours.id, { pinned: true, icon: '🕘' })
    },
    { d: Array.from({ length: 8 }, (_, i) => day(i)) }
  )
  await page.reload()
  await page.waitForSelector('.sidebar')
  await page.setViewportSize({ width: 1320, height: 820 })
  await page.locator('.sidebar .nav-item', { hasText: 'Repair guides' }).locator('.folder-chevron').click()

  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).first().click()
  await expect(page.locator('.home .section-title').first()).toBeVisible()
  await shot('home')

  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.getByRole('tab', { name: 'All', exact: true }).click().catch(() => undefined)
  await shot('tickets')

  await page.locator('.ticket-row', { hasText: 'iPhone 14 Pro' }).click()
  await expect(page.locator('.ticket-no')).toHaveText('MR-0001')
  await shot('ticket')

  await page.locator('.sidebar .nav-item', { hasText: 'Calendar' }).first().click()
  await expect(page.locator('.fc')).toBeVisible()
  await shot('calendar')

  await page.locator('.sidebar .nav-item', { hasText: 'Money' }).first().click()
  await page.getByRole('tab', { name: 'Overview' }).click()
  await shot('money')

  await page.locator('.sidebar .nav-item', { hasText: 'iPhone 14 Pro screen' }).click()
  await expect(page.locator('.prose table')).toBeVisible()
  await shot('note')

  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).first().click()
  await shot('home-dark')
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.locator('.ticket-row', { hasText: 'iPhone 14 Pro' }).click()
  await shot('ticket-dark')
  await page.keyboard.press('Control+,')
  await page.getByRole('radio', { name: 'Light' }).click()
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await shot('settings')

  await app.close()
})
