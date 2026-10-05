import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Mail, Paperclip, RefreshCw, X } from 'lucide-react'
import type { ZohoMessage, ZohoMessageContent } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { relativeTime } from '../lib/format'

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** "Emails" with a customer (from Zoho Mail), newest first; click one to read it in place. */
export function CustomerEmails({ email, name }: { email: string; name?: string }) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<ZohoMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<ZohoMessage | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setMessages(await api.zoho.search(email))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void api.zoho.status().then((s) => {
      setConnected(s.connected)
      if (s.connected && email.trim()) void load()
    })
  }, [email])

  if (connected === null || !email.trim()) return null
  if (!connected)
    return (
      <section className="backlinks emails">
        <h3>Emails</h3>
        <button type="button" className="link-btn tight" onClick={() => go({ view: 'settings' })}>
          Connect Zoho Mail in Settings to see your emails with {name || 'this customer'} here.
        </button>
      </section>
    )

  return (
    <section className="backlinks emails">
      <h3 className="emails-head">
        Emails <span className="muted">{messages ? messages.length : ''}</span>
        <button type="button" className="icon-btn sm" title="Refresh" aria-label="Refresh emails" onClick={() => void load()} disabled={loading}>
          <RefreshCw />
        </button>
      </h3>
      {error && <p className="small error-text">{error}</p>}
      {messages?.length === 0 && <p className="small muted">No emails with {email} yet.</p>}
      {messages?.map((m) => (
        <button key={m.id} type="button" className="email-row" onClick={() => setOpen(m)}>
          <span className={`email-dir ${m.incoming ? 'in' : 'out'}`} title={m.incoming ? 'From them' : 'Sent by you'}>
            {m.incoming ? <ArrowDownLeft /> : <ArrowUpRight />}
          </span>
          <span className="email-main">
            <span className="email-subject">
              {m.subject}
              {m.hasAttachment && <Paperclip className="email-clip" />}
            </span>
            {m.summary && <span className="email-summary">{m.summary}</span>}
          </span>
          <span className="email-date">{m.date ? relativeTime(m.date) : ''}</span>
        </button>
      ))}
      {open && <EmailViewer message={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function EmailViewer({ message, onClose }: { message: ZohoMessage; onClose: () => void }) {
  const [content, setContent] = useState<ZohoMessageContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    void api.zoho
      .message(message.folderId, message.id)
      .then(setContent)
      .catch((e) => setError(cleanError(e)))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [message, onClose])

  return (
    <div className="file-preview email-viewer" role="dialog" aria-label={`Email: ${message.subject}`}>
      <div className="file-preview-bar">
        <span className="file-preview-name">
          <Mail /> {message.subject}
        </span>
        <span className="lightbox-actions">
          <button type="button" className="btn sm" onClick={() => window.open(content?.link ?? message.link, '_blank')}>
            <ExternalLink /> Open in Zoho Mail
          </button>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close email" title="Close (Esc)" onClick={onClose}>
            <X />
          </button>
        </span>
      </div>
      <div className="file-preview-body" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="email-sheet">
          <div className="email-meta">
            <div>
              <strong>From:</strong> {content?.from || message.from}
            </div>
            {content?.to && (
              <div>
                <strong>To:</strong> {content.to}
              </div>
            )}
            <div className="muted">{new Date(content?.date || message.date).toLocaleString()}</div>
          </div>
          {error ? (
            <p className="error-text">{error}</p>
          ) : content ? (
            // No allow-scripts / allow-same-origin: the email can't run code or reach Plannr. Remote images are blocked by its CSP.
            <iframe className="email-frame" title="Email content" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={content.html} />
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>
      </div>
    </div>
  )
}
