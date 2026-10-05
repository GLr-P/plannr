import { net, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Db } from './db'
import { getSecret, putSecret } from './secrets'
import { setSetting } from './services/settings'
import {
  accountsServerFor,
  emailDocument,
  mailBaseFor,
  parseMessages,
  searchKeyFor,
  ZOHO_PORT,
  ZOHO_REDIRECT,
  ZOHO_SCOPES
} from './services/zoho'
import type { ZohoMessage, ZohoMessageContent, ZohoRegion, ZohoStatus } from '../shared/api'
import { getSetting } from './services/settings'

/*
 * Zoho Mail (read-only): OAuth 2.0 "server-based" client with a fixed localhost redirect, then the Mail API
 * to search messages by a customer's address and read a message. Keys and tokens are stored encrypted (secrets.ts).
 */

interface ZohoClient {
  region: ZohoRegion
  clientId: string
  clientSecret: string
}

interface ZohoTokens {
  refreshToken: string
  accessToken: string
  expiresAt: number
  accountsServer: string
  mailBase: string
  accountId: string
  email: string | null
}

export function zohoStatus(db: Db): ZohoStatus {
  const client = getSecret<ZohoClient>(db, 'zoho.client')
  const tokens = getSecret<ZohoTokens>(db, 'zoho.tokens')
  return {
    configured: client !== null,
    connected: tokens !== null,
    email: tokens?.email ?? null,
    region: client?.region ?? null,
    error: (getSetting(db, 'zoho.error') as string | null) ?? null
  }
}

export function configure(db: Db, input: { region: ZohoRegion; clientId: string; clientSecret: string }): void {
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()
  if (!/^1000\.[A-Z0-9]+$/i.test(clientId)) throw new Error('That doesn’t look like a Zoho Client ID (it starts with “1000.”).')
  if (clientSecret.length < 20) throw new Error('That doesn’t look like a Zoho Client Secret.')
  putSecret(db, 'zoho.client', { region: input.region, clientId, clientSecret } satisfies ZohoClient)
}

