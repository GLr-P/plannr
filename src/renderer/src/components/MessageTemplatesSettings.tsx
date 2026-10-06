import { useEffect, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { DEFAULT_MESSAGES, loadTemplates, PLACEHOLDERS, saveTemplates, type MessageTemplate } from '../lib/messages'

/** Settings → Tickets: the messages offered by a ticket's Message button. Saves when you leave a field. */
export function MessageTemplatesSettings() {
  const [list, setList] = useState<MessageTemplate[] | null>(null)
  useEffect(() => {
    void loadTemplates().then(setList)
  }, [])
  if (!list) return null
  const save = (next: MessageTemplate[]): void => {
    setList(next)
    void saveTemplates(next)
  }
  const edit = (id: string, patch: Partial<MessageTemplate>): void => setList(list.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return (
    <section className="setting setting-stack">
      <div>
        <h3>Customer messages</h3>
        <p className="muted">
          Used by the <strong>Message</strong> button on a ticket. Placeholders like {'{first_name}'} are filled in for you.
        </p>
      </div>
      <div className="message-templates">
        {list.map((t) => (
          <div key={t.id} className="message-template">
            <div className="message-template-head">
              <input className="setting-input" value={t.name} aria-label="Message name" onChange={(e) => edit(t.id, { name: e.target.value })} onBlur={() => save(list)} />
              <button type="button" className="icon-btn sm" aria-label={`Delete ${t.name}`} title="Delete" onClick={() => save(list.filter((x) => x.id !== t.id))}>
                <Trash2 />
              </button>
            </div>
            <input className="setting-input wide" value={t.subject} aria-label="Subject" placeholder="Subject" onChange={(e) => edit(t.id, { subject: e.target.value })} onBlur={() => save(list)} />
            <textarea className="setting-textarea wide" rows={5} value={t.body} aria-label="Message text" onChange={(e) => edit(t.id, { body: e.target.value })} onBlur={() => save(list)} />
          </div>
        ))}
      </div>
      <div className="backup-actions">
        <button type="button" className="btn sm" onClick={() => save([...list, { id: `m${Date.now()}`, name: 'New message', subject: '', body: 'Hi {first_name},\n\n\n\n{business}' }])}>
          <Plus /> New message
        </button>
        <button type="button" className="btn sm" title="Put the four starter messages back" onClick={() => save(DEFAULT_MESSAGES)}>
          <RotateCcw /> Restore the starters
        </button>
      </div>
      <p className="small muted placeholders">
        {PLACEHOLDERS.map(([p, what]) => (
          <span key={p}>
            <code>{p}</code> {what}
          </span>
        ))}
      </p>
    </section>
  )
}
