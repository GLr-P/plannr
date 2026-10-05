import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, shot } from './helpers'

// Updates: a local stand-in for GitHub's "latest release" API serves a newer version and its installer.
test.describe.configure({ mode: 'serial' })

const dataDir = mkdtempSync(join(tmpdir(), 'plannr-e2e-updates-'))
const installer = randomBytes(300_000) // pretend installer
const sha256 = createHash('sha256').update(installer).digest('hex')
let server: Server
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (req.url === '/latest') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          tag_name: 'v99.0.0',
          html_url: `${base}/notes`,
          assets: [{ name: 'Plannr-Setup-99.0.0.exe', browser_download_url: `${base}/setup.exe`, size: installer.length, digest: `sha256:${sha256}` }]
        })
      )
    } else if (req.url === '/setup.exe') {
      res.setHeader('Content-Length', String(installer.length))
      res.end(installer)
    } else res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  ;({ app, page } = await launch(dataDir, { PLANNR_UPDATE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest` }))
})
test.afterAll(async () => {
  await app?.close()
  server?.close()
})

test('check finds the new version; it downloads, matches the published fingerprint, and installs', async () => {
  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  const updates = page.locator('.update-setting')
  await expect(updates).toContainText('Plannr checks for new versions')
  await updates.getByRole('button', { name: 'Check for updates' }).click()
  await expect(updates).toContainText('Version 99.0.0 is available')
  await expect(page.locator('.update-pill')).toHaveText(/Update to 99\.0\.0/)
  await shot(page, 'u1-update-available')

  await updates.getByRole('button', { name: 'Install and restart' }).click()
  await expect(updates).toContainText('Installing')
  const marker = join(dataDir, 'update-ready.json')
  await expect.poll(() => existsSync(marker)).toBe(true)
  const ready = JSON.parse(readFileSync(marker, 'utf8')) as { file: string; sha256: string }
  expect(ready.sha256).toBe(sha256)
  expect(createHash('sha256').update(readFileSync(ready.file)).digest('hex')).toBe(sha256)
})
