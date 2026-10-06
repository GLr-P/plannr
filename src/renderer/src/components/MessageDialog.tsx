import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Copy, Mail, X } from 'lucide-react'
import type { Customer, TicketSummary } from '../../../shared/api'
import { api } from '../api'
import { fillMessage, type MessageTemplate } from '../lib/messages'
import { showToast } from '../lib/toast'

interface Open {
  template: MessageTemplate
  ticket: TicketSummary
  customer: Customer | null
}

export const useMessageDialog = create<{ open: Open | null; set: (o: Open | null) => void }>((set) => ({ open: null, set: (open) => set({ open }) }))

/** Preview and edit a customer message, then open it in the mail app or copy it (for a text message). */
export function MessageDialog() {
  const { open, set } = useMessageDialog()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  useEffect(() => {
    if (!open) return
    void api.business.get().then((business) => {
      setSubject(fillMessage(open.template.subject, { ...open, business }))
      setBody(fillMessage(open.template.body, { ...open, business }))
    })
  }, [open])
  if (!open) return null
  const email = open.customer?.email || open.ticket.customerEmail
  const phone = open.customer?.phone || open.ticket.customerPhone

  return (
    <div className="dialog-backdrop" onMouseDown={() => set(null)}>
      <div
        className="dialog message-dialog"
        role="dialog"
        aria-label={`Message: ${open.template.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && set(null)}
      >
        <div className="dialog-head">
          <h2>{open.template.name}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => set(null)}>
            <X />
          </button>
        </div>
        <p className="small muted">
          To {open.customer?.name || open.ticket.customerName || 'the customer'}
          {email ? ` · ${email}` : ''}
          {phone ? ` · ${phone}` : ''}
        </p>
        <label className="mfield">
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
        </label>
        <label className="mfield">
          Message
          <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(body)
              showToast('Message copied: paste it into a text or chat')
            }}
          >
            <Copy /> Copy text
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!email}
            title={email ? 'Opens your email app with this message' : 'This customer has no email address'}
            onClick={() => {
              window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
              set(null)
            }}
          >
            <Mail /> Open in email
          </button>
        </div>
      </div>
    </div>
  )
}
