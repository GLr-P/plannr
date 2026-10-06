import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Tasks: your own to-dos, plus the checkboxes inside notes; on the calendar and Home.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-tasks-'))
let app: ElectronApplication
let page: Page
const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()

test.beforeAll(async () => {
  ;({ app, page } = await launch(dataDir))
  await page.evaluate(async () => {
    const n = await window.plannr.notes.create({ title: 'Shop chores' })
    await window.plannr.notes.update(n.id, {
      content: { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Buy label tape' }] }] }] }] }
    })
  })
})
test.afterAll(async () => {
  await app?.close()
})

test('add tasks for today and with no date; tick one done; note checkboxes show up and can be ticked', async () => {
  await nav('Tasks').click()
  await expect(page.getByLabel('New task')).toBeFocused()
  await page.keyboard.type('Order iPhone screens')
  await page.locator('.task-quick-dates').getByRole('button', { name: 'Today' }).click()
  await page.keyboard.press('Enter')
  await expect(page.locator('.task-group-today .task-title')).toHaveValue('Order iPhone screens')
  await page.getByLabel('New task').fill('Call the landlord')
  await page.getByLabel('New task').press('Enter')
  await expect(page.locator('.task-group-none .task-title')).toHaveValue('Call the landlord')
  await expect(nav('Tasks').locator('.nav-count')).toHaveText('1') // due today

  const fromNotes = page.locator('.checklist-source', { hasText: 'Shop chores' })
  await expect(fromNotes).toContainText('Buy label tape')
  await shot(page, 'k1-tasks')
  await fromNotes.getByRole('checkbox', { name: 'Buy label tape' }).click()
  await expect(page.locator('.checklist-source')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Done: Call the landlord' }).click()
  await expect(page.locator('.task-group-none')).toHaveCount(0)
  await page.getByRole('button', { name: 'Completed' }).click()
  await expect(page.locator('.task-row.done .task-title')).toHaveValue('Call the landlord')
})

test('a task with a due date is on the calendar and on Home', async () => {
  await nav('Calendar').click()
  await expect(page.locator('.fc .ev-task')).toContainText('Order iPhone screens')
  await nav('Home').click()
  const section = page.locator('.home section', { hasText: 'Tasks due' })
  await expect(section).toContainText('Order iPhone screens')
  await section.getByRole('checkbox', { name: 'Done: Order iPhone screens' }).click()
  await expect(page.locator('.home section', { hasText: 'Tasks due' })).toHaveCount(0)
  await expect(nav('Tasks').locator('.nav-count')).toHaveCount(0)
})
