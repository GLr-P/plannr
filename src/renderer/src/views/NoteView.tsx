import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { FileText, Pin, PinOff, RotateCcw, Trash2, X, Move, PencilLine, ListTree, History, Copy, Printer } from 'lucide-react'
import type { DocJSON, Note, NoteUpdate } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { moveNote, togglePin, trashNote, duplicateNote } from '../actions'
import { useAutosave } from '../lib/useAutosave'
import { SaveIndicator } from '../components/common'
import { Backlinks } from '../components/Backlinks'
import { LinkedEvents } from '../components/LinkedEvents'
import { NoteEditor } from '../editor/NoteEditor'
import { CanvasDesigner } from '../canvas/CanvasDesigner'
import { CanvasView } from '../canvas/CanvasView'
import { isCanvas } from '../../../shared/canvas'
import { headingsOf, scrollToHeading, type Heading } from '../editor/Blocks'
import { relativeTime } from '../lib/format'
import type { NoteVersion } from '../../../shared/api'
import { IconPicker, openPanel } from '../components/ContextMenu'
import { ItemIcon } from '../lib/icons'
import { styleNote } from '../menus'
import { openPrint } from '../components/PrintPreview'

export function NoteView({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null | undefined>(undefined)
  const reload = useCallback(() => api.notes.get(id).then(setNote), [id])
  useEffect(() => {
    let cancelled = false
    setNote(undefined)
    void api.notes.get(id).then((n) => !cancelled && setNote(n))
    return () => {
      cancelled = true
    }
  }, [id])

  if (note === undefined) return <div className="page" />
  if (note === null)
    return (
      <div className="page empty-state">
        <p>This note doesn’t exist anymore.</p>
        <button type="button" className="btn" onClick={() => go({ view: 'home' })}>
          Go home
        </button>
      </div>
    )
  return <NotePage key={`${note.id}:${note.deletedAt}`} note={note} reload={reload} />
}

function NotePage({ note, reload }: { note: Note; reload: () => Promise<void> }) {
  const folders = useData((s) => s.folders)
  const live = useData((s) => s.notes.find((n) => n.id === note.id))
  const [title, setTitle] = useState(note.title)
  const [tags, setTags] = useState(note.tags)
  const [tagInput, setTagInput] = useState('')
  const editorRef = useRef<Editor | null>(null)
  const { queue, status } = useAutosave<NoteUpdate>(async (patch) => {
    useData.getState().upsertNote(await api.notes.update(note.id, patch))
  })
  const trashed = note.deletedAt !== null
  const pinned = live?.pinned ?? note.pinned
  const folderId = live ? live.folderId : note.folderId
  const updatedAt = live?.updatedAt ?? note.updatedAt
  const icon = live?.icon ?? note.icon
  const color = live?.color ?? note.color

  const onTitle = (value: string): void => {
    setTitle(value)
    queue({ title: value })
    if (live) useData.getState().upsertNote({ ...live, title: value })
  }

  const addTag = (): void => {
    const tag = tagInput.trim().replace(/^#/, '')
    setTagInput('')
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    const next = [...tags, tag]
    setTags(next)
    queue({ tags: next })
  }

  const removeTag = (tag: string): void => {
    const next = tags.filter((t) => t !== tag)
    setTags(next)
    queue({ tags: next })
  }

  const [words, setWords] = useState(() => countWords(note.content))
  const [outline, setOutline] = useState(false)
  const [history, setHistory] = useState(false)
  const [headings, setHeadings] = useState<Heading[]>([])
  const onChange = useCallback(
    (doc: DocJSON) => {
      queue({ content: doc })
      setWords(countWords(doc))
    },
    [queue]
  )
  // Free-form pages: Arrange moves and resizes things; Fill in types into the fields. A page with fields opens to fill in.
  const canvas = isCanvas(note.content)
  const [canvasDoc, setCanvasDoc] = useState<DocJSON | null>(canvas ? note.content : null)
  const [arrange, setArrange] = useState(() => canvas && !(note.content?.content ?? []).some((it) => it.type === 'formField'))
  const onCanvas = useCallback(
    (doc: DocJSON) => {
      setCanvasDoc(doc)
      queue({ content: doc })
    },
    [queue]
  )
  const onReady = useCallback((editor: Editor) => {
    editorRef.current = editor
    const update = (): void => setHeadings(headingsOf(editor.state.doc))
    update()
    editor.on('update', update)
  }, [])

  const restore = async (): Promise<void> => {
    await api.notes.restore(note.id)
    await useData.getState().refresh()
    await reload()
  }

  const destroy = async (): Promise<void> => {
    await api.notes.destroy(note.id)
    go({ view: 'notes', filter: { kind: 'trash' } })
  }

  return (
    <div className="page note-page">
      <div className="page-toolbar">
        <div className="crumbs">
          {trashed ? (
            <span>Trash</span>
          ) : (
            <select
              className="folder-select"
              value={folderId ?? ''}
              onChange={(e) => void moveNote(note.id, e.target.value || null)}
              aria-label="Folder"
              title="Move to folder"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="toolbar-right">
          <SaveIndicator status={status} updatedAt={updatedAt} />
          {!trashed && (
            <>
              <button
                type="button"
                className={`icon-btn ${pinned ? 'active' : ''}`}
                title={pinned ? 'Unpin' : 'Pin to sidebar'}
                aria-label={pinned ? 'Unpin' : 'Pin'}
                onClick={() => void togglePin(note.id, !pinned)}
              >
                {pinned ? <PinOff /> : <Pin />}
              </button>
              {!canvas && (
                <button type="button" className={`icon-btn ${outline ? 'active' : ''}`} title="Outline: the note’s headings" aria-label="Outline" aria-pressed={outline} onClick={() => setOutline((o) => !o)}>
                  <ListTree />
                </button>
              )}
              <button type="button" className="icon-btn" title="Earlier versions" aria-label="Earlier versions" onClick={() => setHistory(true)}>
                <History />
              </button>
              <button type="button" className="icon-btn" title="Duplicate this note" aria-label="Duplicate note" onClick={() => void duplicateNote(note.id)}>
                <Copy />
              </button>
              <button type="button" className="icon-btn" title="Print, or save as PDF" aria-label="Print note" onClick={() => void openPrint({ title: title || 'Untitled', bodyClass: 'printing-note' })}>
                <Printer />
              </button>
              <button type="button" className="icon-btn" title="Move to trash" aria-label="Move to trash" onClick={() => void trashNote(note.id)}>
                <Trash2 />
              </button>
            </>
          )}
        </div>
      </div>

      {trashed && (
        <div className="banner">
          This note is in the trash.
          <button type="button" className="btn sm" onClick={() => void restore()}>
            <RotateCcw /> Restore
          </button>
          <button type="button" className="btn sm danger" onClick={() => void destroy()}>
            Delete forever
          </button>
        </div>
      )}

      <div className="doc">
        <div className="doc-title-row">
          {!trashed && (
            <button
              type="button"
              className={`doc-icon ${icon || color ? '' : 'unset'}`}
              title="Change icon"
              aria-label="Change icon"
              onClick={(e) =>
                openPanel(e.currentTarget, 'Icon & colour', () => <IconPicker icon={icon} color={color} onChange={(s) => void styleNote(note.id, s)} />)
              }
            >
              <ItemIcon icon={icon} color={color} fallback={FileText} />
            </button>
          )}
          <input
          className="doc-title"
          value={title}
          placeholder="Untitled"
          readOnly={trashed}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
              e.preventDefault()
              const editor = editorRef.current
              if (!editor) return
              // commands.focus() waits a frame; focus the DOM now so fast typing isn't lost to the title.
              editor.view.focus()
              editor.commands.focus('start')
            }
          }}
          aria-label="Title"
          autoFocus={!note.title && !trashed}
        />
        </div>

        <div className="tags">
          {tags.map((t) => (
            <span key={t} className="tag">
              <button type="button" className="tag-label" onClick={() => go({ view: 'notes', filter: { kind: 'tag', tag: t } })}>
                #{t}
              </button>
              {!trashed && (
                <button type="button" className="tag-remove" aria-label={`Remove tag ${t}`} onClick={() => removeTag(t)}>
                  <X />
                </button>
              )}
            </span>
          ))}
          {!trashed && (
            <input
              className="tag-input"
              placeholder={tags.length ? '+ tag' : '+ Add tag'}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onBlur={addTag}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag()
                }
                if (e.key === 'Backspace' && !tagInput && tags.length) removeTag(tags[tags.length - 1])
              }}
              aria-label="Add tag"
            />
          )}
        </div>

        {canvas && canvasDoc ? (
          <>
            {!trashed && (
              <div className="note-canvas-mode" role="radiogroup" aria-label="Page mode">
                <button type="button" role="radio" aria-checked={arrange} className={`chip-btn ${arrange ? 'active' : ''}`} onClick={() => setArrange(true)}>
                  <Move /> Arrange
                </button>
                <button type="button" role="radio" aria-checked={!arrange} className={`chip-btn ${!arrange ? 'active' : ''}`} onClick={() => setArrange(false)}>
                  <PencilLine /> Fill in
                </button>
                <span className="muted small">{arrange ? 'Add things from the bar, drag to move, drag corners to resize.' : 'Type into the fields. Switch to Arrange to change the layout.'}</span>
              </div>
            )}
            {arrange && !trashed ? (
              <CanvasDesigner key="arrange" doc={canvasDoc} onChange={onCanvas} forTicket={false} />
            ) : (
              <CanvasView key="fill" doc={canvasDoc} editable={!trashed} onChange={onCanvas} />
            )}
          </>
        ) : (
          <NoteEditor docId={note.id} content={note.content} editable={!trashed} onChange={onChange} onReady={onReady} />
        )}

        {words > 0 && (
          <div className="note-words small muted">
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 230))} min read
          </div>
        )}
        {outline && !canvas && (
          <aside className="note-outline" aria-label="Outline">
            <div className="note-outline-title">Outline</div>
            {headings.length === 0 && <div className="muted small">No headings yet. Type / then Heading.</div>}
            {headings.map((h, i) => (
              <button key={i} type="button" className={`note-outline-item l${h.level}`} onClick={() => editorRef.current && scrollToHeading(editorRef.current, h.pos)}>
                {h.text}
              </button>
            ))}
          </aside>
        )}
        {history && (
          <VersionHistory
            noteId={note.id}
            onClose={() => setHistory(false)}
            onRestored={async () => {
              setHistory(false)
              await reload()
            }}
          />
        )}
        <LinkedEvents id={note.id} />
        <Backlinks id={note.id} />
      </div>
    </div>
  )
}

