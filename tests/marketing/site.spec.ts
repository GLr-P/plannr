import { test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, root } from '../e2e/helpers'

// Preview of the website (docs/index.html) as a full-page screenshot: test-results/site.png
test('website preview', async () => {
  const { app } = await launch(mkdtempSync(join(tmpdir(), 'plannr-site-')))
  const opened = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, file) => {
    const w = new BrowserWindow({ width: 1280, height: 900, show: false })
    void w.loadFile(file)
  }, join(root, 'docs', 'index.html'))
  const site = await opened
  await site.waitForLoadState('load')
  await site.screenshot({ path: join(root, 'test-results', 'site.png'), fullPage: true })
  await app.close()
})
