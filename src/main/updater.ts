import { app, net, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '../shared/api'
import type { Db } from './db'
import { getSetting } from './services/settings'

/*
 * Updates from GitHub Releases. Checks the latest release; if it's newer, downloads the installer, checks it
 * against the SHA-256 GitHub publishes for the file, then runs it silently and quits. The installer replaces
 * the app and starts it again (electron-builder's NSIS flags: --updated /S --force-run). Data isn't touched.
 *
 * Two channels: stable releases (1.0.0, 1.1.0, 2.0.0…) for everyone, and betas (2.0.0-beta.1…, published as GitHub
 * pre-releases) for those who tick "Get beta updates" (setting betaUpdates, per PC). A beta user still gets the
 * stable release once it's out, since 2.0.0 is newer than any 2.0.0 beta.
 */

const RELEASES_URL = process.env.PLANNR_UPDATE_URL ?? 'https://api.github.com/repos/GLr-P/plannr/releases/latest'
/** Every release, betas included (newest first), for the beta channel */
const ALL_RELEASES_URL = process.env.PLANNR_UPDATE_LIST_URL ?? 'https://api.github.com/repos/GLr-P/plannr/releases?per_page=30'

/**
 * Compares versions the semver way: "1.2.10" > "1.2.9", "2.0.0" > "2.0.0-beta.3" > "2.0.0-beta.2" > "1.1.0".
 * A leading "v" is ignored. Returns > 0 when a is newer.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): { core: number[]; pre: string[] } => {
    const [core, ...pre] = v.trim().replace(/^v/i, '').split('-')
    return { core: core.split('.').map((n) => Number(n) || 0), pre: pre.join('-') ? pre.join('-').split('.') : [] }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (d) return d
  }
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? 0 : 1) - (y.pre.length ? 0 : 1) // a release beats its betas
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

/** True when version a is newer than b */
export const newerThan = (a: string, b: string): boolean => compareVersions(a, b) > 0

export interface Release {
  tag_name: string
  draft?: boolean
  prerelease?: boolean
  html_url: string
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[]
}

export class Updater {
  private release: Release | null = null
  private db: Db | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  status: UpdateStatus

  constructor(
    private getWindow: () => BrowserWindow | null,
    private quit: () => void,
    /** Tests: download and verify, then write this file instead of running the installer */
    private testOut?: string
  ) {
    this.status = {
      state: 'idle',
      // PLANNR_UPDATE_PRETEND_VERSION makes this copy look older, to try a real update by reinstalling the latest.
      current: process.env.PLANNR_UPDATE_PRETEND_VERSION ?? app.getVersion(),
      latest: null,
      notesUrl: null,
      progress: 0,
      error: null,
      canInstall: app.isPackaged || Boolean(testOut),
      checkedAt: null
    }
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.getWindow()?.webContents.send('update-status', this.status)
  }

  /** Checks shortly after start and every 6 hours, unless turned off in Settings. */
  start(db: Db): void {
    this.db = db
    this.cleanDownloads()
    const auto = (): void => {
      if (getSetting(db, 'autoUpdateCheck') === false || this.busy()) return
      void this.check().catch(() => undefined)
    }
    setTimeout(auto, 15_000)
    this.timer = setInterval(auto, 6 * 60 * 60 * 1000)
  }

  /** Installers downloaded for earlier updates aren't needed once Plannr is running again. */
  private cleanDownloads(): void {
    try {
      const temp = app.getPath('temp')
      for (const f of readdirSync(temp)) if (/^Plannr-Setup-.*\.exe$/i.test(f)) rmSync(join(temp, f), { force: true })
    } catch {
      // temp folder unreadable: nothing to tidy
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private busy(): boolean {
    return this.status.state === 'checking' || this.status.state === 'downloading' || this.status.state === 'installing'
  }

  async check(): Promise<UpdateStatus> {
    if (this.busy()) return this.status
    this.set({ state: 'checking', error: null })
    try {
      const beta = this.db ? getSetting(this.db, 'betaUpdates') === true : false
      const res = await net.fetch(beta ? ALL_RELEASES_URL : RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(res.status === 404 ? 'No releases published yet' : `GitHub answered ${res.status}`)
      const body = (await res.json()) as Release | Release[]
      // Beta channel: the newest release of any kind that has an installer; otherwise the latest stable one
      const release = Array.isArray(body) ? pickNewest(body) : body
      if (!release) throw new Error('No releases published yet')
      this.release = release
      const latest = release.tag_name.replace(/^v/i, '')
      const available = newerThan(latest, this.status.current) && Boolean(this.installerAsset())
      this.set({ state: available ? 'available' : 'up-to-date', latest, notesUrl: release.html_url, checkedAt: Date.now() })
    } catch (err) {
      this.set({ state: 'error', error: friendly(err), checkedAt: Date.now() })
    }
    return this.status
  }

  private installerAsset(): Release['assets'][number] | undefined {
    return this.release?.assets.find((a) => /^Plannr-Setup-.*\.exe$/i.test(a.name))
  }

  /** Downloads and verifies the installer, then installs it and restarts Plannr. */
  async install(): Promise<UpdateStatus> {
    if (this.status.state !== 'available' && this.status.state !== 'error') return this.status
    const asset = this.installerAsset()
    if (!asset || !this.status.canInstall) return this.status
    const file = join(app.getPath('temp'), asset.name)
    this.set({ state: 'downloading', progress: 0, error: null })
    try {
      const res = await net.fetch(asset.browser_download_url)
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      const total = Number(res.headers.get('content-length')) || asset.size || 0
      const hash = createHash('sha256')
      const out = createWriteStream(file)
      const reader = res.body.getReader()
      let received = 0
      let shown = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        received += value.byteLength
        const progress = total ? received / total : 0
        if (progress - shown >= 0.02) {
          shown = progress
          this.set({ progress })
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
      // Only run what GitHub says it published.
      const expected = asset.digest?.replace(/^sha256:/i, '').toLowerCase()
      const actual = hash.digest('hex')
      if (expected ? expected !== actual : asset.size && received !== asset.size) {
        rmSync(file, { force: true })
        throw new Error('The download didn’t match the published file, so it wasn’t installed. Try again.')
      }
      this.set({ state: 'installing', progress: 1 })
      if (this.testOut) {
        writeFileSync(this.testOut, JSON.stringify({ file, sha256: actual }))
        return this.status
      }
      // The installer starts Plannr again afterwards; don't pass on the test-only "pretend to be older" setting.
      const env = { ...process.env }
      delete env.PLANNR_UPDATE_PRETEND_VERSION
      const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', env })
      // Only quit once the installer is really running: Windows (e.g. Smart App Control) can refuse to start it.
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve())
        child.once('error', (err) =>
          reject(new Error(`Windows didn’t let the installer run (${err.message}). Download the new version from the website instead.`))
        )
      })
      child.unref()
      setTimeout(() => this.quit(), 800) // let the installer start, then get out of its way
    } catch (err) {
      this.set({ state: 'error', error: friendly(err) })
    }
    return this.status
  }
}

const friendly = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err)
  return /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_CONNECTION/i.test(msg) ? 'No internet connection' : msg
}

/** The newest published release with an installer (betas included), from GitHub's release list */
export function pickNewest(list: Release[]): Release | null {
  const usable = list.filter((r) => !r.draft && r.assets.some((a) => /^Plannr-Setup-.*\.exe$/i.test(a.name)))
  return usable.reduce<Release | null>((best, r) => (!best || newerThan(r.tag_name, best.tag_name) ? r : best), null)
}
