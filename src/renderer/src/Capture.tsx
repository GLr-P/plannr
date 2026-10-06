import { useEffect, useRef, useState } from 'react'
import { CheckSquare, FileText } from 'lucide-react'
import { api } from './api'
import { todayISO } from './lib/format'
import { addDays } from './lib/time'
import { useAppearance } from './lib/appearance'

type Kind = 'task' | 'note'

/**
 * The quick capture box (its own small window). Enter saves, Esc closes, Tab switches between task and note.
 * A note's first line is its title; the rest is its text.
 */
export function Capture() {
  useAppearance() // your accent colour
  const [kind, setKind] = useState<Kind>('task')
  const [text, setText] = useState('')
  const [due, setDue] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Each time the box opens: start fresh, cursor in the box.
    return window.plannrEvents.onCaptureOpen(() => {
      setText('')
      setDue(null)
      setSaved(null)
      setTimeout(() => box.current?.focus(), 0)
    })
  }, [])

  const save = async (): Promise<void> => {
    const value = text.trim()
    if (!value) return void api.app.closeCapture()
    if (kind === 'task') {
      await api.tasks.create({ title: value.split('\n')[0], notes: value.split('\n').slice(1).join('\n'), dueDate: due })
    } else {
      const [title, ...rest] = value.split('\n')
      const note = await api.notes.create({ title })
      if (rest.join('').trim())
        await api.notes.update(note.id, { content: { type: 'doc', content: rest.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) } })
    }
    setSaved(kind === 'task' ? 'Task added' : 'Note saved')
    setText('')
    await api.app.captureSaved()
    setTimeout(() => void api.app.closeCapture(), 450)
  }

  const today = todayISO()
  return (
    <div
      className="capture"
      onKeyDown={(e) => {
        if (e.key === 'Escape') void api.app.closeCapture()
        if (e.key === 'Tab') {
          e.preventDefault()
          setKind(kind === 'task' ? 'note' : 'task')
        }
      }}
    >
      <div className="capture-head">
        <div className="segmented capture-kind" role="radiogroup" aria-label="Capture as">
          <button type="button" role="radio" aria-checked={kind === 'task'} className={kind === 'task' ? 'active' : ''} onClick={() => setKind('task')}>
            <CheckSquare /> Task
          </button>
          <button type="button" role="radio" aria-checked={kind === 'note'} className={kind === 'note' ? 'active' : ''} onClick={() => setKind('note')}>
            <FileText /> Note
          </button>
        </div>
        {kind === 'task' && (
          <div className="capture-dates">
            <button type="button" className={`chip-btn ${due === today ? 'active' : ''}`} onClick={() => (setDue(due === today ? null : today), box.current?.focus())}>
              Today
            </button>
            <button
              type="button"
              className={`chip-btn ${due === addDays(today, 1) ? 'active' : ''}`}
              onClick={() => (setDue(due === addDays(today, 1) ? null : addDays(today, 1)), box.current?.focus())}
            >
              Tomorrow
            </button>
          </div>
        )}
      </div>
      <textarea
        ref={box}
        autoFocus
        className="capture-box"
        value={text}
        placeholder={kind === 'task' ? 'What needs doing?' : 'Jot it down… (first line is the title)'}
        aria-label={kind === 'task' ? 'New task' : 'New note'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void save()
          }
        }}
      />
      <div className="capture-foot">
        {saved ? (
          <span className="capture-saved">{saved}</span>
        ) : (
          <span>
            <kbd>Enter</kbd> save · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>Tab</kbd> task/note · <kbd>Esc</kbd> close
          </span>
        )}
      </div>
    </div>
  )
}
