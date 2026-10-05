import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, makePdf, makePng, shot } from './helpers'

// Smoke test of the packaged app (what the installer installs). Run with:
//   PLANNR_EXE=release/win-unpacked/Plannr.exe npx playwright test packaged
test.skip(!process.env.PLANNR_EXE, 'set PLANNR_EXE to a packaged Plannr.exe')

test('packaged app: database, files, vault, calendar, money and backups all work', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'plannr-packaged-'))
  const { app, page } = await launch(dataDir)
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)

  // Database + search + starter template
  await page.evaluate(() => window.plannr.notes.create({ title: 'Packaged note' }))
  expect((await page.evaluate(() => window.plannr.search.query('packaged'))).length).toBe(1)
  expect((await page.evaluate(() => window.plannr.templates.list())).map((t) => t.name)).toEqual(['Repair intake'])

  // plannr:// file protocol
  const b64 = makePng(120, 80).toString('base64')
  const url = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    return (await window.plannr.files.save({ name: 'p.png', mime: 'image/png', data: bytes })).url
  }, b64)
  expect(await app.evaluate(async ({ net }, u) => (await net.fetch(u)).status, url)).toBe(200)

  // Vault + encrypted file via plannr-vault://
  const pdfPath = join(dataDir, 'doc.pdf')
  writeFileSync(pdfPath, makePdf('PACKAGED'))
  const vaultUrl = await page.evaluate(async () => {
    await window.plannr.vault.setup('blue-horse-42')
    const item = await window.plannr.vault.create('note')
    const data = new TextEncoder().encode('%PDF-1.4 test')
    return (await window.plannr.vault.addFile(item.id, { name: 'a.pdf', mime: 'application/pdf', data })).url
  })
  expect(await app.evaluate(async ({ net }, u) => (await net.fetch(u)).status, vaultUrl)).toBe(200)

  // Calendar, money, backups
  await page.locator('.sidebar .nav-item', { hasText: 'Calendar' }).click()
  await expect(page.locator('.fc-daygrid-day').first()).toBeVisible()
  await page.locator('.sidebar .nav-item', { hasText: 'Money' }).click()
  await expect(page.locator('.stat', { hasText: 'Income' })).toBeVisible()
  const backup = await page.evaluate(() => window.plannr.backup.runNow())
  expect(backup.error).toBeNull()
  expect(backup.backups).toHaveLength(1)

  // Icons/resources are found in the installed layout
  const iconOk = await app.evaluate(({ app, nativeImage }) => {
    const path = `${process.resourcesPath}/resources/icon.png`
    return !nativeImage.createFromPath(path).isEmpty() && app.isPackaged
  })
  expect(iconOk).toBe(true)
  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).click()
  await shot(page, 'p1-packaged-home')
  await app.close()
})
