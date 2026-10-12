import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { CheckCircle2, Send, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { ASSISTANT_MODELS, ASSISTANT_PROVIDERS, type AssistantMessage, type AssistantProvider, type AssistantStatus } from '../../../shared/api'
import { api } from '../api'

/** The conversation stays while you move around Plannr (until you clear it or close Plannr) */
const useChat = create<{ messages: (AssistantMessage & { actions?: string[] })[]; set: (m: (AssistantMessage & { actions?: string[] })[]) => void }>((set) => ({ messages: [], set: (messages) => set({ messages }) }))

const SUGGESTIONS = ['What’s coming up this week?', 'Which tickets are waiting on me?', 'Summarize today’s local news', 'How did money look this month?', 'Add milk, eggs and bread to my shopping list', 'Any good game deals right now?']

/** Ask about anything in Plannr, or have it add tasks, events, notes and list items. */
export function AssistantView() {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [setup, setSetup] = useState(false)
  const [key, setKey] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { messages, set } = useChat()
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void api.assistant.status().then((s) => {
      setStatus(s)
      if (!s.configured) setSetup(true)
    })
  }, [])
  // A block, not an expression: scrollIntoView now returns a promise, and an effect must return nothing (or a cleanup)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy])

  const send = async (q: string): Promise<void> => {
    if (!q.trim() || busy) return
    const next = [...messages, { role: 'user' as const, text: q.trim() }]
    set(next)
    setText('')
    setBusy(true)
    setError('')
    try {
      const { reply, actions } = await api.assistant.ask(next.map(({ role, text }) => ({ role, text })))
      set([...next, { role: 'assistant', text: reply, actions }])
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <div className="page assistant-page" />
  const provider = ASSISTANT_PROVIDERS.find((p) => p.id === status.provider) ?? ASSISTANT_PROVIDERS[0]
  const listed = ASSISTANT_MODELS.filter((m) => m.provider === status.provider)
  return (
    <div className="page assistant-page">
      <div className="list-header">
        <h1>Assistant</h1>
        <div className="news-header-actions">
          {messages.length > 0 && (
            <button type="button" className="icon-btn" aria-label="Start over" title="Start over" onClick={() => set([])}>
              <Trash2 />
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => setSetup((s) => !s)}>
            <Settings2 /> Setup
          </button>
        </div>
      </div>

      {setup && (
        <section className="card assistant-setup">
          <label className="mfield">
            Which AI
            <select value={status.provider} aria-label="Which AI" onChange={(e) => void api.assistant.setup({ provider: e.target.value as AssistantProvider }).then(setStatus)}>
              {ASSISTANT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="small">
            {provider.keyHelp}{' '}
            <a href={provider.keyUrl} target="_blank" rel="noreferrer">
              Open {new URL(provider.keyUrl).hostname}
            </a>
            . Your key is stored encrypted on this PC; only what you ask, and the Plannr details it looks up to answer, are sent.
          </p>
          {status.provider !== 'ollama' && (
          <form
            className="news-add-link"
            onSubmit={async (e) => {
              e.preventDefault()
              const s = await api.assistant.setup({ key: key || undefined })
              setStatus(s)
              setKey('')
              if (s.configured) setSetup(false)
            }}
          >
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={status.configured ? 'A key is saved (paste a new one to replace it)' : `Paste your ${provider.label.replace(/ –.*$/, '')} API key`}
              aria-label="API key"
            />
            <button type="submit" className="btn">
              Save
            </button>
          </form>
          )}
          <label className="mfield">
            Model
            <select
              value={listed.some((m) => m.id === status.model) ? status.model : '__other'}
              aria-label="Model"
              onChange={(e) => e.target.value !== '__other' && void api.assistant.setup({ model: e.target.value }).then(setStatus)}
            >
              {listed.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              <option value="__other">Another model (type its name)…</option>
            </select>
          </label>
          <label className="mfield">
            Model name
            <input
              key={status.model}
              defaultValue={status.model}
              aria-label="Model name"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== status.model && void api.assistant.setup({ model: e.target.value }).then(setStatus)}
            />
          </label>
          {status.configured && (
            <button type="button" className="link-btn small" onClick={() => void api.assistant.setup({ key: null }).then(setStatus)}>
              Remove my key
            </button>
          )}
        </section>
      )}

      <div className="chat">
        {messages.length === 0 && (
          <div className="chat-empty">
            <Sparkles />
            <p>Ask about your tickets, customers, calendar, money, notes, news or lists, or ask it to add a task, event, note or shopping item.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip-btn" disabled={!status.configured} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.text}</div>
            {m.actions?.map((a) => (
              <div key={a} className="chat-action small">
                <CheckCircle2 /> {a}
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="chat-msg assistant thinking">Thinking…</div>}
        {error && <p className="small danger-text">{error}</p>}
        <div ref={bottom} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <textarea
          value={text}
          rows={2}
          placeholder={status.configured ? 'Ask anything… (Enter to send, Shift+Enter for a new line)' : 'Add your API key in Setup first'}
          disabled={!status.configured}
          aria-label="Ask the assistant"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(text)
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={!status.configured || busy || !text.trim()} aria-label="Send">
          <Send />
        </button>
      </form>
    </div>
  )
}
