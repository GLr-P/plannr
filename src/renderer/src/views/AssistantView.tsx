import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { CheckCircle2, Send, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { ASSISTANT_MODELS, type AssistantMessage, type AssistantProvider, type AssistantStatus } from '../../../shared/api'
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
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages, busy])

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
          <div className="segmented assistant-provider" role="radiogroup" aria-label="Which AI">
            {(['openai', 'anthropic'] as AssistantProvider[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={status.provider === p} className={status.provider === p ? 'active' : ''} onClick={() => void api.assistant.setup({ provider: p }).then(setStatus)}>
                {p === 'openai' ? 'ChatGPT (OpenAI)' : 'Claude (Anthropic)'}
              </button>
            ))}
          </div>
          {status.provider === 'openai' ? (
            <p className="small">
              ChatGPT needs an <b>OpenAI API key</b> (separate from a ChatGPT Plus subscription): create one at{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                platform.openai.com/api-keys
              </a>{' '}
              and add a little credit under Billing. A question usually costs well under a cent. Your key is stored encrypted on this PC. Only what you ask, and the Plannr details it looks up to answer, are sent.
            </p>
          ) : (
            <p className="small">
              Claude needs an <b>Anthropic API key</b>: create one at{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com
              </a>{' '}
              and add a little credit. A question usually costs well under a cent. Your key is stored encrypted on this PC. Only what you ask, and the Plannr details it looks up to answer, are sent.
            </p>
          )}
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
              placeholder={status.configured ? 'A key is saved (paste a new one to replace it)' : status.provider === 'openai' ? 'Paste your OpenAI API key (sk-…)' : 'Paste your Anthropic API key (sk-ant-…)'}
              aria-label="API key"
            />
            <button type="submit" className="btn">
              Save
            </button>
          </form>
          <label className="mfield">
            Model
            <select value={status.model} aria-label="Model" onChange={(e) => void api.assistant.setup({ model: e.target.value }).then(setStatus)}>
              {ASSISTANT_MODELS.filter((m) => m.provider === status.provider).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
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
