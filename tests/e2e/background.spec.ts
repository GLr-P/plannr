import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { root } from './helpers'

// Slow (waits a minute for the scheduler) and shows a real notification: run with PLANNR_SLOW=1.
test('real Windows notification, close-to-tray, and the reminder scheduler', async () => {
  test.skip(!process.env.PLANNR_SLOW, 'set PLANNR_SLOW=1 to run')
  test.setTimeout(150_000)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  const dataDir = mkdtempSync(join(tmpdir(), 'plannr-notify-'))
  env.PLANNR_DATA_DIR = dataDir
  env.PLANNR_BACKGROUND = '1'
  const app = await electron.launch({ args: [root], env })
  const page = await app.firstWindow()
  await page.waitForSelector('.sidebar')

  const direct = await app.evaluate(async ({ Notification }) => {
    return await new Promise<string>((resolve) => {
      const n = new Notification({ title: 'Plannr test', body: 'Direct notification check' })
      n.on('show', () => resolve('show'))
      n.on('failed', (_e, err) => resolve('failed: ' + err))
      n.show()
      setTimeout(() => resolve('timeout'), 8000)
    })
  })

  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.evaluate(async (date) => {
    const c = await window.plannr.customers.create({ name: 'Jane Doe' })
    const t = await window.plannr.tickets.create({ customerId: c.id, templateId: null })
    await window.plannr.tickets.update(t.id, { device: 'iPhone 13', pickupOn: date })
  }, today)

  const afterClose = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.close()
    return w.isDestroyed() ? 'destroyed' : w.isVisible() ? 'visible' : 'hidden'
  })

  await new Promise((r) => setTimeout(r, 62_000)) // the scheduler checks every minute
  const db = new DatabaseSync(join(dataDir, 'plannr.db'), { readOnly: true })
  const fired = db.prepare('SELECT reminder_key FROM reminder_log').all()
  db.close()

  expect(direct).toBe('show')
  expect(afterClose).toBe('hidden')
  expect(fired.length).toBeGreaterThan(0)
  await app.close()
})
