import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, Plus } from 'lucide-react'
import type { TemplateSummary } from '../../../shared/api'
import { api } from '../api'
import { newNote } from '../actions'
import { ItemIcon } from '../lib/icons'

/** "New note" with a menu of note templates (Meeting notes, Checklist, Repair guide…). */
export function NewNoteButton({ folderId = null, primary = false }: { folderId?: string | null; primary?: boolean }) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void api.templates.list('note').then(setTemplates)
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const cls = `btn ${primary ? 'primary' : ''}`
  return (
    <div className="split-btn" ref={ref}>
      <button type="button" className={cls} onClick={() => void newNote(folderId)}>
        <Plus /> New note
      </button>
      <button type="button" className={`${cls} split-arrow`} aria-label="Choose note template" onClick={() => setOpen((o) => !o)}>
        <ChevronDown />
      </button>
      {open && (
        <div className="menu dropdown-menu">
          <button type="button" className="menu-item" onClick={() => void newNote(folderId)}>
            <FileText />
            <span className="menu-label">Blank note</span>
          </button>
          {templates.map((t) => (
            <button key={t.id} type="button" className="menu-item" onClick={() => void newNote(folderId, undefined, t.id)}>
              <ItemIcon icon={t.icon} color="" fallback={FileText} />
              <span className="menu-label">{t.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
