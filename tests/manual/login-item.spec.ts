import { test, _electron as electron } from '@playwright/test'
import { join } from 'node:path'

// Manual diagnostic: what the installed app sees for "Start with Windows".
test('login item', async () => {
  test.skip(!process.env.REAL_UPDATE)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  const app = await electron.launch({ executablePath: join(process.env.LOCALAPPDATA!, 'Programs', 'Plannr', 'Plannr.exe'), args: [], env })
  await app.firstWindow()
  console.log(JSON.stringify(await app.evaluate(({ app }) => ({ exec: process.execPath, packaged: app.isPackaged, s: app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }) })), null, 1))
  await app.close()
})
