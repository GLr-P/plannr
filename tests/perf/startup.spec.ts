import { test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from '../e2e/helpers'

// Manual measurement (not part of the suite): PERF=1 npx playwright test tests/perf
test('startup time', async () => {
  test.skip(!process.env.PERF)
  const dir = mkdtempSync(join(tmpdir(), 'plannr-perf-'))
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now()
    const { app, page } = await launch(dir)
    const toSidebar = Date.now() - t0
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      return { domInteractive: Math.round(e.domInteractive), loadEnd: Math.round(e.loadEventEnd) }
    })
    console.log(`run ${i + 1}: launch→sidebar ${toSidebar} ms, renderer domInteractive ${nav.domInteractive} ms, load ${nav.loadEnd} ms`)
    await app.close()
  }
})