/** Words in a note (text, fields and canvas text) */
function countWords(doc: DocJSON | null | undefined): number {
  let n = 0
  const walk = (node: DocJSON): void => {
    const text = node.type === 'text' ? node.text : node.type === 'canvasText' ? String(node.attrs?.text ?? '') : ''
    if (text) n += text.split(/\s+/).filter(Boolean).length
    node.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return n
}

/** Earlier versions of the note: pick one to see it, and bring it back */
function VersionHistory({ noteId, onClose, onRestored }: { noteId: string; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null)
  const [pick, setPick] = useState<NoteVersion | null>(null)
  useEffect(() => {
    void api.notes.versions(noteId).then((v) => {
      setVersions(v)
      setPick(v[0] ?? null)
    })
  }, [noteId])
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog version-dialog" role="dialog" aria-label="Earlier versions" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Earlier versions</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        {versions && versions.length === 0 && <p className="muted">No earlier versions yet. While you edit, Plannr keeps one every 10 minutes (the last 50).</p>}
        {versions && versions.length > 0 && (
          <div className="version-body">
            <ul className="version-list">
              {versions.map((v) => (
                <li key={v.id}>
                  <button type="button" className={pick?.id === v.id ? 'on' : ''} onClick={() => setPick(v)}>
                    <b>{new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
                    <span className="small muted">
                      {relativeTime(v.createdAt)} · {v.words} words
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="version-preview prose">
              {pick && (
                <>
                  <h3>{pick.title || 'Untitled'}</h3>
                  {isCanvas(pick.content) ? <p className="muted">A free-form page.</p> : <NoteEditor key={pick.id} docId={`version-${pick.id}`} content={pick.content} editable={false} onChange={() => undefined} />}
                </>
              )}
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={!pick} onClick={() => pick && void api.notes.restoreVersion(pick.id).then(onRestored)}>
            Bring this version back
          </button>
        </div>
      </div>
    </div>
  )
}
