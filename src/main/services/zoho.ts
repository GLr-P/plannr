import type { ZohoMessage, ZohoRegion } from '../../shared/api'

/*
 * Zoho Mail helpers that don't need Electron (region URLs, parsing API results) — unit-tested.
 * Zoho keeps each account in one data centre; the sign-in callback tells us which (accounts-server).
 */

export const ZOHO_REDIRECT = 'http://localhost:53682/callback'
export const ZOHO_PORT = 53682
export const ZOHO_SCOPES = ['ZohoMail.accounts.READ', 'ZohoMail.messages.READ', 'ZohoMail.folders.READ']

const REGION_DOMAIN: Record<ZohoRegion, string> = {
  com: 'zoho.com',
  eu: 'zoho.eu',
  in: 'zoho.in',
  'com.au': 'zoho.com.au',
  jp: 'zoho.jp',
  ca: 'zohocloud.ca',
  sa: 'zoho.sa'
}

export const accountsServerFor = (region: ZohoRegion): string => `https://accounts.${REGION_DOMAIN[region]}`

/** https://accounts.zoho.eu → https://mail.zoho.eu (same data centre). */
export function mailBaseFor(accountsServer: string): string {
  const host = new URL(accountsServer).host
  if (!/^accounts\.zoho(cloud)?\.[a-z.]+$/.test(host)) throw new Error(`Unexpected Zoho server: ${host}`)
  return `https://${host.replace(/^accounts\./, 'mail.')}`
}

/** Search across the whole mailbox for messages to/from/cc this address. */
export const searchKeyFor = (email: string): string => `entire:${email.trim()}`

interface RawMessage {
  messageId?: string | number
  folderId?: string | number
  threadId?: string | number
  subject?: string
  summary?: string
  sender?: string
  fromAddress?: string
  toAddress?: string
  ccAddress?: string
  receivedTime?: string | number
  sentDateInGMT?: string | number
  hasAttachment?: string | boolean
}

/** Zoho returns HTML-escaped, sometimes quoted address lists: "&quot;Jane&quot; &lt;jane@x.com&gt;". */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const addresses = (s?: string): string[] => (decodeEntities(s ?? '').match(/[^\s<>",;]+@[^\s<>",;]+/g) ?? []).map((a) => a.toLowerCase())

/** Turns search results into Plannr's shape, keeping only mail actually to/from/cc the customer, newest first. */
export function parseMessages(raw: RawMessage[], customerEmail: string, mailBase: string): ZohoMessage[] {
  const target = customerEmail.trim().toLowerCase()
  const seen = new Set<string>()
  const out: ZohoMessage[] = []
  for (const m of raw) {
    if (!m.messageId || !m.folderId) continue
    const from = addresses(m.fromAddress ?? m.sender)
    const to = [...addresses(m.toAddress), ...addresses(m.ccAddress)]
    const fromCustomer = from.includes(target)
    if (!fromCustomer && !to.includes(target)) continue
    const id = String(m.messageId)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      folderId: String(m.folderId),
      subject: decodeEntities(m.subject ?? '') || '(no subject)',
      summary: decodeEntities(m.summary ?? '').trim(),
      from: decodeEntities(m.sender ?? m.fromAddress ?? ''),
      incoming: fromCustomer,
      date: Number(m.receivedTime ?? m.sentDateInGMT ?? 0),
      hasAttachment: m.hasAttachment === true || m.hasAttachment === '1' || m.hasAttachment === 'true',
      link: `${mailBase}/zm/#mail/folder/${encodeURIComponent(String(m.folderId))}/p/${encodeURIComponent(id)}`
    })
  }
  return out.sort((a, b) => b.date - a.date)
}

/**
 * Wraps an email's HTML for display in a sandboxed frame: no scripts, no remote images or requests
 * (tracking pixels), links open in the browser.
 */
export function emailDocument(html: string): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:; font-src data:"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{font-family:Segoe UI,system-ui,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{border-left:3px solid #ddd;margin:8px 0;padding-left:10px;color:#555}</style></head><body>${html}</body></html>`
}