class ZohoError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function postToken(server: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await net.fetch(`${server}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  // Zoho reports some errors with HTTP 200 and an "error" field.
  if (!res.ok || json.error) throw new ZohoError(res.status, String(json.error ?? `HTTP ${res.status}`))
  return json
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Plannr</title><body style="font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#222"><div style="text-align:center"><h2>${title}</h2><p>${text}</p></div></body>`

/** Opens Zoho sign-in in the browser; the redirect comes back to localhost:53682. */
export async function connect(db: Db): Promise<void> {
  const client = getSecret<ZohoClient>(db, 'zoho.client')
  if (!client) throw new Error('Enter the Zoho Client ID and Secret first')
  const state = randomBytes(16).toString('hex')

  const { code, accountsServer } = await new Promise<{ code: string; accountsServer: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', ZOHO_REDIRECT)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const ok = code && url.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ok ? PAGE('Connected to Plannr', 'You can close this tab and go back to Plannr.') : PAGE('Not connected', 'Go back to Plannr and try again.'))
      server.close()
      clearTimeout(timer)
      if (ok) resolve({ code: code!, accountsServer: url.searchParams.get('accounts-server') ?? accountsServerFor(client.region) })
      else reject(new Error(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled' : 'Zoho sign-in failed'))
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out'))
    }, 5 * 60_000)
    server.on('error', (err: NodeJS.ErrnoException) =>
      reject(new Error(err.code === 'EADDRINUSE' ? `Port ${ZOHO_PORT} is busy; close other apps using it and try again` : err.message))
    )
    server.listen(ZOHO_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        scope: ZOHO_SCOPES.join(','),
        client_id: client.clientId,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        redirect_uri: ZOHO_REDIRECT,
        state
      })
      void shell.openExternal(`${accountsServerFor(client.region)}/oauth/v2/auth?${params}`)
    })
  })

  const token = await postToken(accountsServer, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: ZOHO_REDIRECT,
    grant_type: 'authorization_code'
  })
  if (typeof token.refresh_token !== 'string') throw new Error('Zoho didn’t return a refresh token; try connecting again')
  const mailBase = mailBaseFor(accountsServer)
  const accessToken = String(token.access_token)
  // Which mailbox: the account's primary mail account.
  const res = await net.fetch(`${mailBase}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } })
  const accounts = (await res.json().catch(() => ({}))) as { data?: { accountId?: string; primaryEmailAddress?: string; mailboxAddress?: string }[] }
  const account = accounts.data?.[0]
  if (!res.ok || !account?.accountId) throw new Error('Signed in, but couldn’t find a Zoho Mail account')
  putSecret(db, 'zoho.tokens', {
    refreshToken: token.refresh_token,
    accessToken,
    expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    accountsServer,
    mailBase,
    accountId: String(account.accountId),
    email: account.primaryEmailAddress ?? account.mailboxAddress ?? null
  } satisfies ZohoTokens)
  setSetting(db, 'zoho.error', null)
}

export async function disconnect(db: Db): Promise<void> {
  const tokens = getSecret<ZohoTokens>(db, 'zoho.tokens')
  if (tokens) await net.fetch(`${tokens.accountsServer}/oauth/v2/token/revoke?token=${encodeURIComponent(tokens.refreshToken)}`, { method: 'POST' }).catch(() => undefined)
  putSecret(db, 'zoho.tokens', null)
}

async function session(db: Db): Promise<ZohoTokens> {
  const tokens = getSecret<ZohoTokens>(db, 'zoho.tokens')
  const client = getSecret<ZohoClient>(db, 'zoho.client')
  if (!tokens || !client) throw new Error('Zoho Mail isn’t connected')
  if (Date.now() < tokens.expiresAt - 60_000) return tokens
  try {
    const t = await postToken(tokens.accountsServer, {
      refresh_token: tokens.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token'
    })
    const next = { ...tokens, accessToken: String(t.access_token), expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000 }
    putSecret(db, 'zoho.tokens', next)
    return next
  } catch (err) {
    if (err instanceof ZohoError && (err.message === 'invalid_code' || err.message === 'invalid_client' || err.status === 400)) {
      putSecret(db, 'zoho.tokens', null)
      throw new Error('Zoho sign-in expired. Click Connect in Settings to sign in again.')
    }
    throw err
  }
}

async function mailGet<T>(db: Db, path: string): Promise<T> {
  const s = await session(db)
  const res = await net.fetch(`${s.mailBase}/api/accounts/${encodeURIComponent(s.accountId)}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${s.accessToken}` }
  })
  const json = (await res.json().catch(() => ({}))) as T & { status?: { description?: string } }
  if (!res.ok) {
    const message = json.status?.description ?? `Zoho Mail error ${res.status}`
    setSetting(db, 'zoho.error', message)
    throw new Error(message)
  }
  setSetting(db, 'zoho.error', null)
  return json
}

export async function search(db: Db, email: string): Promise<ZohoMessage[]> {
  if (!email.trim()) return []
  const s = await session(db)
  const qs = new URLSearchParams({ searchKey: searchKeyFor(email), limit: '50', includeto: 'true' })
  const r = await mailGet<{ data?: Parameters<typeof parseMessages>[0] }>(db, `/messages/search?${qs}`)
  return parseMessages(r.data ?? [], email, s.mailBase).slice(0, 25)
}

export async function message(db: Db, folderId: string, messageId: string): Promise<ZohoMessageContent> {
  const s = await session(db)
  const base = `/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}`
  const [content, details] = await Promise.all([
    mailGet<{ data?: { content?: string } }>(db, `${base}/content`),
    mailGet<{ data?: { subject?: string; sender?: string; fromAddress?: string; toAddress?: string; receivedTime?: string | number } }>(db, `${base}/details`).catch(
      () => ({ data: {} as Record<string, string> })
    )
  ])
  const d = details.data ?? {}
  const decode = (v?: string): string => (v ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  return {
    subject: decode(d.subject) || '(no subject)',
    from: decode(d.sender ?? d.fromAddress),
    to: decode(d.toAddress),
    date: Number(d.receivedTime ?? 0),
    html: emailDocument(content.data?.content ?? ''),
    link: `${s.mailBase}/zm/#mail/folder/${encodeURIComponent(folderId)}/p/${encodeURIComponent(messageId)}`
  }
}
