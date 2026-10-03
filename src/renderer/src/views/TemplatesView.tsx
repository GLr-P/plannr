import { useCallback, useEffect, useState } from 'react'
import { LayoutTemplate, Plus, Star } from 'lucide-react'
import type { DocJSON, Template, TemplateSummary } from '../../../shared/api'
import { api } from '../api'
import { go } from '../store/nav'
import { useAutosave } from '../lib/useAutosave'
import { relativeTime } from '../lib/format'
import { NoteEditor } from '../editor/NoteEditor'
import { ConfirmButton, SaveIndicator } from '../components/common'

const DEFAULT_KEY = 'defaultTemplateId'

export function TemplatesView() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await api.templates.list()
    const saved = (await api.settings.get(DEFAULT_KEY)) as string | null
    setTemplates(list)
    setDefaultId(list.some((t) => t.id === saved) ? saved : (list[0]?.id ?? null))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page list-page">
      <div className="list-header">
        <h1>Ticket templates</h1>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            const t = await api.templates.create({ name: 'New template' })
            go({ view: 'template', id: t.id })
          }}
        >
          <Plus /> New template
        </button>
      </div>
      <p className="muted intro">
        Every new ticket starts as a copy of a template. Inside a template, type <kbd>/</kbd> and choose <strong>Form field</strong> to add a
        fill-in box.
      </p>
      <ul className="note-list">
        {templates.map((t) => (
          <li key={t.id} className="note-row" onClick={() => go({ view: 'template', id: t.id })}>
            <LayoutTemplate className="note-row-icon" />
            <div className="note-row-main">
              <div className="note-row-title">
                {t.name}
                {t.id === defaultId && <span className="chip tag-chip">Default</span>}
              </div>
              <div className="note-row-preview">Edited {relativeTime(t.updatedAt).toLowerCase()}</div>
            </div>
            <div className="note-row-side">
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                {t.id !== defaultId && (
                  <button
                    type="button"
                    className="icon-btn sm"
                    title="Make default"
                    aria-label="Make default"
                    onClick={async () => {
                      await api.settings.set(DEFAULT_KEY, t.id)
                      setDefaultId(t.id)
                    }}
                  >
                    <Star />
                  </button>
                )}
                <ConfirmButton
                  title="Delete template"
                  onConfirm={async () => {
                    await api.templates.remove(t.id)
                    await load()
                  }}
                />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TemplateView({ id }: { id: string }) {
  const [template, setTemplate] = useState<Template | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setTemplate(undefined)
    void api.templates.get(id).then((t) => !cancelled && setTemplate(t))
    return () => {
      cancelled = true
    }
  }, [id])
  if (template === undefined) return <div className="page" />
  if (template === null) return <div className="page empty-state">This template was deleted.</div>
  return <TemplatePage key={template.id} template={template} />
}

function TemplatePage({ template }: { template: Template }) {
  const [name, setName] = useState(template.name)
  const [updatedAt, setUpdatedAt] = useState(template.updatedAt)
  const saver = useAutosave<{ name?: string; content?: DocJSON }>(async (patch) => {
    await api.templates.update(template.id, patch)
    setUpdatedAt(Date.now())
  })
  const onContent = useCallback((doc: DocJSON) => saver.queue({ content: doc }), [saver.queue])

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => go({ view: 'templates' })}>
            Templates
          </button>
        </div>
        <div className="toolbar-right">
          <SaveIndicator status={saver.status} updatedAt={updatedAt} />
        </div>
      </div>
      <div className="doc">
        <input
          className="doc-title"
          value={name}
          placeholder="Template name"
          onChange={(e) => {
            setName(e.target.value)
            saver.queue({ name: e.target.value })
          }}
          aria-label="Template name"
        />
        <div className="template-hint">
          Type <kbd>/</kbd> → <strong>Form field</strong> to add a fill-in box. Use the gear on a field to rename it or change its type. Values
          typed here become defaults for new tickets.
        </div>
        <NoteEditor docId={template.id} content={template.content} editable onChange={onContent} />
      </div>
    </div>
  )
}
