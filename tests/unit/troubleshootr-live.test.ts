import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from '../../src/main/db'
import * as tickets from '../../src/main/services/tickets'
import { collectReports, connectTroubleshootr, type DropDeps } from '../../src/main/services/troubleshootr'
import type { DropKeys } from '../../src/shared/drop-crypto'
import { deriveSyncKeys, newSyncKey, sha256Hex } from '../../src/shared/sync-crypto'

/*
 * Manual end-to-end check against a real sync service (`wrangler dev --local`), with Troubleshootr's CLI sending in
 * between. Skipped unless PLANNR_LIVE_WORKER is set:
 *   PLANNR_LIVE_WORKER=http://127.0.0.1:8787 PLANNR_LIVE_DIR=<dir> PLANNR_LIVE_STEP=connect  → writes <dir>/link.txt
 *   troubleshootr-cli send --link <link> --customer "Jane Doe" --snapshot ...
 *   PLANNR_LIVE_STEP=collect                                                                → imports and checks
 */
const server = process.env.PLANNR_LIVE_WORKER
const dir = process.env.PLANNR_LIVE_DIR ?? ''

async function deps(): Promise<DropDeps> {
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'state.json')
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as { syncKey: string; keys: DropKeys | null }) : { syncKey: newSyncKey(), keys: null }
  const sync = await deriveSyncKeys(state.syncKey)
  if (!existsSync(statePath))
    await fetch(`${server}/api/spaces`, { method: 'POST', body: JSON.stringify({ space: sync.space, authHash: await sha256Hex(sync.token), ownerSecret: 'local-test' }) })
  const save = (): void => writeFileSync(statePath, JSON.stringify(state))
  save()
  const db = new DatabaseSync(join(dir, 'plannr.db'))
  migrate(db)
  return {
    db,
    dataDir: dir,
    credentials: async () => ({ server: server!, space: sync.space, token: sync.token, fetch: (url, init) => fetch(url, init) }),
    deviceName: 'LIVE-TEST',
    getKeys: () => state.keys,
    putKeys: (k) => {
      state.keys = k
      save()
    }
  }
}

describe.skipIf(!server)('Troubleshootr inbox against a real sync service', () => {
  it('runs the step', async () => {
    const d = await deps()
    if (process.env.PLANNR_LIVE_STEP === 'connect') {
      const open = tickets.createTicket(d.db, {})
      tickets.updateTicket(d.db, open.id, { device: 'Bench PC' })
      writeFileSync(join(dir, 'link.txt'), await connectTroubleshootr(d))
      return
    }
    const { imported, errors } = await collectReports(d)
    writeFileSync(join(dir, 'collected.json'), JSON.stringify({ imported, errors }, null, 2))
    expect(errors).toEqual([])
    expect(imported.length).toBeGreaterThan(0)
  })
})
