import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'node:path'

/*
 * Manual: the real update path on this PC. Opens the INSTALLED Plannr pretending to be 0.9.0, so the latest
 * GitHub release looks newer, then clicks Install and restart. Uses your real data folder (nothing is edited).
 * Run: REAL_UPDATE=1 npx playwright test --config tests/manual/playwright.config.ts
 */
test('installed Plannr updates itself from GitHub', async () => {
  test.skip(!process.env.REAL_UPDATE)
  test.setTimeout(10 * 60_000)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  env.PLANNR_UPDATE_PRETEND_VERSION = '0.9.0'
  const app = await electron.launch({ executablePath: join(process.env.LOCALAPPDATA!, 'Programs', 'Plannr', 'Plannr.exe'), args: [], env })
  const page = await app.firstWindow()
  await page.waitForSelector('.sidebar')
  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  const updates = page.locator('.update-setting')
  await updates.getByRole('button', { name: 'Check for updates' }).click()
  await expect(updates).toContainText(/Version [\d.]+ is available/, { timeout: 30_000 })
  await page.screenshot({ path: join('test-results', 'real-update-available.png') })
  const closed = app.waitForEvent('close', { timeout: 5 * 60_000 })
  await updates.getByRole('button', { name: 'Install and restart' }).click()
  await expect(updates).toContainText(/Downloading|Installing/, { timeout: 30_000 })
  await closed // Plannr quits so the installer can replace it, then the installer opens it again
})
