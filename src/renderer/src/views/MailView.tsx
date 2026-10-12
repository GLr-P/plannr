import { useCallback, useEffect, useState } from 'react'
import { CheckSquare, Mail, Paperclip, RefreshCw, Wrench } from 'lucide-react'
import type { ZohoMessage, ZohoStatus } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { relativeTime } from '../lib/format'
import { showToast } from '../lib/toast'
import { newTicket } from '../actions'
import { EmailViewer } from '../components/CustomerEmails'

const addressOf = (from: string): string => /<([^>]+)>/.exec(from)?.[1] ?? (/\S+@\S+/.exec(from)?.[0] ?? '')

/** Your Zoho Mail inbox: read a message, or turn it into a ticket or a task. */
export function MailView() {
  const [status, setStatus] = useState<ZohoStatus | null>(null)
  const [messages, setMessages] = useState<ZohoMessage[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState<ZohoMessage | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setMessages(await api.zoho.inbox())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Couldn’t load your mail')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void api.zoho.status().then((s) => {
      setStatus(s)
      if (s.connected) void load()
    })
  }, [load])

  const makeTask = async (m: ZohoMessage): Promise<void> => {
    await api.tasks.create({ title: m.subject, notes: [`From ${m.from}`, m.summary, m.link].filter(Boolean).join('\n\n') })
    showToast('Added to your tasks', { label: 'Open', run: () => go({ view: 'tasks' }) })
  }
  const makeTicket = async (m: ZohoMessage): Promise<void> => {
    const email = addressOf(m.from).toLowerCase()
    const match = email ? (await api.customers.list({ query: email })).find((c) => c.email.toLowerCase() === email) : undefined
    const name = m.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim()
    const customerId = match?.id ?? (await api.customers.create({ name: name || email, email })).id
    await newTicket({ customerId })
  }

  if (!status) return <div className="page mail-page" />
  return (
    <div className="page mail-page">
      <div className="list-header">
        <h1>Mail</h1>
        {status.connected && <span className="muted small">{status.email}</span>}
        {status.connected && (
          <div className="news-header-actions">
            <button type="button" className="icon-btn" aria-label="Check mail" title="Check mail" disabled={busy} onClick={() => void load()}>
              <RefreshCw className={busy ? 'spin' : ''} />
            </button>
          </div>
        )}
      </div>
      {!status.connected && (
        <div className="empty-state welcome">
          <p>
            <Mail className="inline-icon" /> Connect your Zoho Mail to see your inbox here and turn emails into tickets or tasks.
          </p>
          <button type="button" className="btn sm" onClick={() => go({ view: 'settings' })}>
            Settings → Connected accounts
          </button>
        </div>
      )}
      {error && <p className="small danger-text">{error}</p>}
      {messages && messages.length === 0 && <div className="empty-state">Your inbox is empty.</div>}
      <ul className="mail-list">
        {messages?.map((m) => (
          <li key={m.id} className="mail-row">
            <button type="button" className="mail-main" onClick={() => setReading(m)}>
              <span className="mail-from">{m.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || m.from}</span>
              <span className="mail-subject">
                {m.subject} {m.hasAttachment && <Paperclip className="inline-icon" />}
              </span>
              <span className="small muted mail-summary">{m.summary}</span>
            </button>
            <span className="small muted mail-time">{relativeTime(m.date)}</span>
            <button type="button" className="icon-btn sm" title="Make a ticket (and the customer, if new)" aria-label={`Make a ticket from ${m.subject}`} onClick={() => void makeTicket(m)}>
              <Wrench />
            </button>
            <button type="button" className="icon-btn sm" title="Make a task" aria-label={`Make a task from ${m.subject}`} onClick={() => void makeTask(m)}>
              <CheckSquare />
            </button>
          </li>
        ))}
      </ul>
      {reading && <EmailViewer message={reading} onClose={() => setReading(null)} />}
    </div>
  )
}
