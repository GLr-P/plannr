import { app, BrowserWindow, dialog, net, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Db } from './db'
import { getSetting, setSetting } from './services/settings'
import { GoogleHttpError, type GCalendar, type GEvent, type GoogleApi } from './services/google'

/*
 * Google sign-in for a desktop app: OAuth 2.0 with PKCE and a loopback redirect (Google's recommended flow).
 * The browser shows Google's own sign-in page; Plannr never sees the password. The resulting tokens and the
 * app's client key are stored encrypted with Windows (safeStorage / DPAPI), tied to this Windows account.
 */

const SCOPES = ['https://www.googleapis.com/auth/calendar', 'openid', 'email']
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://www.googleapis.com/calendar/v3'

interface ClientKey {
  clientId: string
  clientSecret: string
}

interface Tokens {
  refreshToken: string
  accessToken: string
  expiresAt: number
  email: string | null
}

// ---------- Encrypted settings ----------

function putSecret(db: Db, key: string, value: unknown): void {
  if (value === null) return setSetting(db, key, null)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available on this account')
  setSetting(db, key, safeStorage.encryptString(JSON.stringify(value)).toString('base64'))
}

function getSecret<T>(db: Db, key: string): T | null {
  const v = getSetting(db, key)
  if (typeof v !== 'string') return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(v, 'base64'))) as T
  } catch {
    return null // e.g. data copied from another Windows account
  }
}

export const isConfigured = (db: Db): boolean => getSecret<ClientKey>(db, 'google.client') !== null
export const connectedEmail = (db: Db): string | null => getSecret<Tokens>(db, 'google.tokens')?.email ?? null
export const isConnected = (db: Db): boolean => getSecret<Tokens>(db, 'google.tokens') !== null

/** Reads Google's "Desktop app" client JSON ({ installed: { client_id, client_secret } }). */
export function parseClientFile(text: string): ClientKey {
  const json = JSON.parse(text) as { installed?: { client_id?: string; client_secret?: string }; web?: unknown }
  if (json.web) throw new Error('That key is for a "Web application". Create one with Application type "Desktop app".')
  const id = json.installed?.client_id
  const secret = json.installed?.client_secret
  if (!id || !secret) throw new Error('This doesn’t look like a Google client key file (client_secret_….json).')
  return { clientId: id, clientSecret: secret }
}

export async function importClientFile(db: Db, win: BrowserWindow | null): Promise<void> {
  const options = {
    title: 'Choose the Google key file you downloaded (client_secret_….json)',
    defaultPath: app.getPath('downloads'),
    filters: [{ name: 'Google key file', extensions: ['json'] }],
    properties: ['openFile'] as 'openFile'[]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return
  putSecret(db, 'google.client', parseClientFile(readFileSync(result.filePaths[0], 'utf8')))
}

// ---------- Sign-in ----------

const b64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new GoogleHttpError(res.status, String(json.error_description ?? json.error ?? `HTTP ${res.status}`))
  return json
}

const emailFromIdToken = (idToken: unknown): string | null => {
  if (typeof idToken !== 'string') return null
  try {
    return (JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')) as { email?: string }).email ?? null
  } catch {
    return null
  }
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Plannr</title><body style="font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#222"><div style="text-align:center"><h2>${title}</h2><p>${text}</p></div></body>`

/** Opens Google sign-in in the default browser and waits (up to 5 minutes) for the user to finish. */
export async function connect(db: Db): Promise<void> {
  const client = getSecret<ClientKey>(db, 'google.client')
  if (!client) throw new Error('Import the Google key file first')
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirectUri = ''
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ok ? PAGE('Connected to Plannr', 'You can close this tab and go back to Plannr.') : PAGE('Not connected', 'Go back to Plannr and try again.'))
      server.close()
      clearTimeout(timer)
      if (ok) resolve({ code: url.searchParams.get('code')!, redirectUri })
      else reject(new Error(error === 'access_denied' ? 'Sign-in was cancelled' : 'Google sign-in failed'))
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out'))
    }, 5 * 60_000)
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent' // always returns a refresh token
      })
      void shell.openExternal(`${AUTH_URL}?${params}`)
    })
  })

  const token = await postForm(TOKEN_URL, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
  if (typeof token.refresh_token !== 'string') throw new Error('Google didn’t return a refresh token; try connecting again')
  putSecret(db, 'google.tokens', {
    refreshToken: token.refresh_token,
    accessToken: String(token.access_token),
    expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    email: emailFromIdToken(token.id_token)
  } satisfies Tokens)
}

export async function disconnect(db: Db): Promise<void> {
  const tokens = getSecret<Tokens>(db, 'google.tokens')
  if (tokens) await net.fetch(`${REVOKE_URL}?token=${encodeURIComponent(tokens.refreshToken)}`, { method: 'POST' }).catch(() => undefined)
  putSecret(db, 'google.tokens', null)
}

async function accessToken(db: Db): Promise<string> {
  const tokens = getSecret<Tokens>(db, 'google.tokens')
  const client = getSecret<ClientKey>(db, 'google.client')
  if (!tokens || !client) throw new Error('Not connected to Google')
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken
  try {
    const t = await postForm(TOKEN_URL, { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: tokens.refreshToken, grant_type: 'refresh_token' })
    const next = { ...tokens, accessToken: String(t.access_token), expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000 }
    putSecret(db, 'google.tokens', next)
    return next.accessToken
  } catch (err) {
    if (err instanceof GoogleHttpError && err.status === 400) {
      putSecret(db, 'google.tokens', null) // access was revoked or expired: needs a new sign-in
      throw new Error('Google sign-in expired. Click Connect to sign in again.')
    }
    throw err
  }
}

// ---------- Calendar API ----------

export function googleApi(db: Db): GoogleApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await net.fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken(db)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (res.status === 204) return undefined as T
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (!res.ok) throw new GoogleHttpError(res.status, json.error?.message ?? `Google Calendar error ${res.status}`)
    return json as T
  }
  const enc = encodeURIComponent

  return {
    listCalendars: async () => {
      const out: GCalendar[] = []
      let pageToken = ''
      do {
        const r = await call<{ items?: GCalendar[]; nextPageToken?: string }>('GET', `/users/me/calendarList?maxResults=250${pageToken ? `&pageToken=${enc(pageToken)}` : ''}`)
        out.push(...(r.items ?? []))
        pageToken = r.nextPageToken ?? ''
      } while (pageToken)
      return out
    },
    createCalendar: (summary, timeZone) => call<GCalendar>('POST', '/calendars', { summary, timeZone }),
    listEvents: async (calendarId, params) => {
      const out: GEvent[] = []
      let pageToken = ''
      do {
        const qs = new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) })
        const r = await call<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${enc(calendarId)}/events?${qs}`)
        out.push(...(r.items ?? []))
        pageToken = r.nextPageToken ?? ''
      } while (pageToken)
      return out
    },
    insertEvent: (calendarId, body) => call<GEvent>('POST', `/calendars/${enc(calendarId)}/events`, body),
    patchEvent: (calendarId, eventId, body) => call<GEvent>('PATCH', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, body),
    deleteEvent: (calendarId, eventId) => call<void>('DELETE', `/calendars/${enc(calendarId)}/events/${enc(eventId)}`)
  }
}
