import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Pin, PinOff, RotateCcw, Trash2, X } from 'lucide-react'
import type { DocJSON, Note, NoteUpdate } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { moveNote, togglePin, trashNote } from '../actions'
import { useAutosave } from '../lib/useAutosave'
import { SaveIndicator } from '../components/common'
import { Backlinks } from '../components/Backlinks'
import { LinkedEvents } from '../components/LinkedEvents'
import { NoteEditor } from '../editor/NoteEditor'

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

  const onChange = useCallback((doc: DocJSON) => queue({ content: doc }), [queue])
  const onReady = useCallback((editor: Editor) => {
    editorRef.current = editor
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

        <NoteEditor
          docId={note.id}
          content={note.content}
          editable={!trashed}
          onChange={onChange}
          onReady={onReady}
        />

        <LinkedEvents id={note.id} />
        <Backlinks id={note.id} />
      </div>
    </div>
  )
}
