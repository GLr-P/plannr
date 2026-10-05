import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { launch, makePdf, makePng, root } from './helpers'

// Overlays that cover the title bar must stay clickable: the title bar is a Windows "drag the window" strip,
// and Playwright's synthetic clicks skip Windows' hit-testing, so only a real mouse click catches regressions.
// It moves the real mouse, so it only runs with PLANNR_SLOW=1.
test.skip(!process.env.PLANNR_SLOW, 'set PLANNR_SLOW=1 to run (moves the real mouse)')

async function realClick(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const { bounds, scale } = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true)
    w.focus()
    const b = w.getContentBounds()
    return { bounds: b, scale: screen.getDisplayMatching(b).scaleFactor }
  })
  const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!
  const x = Math.round((bounds.x + box.x + box.width / 2) * scale)
  const y = Math.round((bounds.y + box.y + box.height / 2) * scale)
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'real-click.ps1'), '-X', String(x), '-Y', String(y)])
  await page.waitForTimeout(600)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false))
}

test('a real mouse click closes the vault file preview and the ticket photo viewer', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'plannr-click-'))
  const { app, page } = await launch(dataDir)

  // Vault PDF preview
  await page.evaluate(async () => {
    await window.plannr.vault.setup('blue-horse-42')
    const item = await window.plannr.vault.create('note')
    await window.plannr.vault.update(item.id, { title: 'Docs' })
  })
  writeFileSync(join(dataDir, 'policy.pdf'), makePdf('HELLO'))
  await page.locator('.sidebar .nav-item', { hasText: 'Vault' }).click()
  await page.locator('.vault-row', { hasText: 'Docs' }).click()
  let chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files' }).click()
  await (await chooser).setFiles(join(dataDir, 'policy.pdf'))
  await page.locator('.vault-file-main').click()
  await expect(page.locator('.file-preview iframe')).toBeVisible()
  await page.waitForTimeout(800)
  await realClick(app, page, 'Close preview')
  await expect(page.locator('.file-preview')).toHaveCount(0)

  // Ticket photo viewer
  writeFileSync(join(dataDir, 'before.png'), makePng(300, 200))
  await page.locator('.sidebar .nav-item', { hasText: 'Tickets' }).first().click()
  await page.locator('.main').getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.locator('.photos-header').click()
  chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add before photos' }).click()
  await (await chooser).setFiles(join(dataDir, 'before.png'))
  await page.locator('.thumb-open').first().click()
  await expect(page.locator('.lightbox')).toBeVisible()
  await realClick(app, page, 'Close')
  await expect(page.locator('.lightbox')).toHaveCount(0)
  await app.close()
})
