import { useCallback, useEffect, useState } from 'react'
import { FileText, LayoutTemplate, Plus, Star } from 'lucide-react'
import type { DocJSON, Template, TemplateKind, TemplateSummary } from '../../../shared/api'
import { useUi } from '../store/ui'
import { ItemIcon } from '../lib/icons'
import { IconPicker, openPanel } from '../components/ContextMenu'
import { newNote } from '../actions'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { useAutosave } from '../lib/useAutosave'
import { relativeTime } from '../lib/format'
import { NoteEditor } from '../editor/NoteEditor'
import { ConfirmButton, SaveIndicator } from '../components/common'
import { TicketLayoutPanel } from '../components/TicketLayoutPanel'
import type { TicketLayout } from '../../../shared/api'
import { CanvasDesigner } from '../canvas/CanvasDesigner'
import { starterCanvas } from '../canvas/presets'
import { isCanvas } from '../../../shared/canvas'
import { LayoutDashboard } from 'lucide-react'

/** New canvas templates: the canvas holds the customer, dates and the rest, so the ticket's top shows just the title. */
const CANVAS_LAYOUT = { showSummary: false, showCustomer: false, showReceived: false, showPickup: false, showPrice: false, showLines: false, showPhotos: false }

const DEFAULT_KEY = 'defaultTemplateId'

export function TemplatesView() {
  const kind = (useUi((s) => s.prefs.templatesTab) as TemplateKind | undefined) ?? 'ticket'
  const setPref = useUi((s) => s.setPref)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [defaultId, setDefaultId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await api.templates.list(kind)
    const saved = (await api.settings.get(DEFAULT_KEY)) as string | null
    setTemplates(list)
    setDefaultId(kind === 'ticket' ? (list.some((t) => t.id === saved) ? saved : (list[0]?.id ?? null)) : null)
  }, [kind])
  const remote = useData((s) => s.remote) // changed on another device
  useEffect(() => {
    void load()
  }, [load, remote])

  return (
    <div className="page list-page">
      <div className="list-header">
        <h1>Templates</h1>
        <span className="list-header-actions">
          {kind === 'ticket' && (
            <button
              type="button"
              className="btn"
              title="A page where you put fields, text and pictures anywhere and size them freely"
              onClick={async () => {
                // The canvas places the customer and dates itself, so the ticket's own top shows just the title
                const t = await api.templates.create({ name: 'New canvas template', kind, content: starterCanvas(), layout: CANVAS_LAYOUT })
                go({ view: 'template', id: t.id })
              }}
            >
              <LayoutDashboard /> New canvas template
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const t = await api.templates.create({ name: 'New template', kind })
              go({ view: 'template', id: t.id })
            }}
          >
            <Plus /> New {kind} template
          </button>
        </span>
      </div>
      <div className="segmented settings-tabs" role="tablist" aria-label="Template kinds">
        {(['ticket', 'note'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setPref('templatesTab', k)}>
            {k === 'ticket' ? 'Ticket templates' : 'Note templates'}
          </button>
        ))}
      </div>
      <p className="muted intro">
        {kind === 'ticket' ? (
          <>
            Every new ticket starts as a copy of a template. Inside a template, type <kbd>/</kbd> and choose <strong>Form field</strong> to add
            a fill-in box.
          </>
        ) : (
          <>
            Pick one from <strong>New note ▾</strong> to start a note from it. Right-click any note → <strong>Save as template</strong> to make your
            own.
          </>
        )}
      </p>
      <ul className="note-list">
        {templates.map((t) => (
          <li key={t.id} className="note-row" onClick={() => go({ view: 'template', id: t.id })}>
            {kind === 'note' ? <ItemIcon icon={t.icon} color="" fallback={FileText} className="note-row-icon" /> : <LayoutTemplate className="note-row-icon" />}
            <div className="note-row-main">
              <div className="note-row-title">
                {t.name}
                {t.id === defaultId && <span className="chip tag-chip">Default</span>}
              </div>
              <div className="note-row-preview">Edited {relativeTime(t.updatedAt).toLowerCase()}</div>
            </div>
            <div className="note-row-side">
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                {kind === 'note' && (
                  <button type="button" className="btn sm" title="New note from this template" onClick={() => void newNote(null, undefined, t.id)}>
                    <Plus /> Use
                  </button>
                )}
                {kind === 'ticket' && t.id !== defaultId && (
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

/** Ticket templates' editor knows it's for tickets (the / menu offers Customer details and Ticket dates). */
const TICKET_EDITOR = { ticket: true }

function TemplatePage({ template }: { template: Template }) {
  const [name, setName] = useState(template.name)
  const [icon, setIcon] = useState(template.icon)
  const [updatedAt, setUpdatedAt] = useState(template.updatedAt)
  const saver = useAutosave<{ name?: string; content?: DocJSON; icon?: string; layout?: Partial<TicketLayout> }>(async (patch) => {
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
        <div className="doc-title-row">
          {template.kind === 'note' && (
            <button
              type="button"
              className={`doc-icon ${icon ? '' : 'unset'}`}
              title="Icon for notes made from this template"
              aria-label="Change icon"
              onClick={(e) =>
                openPanel(e.currentTarget, 'Icon', () => (
                  <IconPicker
                    icon={icon}
                    color=""
                    onChange={(s) => {
                      setIcon(s.icon)
                      saver.queue({ icon: s.icon })
                    }}
                  />
                ))
              }
            >
              <ItemIcon icon={icon} color="" fallback={FileText} />
            </button>
          )}
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
        </div>
        <div className="template-hint">
          {isCanvas(template.content) ? (
            <>
              A canvas: put fields, text and pictures anywhere and resize them. Each new ticket starts as a copy; fields linked to the ticket (like the
              customer) fill in by themselves.
            </>
          ) : template.kind === 'note' ? (
            <>
              New notes start as a copy of this. Type <kbd>/</kbd> for tables, callouts, checklists and fill-in fields.
            </>
          ) : (
            <>
              Type <kbd>/</kbd> → <strong>Form field</strong> to add a fill-in box, or <strong>Customer details</strong> for the customer’s name,
              phone, email and address. Use the gear on a field to change it. Values typed here become defaults for new tickets.
            </>
          )}
        </div>
        {template.kind === 'ticket' && <TicketLayoutPanel layout={template.layout} onChange={(layout) => saver.queue({ layout })} />}
        {isCanvas(template.content) ? (
          <CanvasDesigner doc={template.content!} onChange={onContent} />
        ) : (
          <NoteEditor docId={template.id} content={template.content} editable onChange={onContent} options={template.kind === 'ticket' ? TICKET_EDITOR : undefined} />
        )}
      </div>
    </div>
  )
}
