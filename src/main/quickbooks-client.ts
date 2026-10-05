import { BrowserWindow, net } from 'electron'
import { randomBytes } from 'node:crypto'
import type { Db } from './db'
import { getSecret, putSecret } from './secrets'
import { getSetting, setSetting } from './services/settings'
import { QboError, type QboApi, type QboEntity } from './services/quickbooks'

/*
 * QuickBooks Online connection. Intuit requires HTTPS redirect URIs for production apps, so sign-in runs in a
 * Plannr window: the redirect goes to Intuit's own OAuth Playground URL, and Plannr reads the code from that
 * navigation before the page loads. Keys and the rotating refresh token are stored encrypted (secrets.ts).
 */

export const QBO_REDIRECT = 'https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl'
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const MINOR = '75'

interface QboClient {
  clientId: string
  clientSecret: string
}

interface QboTokens {
  refreshToken: string
  accessToken: string
  expiresAt: number
  realmId: string
}

export const qboConfigured = (db: Db): boolean => getSecret<QboClient>(db, 'qbo.client') !== null
export const qboConnected = (db: Db): boolean => getSecret<QboTokens>(db, 'qbo.tokens') !== null

export function configureKey(db: Db, input: { clientId: string; clientSecret: string }): void {
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()
  if (clientId.length < 20 || /\s/.test(clientId)) throw new Error('That doesn’t look like a QuickBooks Client ID.')
  if (clientSecret.length < 20 || /\s/.test(clientSecret)) throw new Error('That doesn’t look like a QuickBooks Client Secret.')
  putSecret(db, 'qbo.client', { clientId, clientSecret } satisfies QboClient)
}

const basic = (c: QboClient): string => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`

async function tokenRequest(client: QboClient, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await net.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basic(client), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new QboError(String(json.error ?? res.status), String(json.error_description ?? json.error ?? `HTTP ${res.status}`))
  return json
}

/** Opens Intuit sign-in in a Plannr window; resolves once the company is connected. */
export async function connect(db: Db, parent: BrowserWindow | null): Promise<void> {
  const client = getSecret<QboClient>(db, 'qbo.client')
  if (!client) throw new Error('Enter the QuickBooks Client ID and Secret first')
  const state = randomBytes(16).toString('hex')
  const authUrl = `${AUTH_URL}?${new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: QBO_REDIRECT,
    state
  })}`

  const { code, realmId } = await new Promise<{ code: string; realmId: string }>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent ?? undefined,
      modal: false,
      title: 'Connect QuickBooks',
      autoHideMenuBar: true,
      webPreferences: { partition: 'qbo-signin', sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    let done = false
    const finish = (url: string, event?: Electron.Event): boolean => {
      if (!url.startsWith(QBO_REDIRECT)) return false
      event?.preventDefault()
      const params = new URL(url).searchParams
      done = true
      win.destroy()
      if (params.get('state') !== state) reject(new Error('QuickBooks sign-in failed (state mismatch)'))
      else if (params.get('error')) reject(new Error(params.get('error') === 'access_denied' ? 'Sign-in was cancelled' : `QuickBooks: ${params.get('error')}`))
      else if (!params.get('code') || !params.get('realmId')) reject(new Error('QuickBooks didn’t return a company'))
      else resolve({ code: params.get('code')!, realmId: params.get('realmId')! })
      return true
    }
    win.webContents.on('will-redirect', (e, url) => finish(url, e))
    win.webContents.on('will-navigate', (e, url) => finish(url, e))
    win.webContents.on('did-navigate', (_e, url) => finish(url))
    win.on('closed', () => {
      if (!done) reject(new Error('Sign-in window was closed'))
    })
    void win.loadURL(authUrl)
  })

  const token = await tokenRequest(client, { grant_type: 'authorization_code', code, redirect_uri: QBO_REDIRECT })
  putSecret(db, 'qbo.tokens', {
    refreshToken: String(token.refresh_token),
    accessToken: String(token.access_token),
    expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    realmId
  } satisfies QboTokens)
  const info = await qboApi(db).query<{ CompanyName?: string }>('select * from CompanyInfo')
  setSetting(db, 'qbo.companyName', info[0]?.CompanyName ?? null)
}

export async function disconnect(db: Db): Promise<void> {
  const tokens = getSecret<QboTokens>(db, 'qbo.tokens')
  const client = getSecret<QboClient>(db, 'qbo.client')
  if (tokens && client) {
    await net
      .fetch(REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: basic(client), Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokens.refreshToken })
      })
      .catch(() => undefined)
  }
  putSecret(db, 'qbo.tokens', null)
}

async function session(db: Db): Promise<QboTokens> {
  const tokens = getSecret<QboTokens>(db, 'qbo.tokens')
  const client = getSecret<QboClient>(db, 'qbo.client')
  if (!tokens || !client) throw new Error('QuickBooks isn’t connected')
  if (Date.now() < tokens.expiresAt - 60_000) return tokens
  try {
    // Intuit rotates the refresh token: always keep the newest one.
    const t = await tokenRequest(client, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
    const next: QboTokens = {
      ...tokens,
      accessToken: String(t.access_token),
      refreshToken: String(t.refresh_token ?? tokens.refreshToken),
      expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000
    }
    putSecret(db, 'qbo.tokens', next)
    return next
  } catch (err) {
    if (err instanceof QboError && err.code === 'invalid_grant') {
      putSecret(db, 'qbo.tokens', null)
      throw new Error('QuickBooks sign-in expired. Click Connect in Settings to sign in again.')
    }
    throw err
  }
}

interface Fault {
  Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] }
}

export function qboApi(db: Db): QboApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const s = await session(db)
    const sep = path.includes('?') ? '&' : '?'
    const res = await net.fetch(`${API_BASE}/${encodeURIComponent(s.realmId)}${path}${sep}minorversion=${MINOR}`, {
      method,
      headers: { Authorization: `Bearer ${s.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = (await res.json().catch(() => ({}))) as T & Fault
    const fault = json.Fault?.Error?.[0]
    if (!res.ok || fault) throw new QboError(fault?.code ?? String(res.status), fault ? [fault.Message, fault.Detail].filter(Boolean).join(': ') : `QuickBooks error ${res.status}`)
    return json
  }
  const strip = (body: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
  return {
    query: async <T = QboEntity>(sql: string): Promise<T[]> => {
      const r = await call<{ QueryResponse?: Record<string, unknown> }>('GET', `/query?query=${encodeURIComponent(sql)}`)
      const entity = /from\s+(\w+)/i.exec(sql)?.[1] ?? ''
      const key = Object.keys(r.QueryResponse ?? {}).find((k) => k.toLowerCase() === entity.toLowerCase())
      return (key ? (r.QueryResponse![key] as T[]) : []) ?? []
    },
    create: async (entity, body) => (await call<Record<string, QboEntity>>('POST', `/${entity.toLowerCase()}`, strip(body)))[entity],
    update: async (entity, body) => (await call<Record<string, QboEntity>>('POST', `/${entity.toLowerCase()}`, strip(body)))[entity],
    remove: async (entity, id, syncToken) => {
      await call('POST', `/${entity.toLowerCase()}?operation=delete`, { Id: id, SyncToken: syncToken })
    }
  }
}

export const companyName = (db: Db): string | null => (getSetting(db, 'qbo.companyName') as string | null) ?? null
