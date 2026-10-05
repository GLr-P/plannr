import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

test('back up, lose a note for good, restore it from the backup', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-backup-'))
  let { app, page } = await launch(dataDir)
  const nav = (label: string) => page.locator('.sidebar .nav-item', { hasText: label }).first()

  await page.evaluate(() => window.plannr.notes.create({ title: 'Important customer list' }))
  await nav('Settings').click()
  await expect(page.locator('.backup-status')).toContainText('No backup yet')
  await page.getByRole('button', { name: 'Back up now' }).click()
  await expect(page.locator('.backup-status')).toHaveText('Last backup just now')
  await expect(page.locator('.backup-row')).toHaveCount(1)
  await expect(page.locator('.backup-setting .path')).toContainText(join(dataDir, 'backups'))
  await shot(page, 'k1-backups')

  // The note is deleted forever (trash, then delete permanently)
  await page.evaluate(async () => {
    const [n] = await window.plannr.notes.list()
    await window.plannr.notes.trash(n.id)
    await window.plannr.notes.destroy(n.id)
  })
  expect(await page.evaluate(async () => (await window.plannr.notes.list({ trashed: true })).length)).toBe(0)

  // Restore: first click arms, second click restores and restarts the app
  const restore = page.locator('.backup-row').first().locator('button')
  await restore.click()
  await expect(restore).toContainText('Click again')
  const closed = app.waitForEvent('close')
  await restore.click().catch(() => undefined) // the app exits during the click
  await closed

  ;({ app, page } = await launch(dataDir))
  await page.locator('.sidebar .nav-item', { hasText: 'Notes' }).first().click()
  await expect(page.locator('.note-row', { hasText: 'Important customer list' })).toBeVisible()
  // What was there before the restore was saved as a backup too, so the restore can be undone
  await page.locator('.sidebar .nav-item', { hasText: 'Settings' }).click()
  await expect(page.locator('.backup-row')).toHaveCount(2)
  await app.close()
})
