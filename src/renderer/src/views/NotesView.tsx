import { useEffect, useMemo, useState } from 'react'
import { useUi } from '../store/ui'
import { FileText, Pin, PinOff, RotateCcw, Search, Trash2, X } from 'lucide-react'
import type { NoteSummary } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go, type NotesFilter } from '../store/nav'
import { DRAG_MIME, togglePin, trashNote } from '../actions'
import { noteTitle, relativeTime } from '../lib/format'
import { ConfirmButton } from '../components/common'
import { openMenu } from '../components/ContextMenu'
import { ItemIcon } from '../lib/icons'
import { noteMenu } from '../menus'
import { NewNoteButton } from '../components/NewNoteButton'

export function NotesView({ filter }: { filter: NotesFilter }) {
  const allNotes = useData((s) => s.notes)
  const folders = useData((s) => s.folders)
  const [trash, setTrash] = useState<NoteSummary[]>([])
  const [query, setQuery] = useState('')
  const sort = useUi((s) => s.prefs.notesSort) || 'updated'
  const cards = useUi((s) => s.prefs.notesView) === 'cards'
  const setPref = useUi((s) => s.setPref)
  const [tag, setTag] = useState('')
  const isTrash = filter.kind === 'trash'
  const allTags = useMemo(() => [...new Set(allNotes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)), [allNotes])
  const folder = filter.kind === 'folder' ? folders.find((f) => f.id === filter.id) : undefined

  useEffect(() => setQuery(''), [filter])
  useEffect(() => {
    if (isTrash) void api.notes.list({ trashed: true }).then(setTrash)
  }, [isTrash, allNotes])

  const notes = useMemo(() => {
    let list = isTrash ? trash : allNotes
    if (filter.kind === 'folder') list = list.filter((n) => n.folderId === filter.id)
    if (filter.kind === 'tag') list = list.filter((n) => n.tags.some((t) => t.toLowerCase() === filter.tag.toLowerCase()))
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((n) => `${n.title} ${n.preview} ${n.tags.join(' ')}`.toLowerCase().includes(q))
    if (tag) list = list.filter((n) => n.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
    const by: Record<string, (a: NoteSummary, b: NoteSummary) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      title: (a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled')
    }
    list = [...list].sort(by[sort] ?? by.updated)
    return list
  }, [allNotes, trash, filter, query, isTrash, sort, tag])

  const title =
    filter.kind === 'all' ? 'All notes' : filter.kind === 'trash' ? 'Trash' : filter.kind === 'tag' ? `#${filter.tag}` : (folder?.name ?? 'Folder')

  const refreshTrash = async (): Promise<void> => {
    setTrash(await api.notes.list({ trashed: true }))
    await useData.getState().refresh()
  }

  return (
    <div className="page list-page">
      <div className="list-header">
        {folder ? <FolderTitle id={folder.id} name={folder.name} /> : <h1>{title}</h1>}
        <div className="list-header-actions">
          {folder && <DeleteFolderButton id={folder.id} />}
          {!isTrash && (
            <NewNoteButton primary folderId={filter.kind === 'folder' ? filter.id : null} />
          )}
        </div>
      </div>

      <div className="filter-field">
        <Search />
        <input placeholder={`Filter ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter notes" />
        {query && (
          <button type="button" className="icon-btn sm" aria-label="Clear filter" onClick={() => setQuery('')}>
            <X />
          </button>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="empty-state">
          {isTrash ? 'Trash is empty.' : query ? 'No notes match that filter.' : 'No notes here yet.'}
        </div>
      ) : (
        <>
        <div className="notes-tools">
          <select aria-label="Sort notes" value={sort} onChange={(e) => setPref('notesSort', e.target.value === 'updated' ? '' : e.target.value)}>
            <option value="updated">Recently edited</option>
            <option value="created">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">A–Z</option>
          </select>
          <div className="segmented" role="radiogroup" aria-label="Show as">
            <button type="button" role="radio" aria-checked={!cards} className={!cards ? 'active' : ''} onClick={() => setPref('notesView', '')}>
              List
            </button>
            <button type="button" role="radio" aria-checked={cards} className={cards ? 'active' : ''} onClick={() => setPref('notesView', 'cards')}>
              Cards
            </button>
          </div>
          {allTags.length > 0 && filter.kind !== 'tag' && (
            <div className="notes-tags">
              {allTags.slice(0, 12).map((t) => (
                <button key={t} type="button" className={`chip-btn ${tag === t ? 'active' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className={`note-list ${cards ? 'cards' : ''}`}>
          {notes.map((n) => (
            <li
              key={n.id}
              className="note-row"
              draggable={!isTrash}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: 'note', id: n.id }))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => go({ view: 'note', id: n.id })}
              onContextMenu={isTrash ? undefined : (e) => openMenu(e, noteMenu(n))}
            >
              <ItemIcon icon={n.icon} color={n.color} fallback={FileText} className="note-row-icon" />
              <div className="note-row-main">
                <div className="note-row-title">
                  {n.pinned && <Pin className="pin-mark" />}
                  {noteTitle(n.title)}
                </div>
                {n.preview && <div className="note-row-preview">{n.preview.replace(/\n/g, ' · ')}</div>}
                {(n.tags.length > 0 || (filter.kind !== 'folder' && n.folderId)) && (
                  <div className="note-row-meta">
                    {filter.kind !== 'folder' && n.folderId && (
                      <span className="chip">{folders.find((f) => f.id === n.folderId)?.name}</span>
                    )}
                    {n.tags.map((t) => (
                      <span key={t} className="chip tag-chip">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="note-row-side">
                <span className="note-row-date">{relativeTime(isTrash && n.deletedAt ? n.deletedAt : n.updatedAt)}</span>
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  {isTrash ? (
                    <>
                      <button
                        type="button"
                        className="icon-btn sm"
                        title="Restore"
                        aria-label="Restore"
                        onClick={async () => {
                          await api.notes.restore(n.id)
                          await refreshTrash()
                        }}
                      >
                        <RotateCcw />
                      </button>
                      <ConfirmButton
                        title="Delete forever"
                        onConfirm={async () => {
                          await api.notes.destroy(n.id)
                          await refreshTrash()
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="icon-btn sm"
                        title={n.pinned ? 'Unpin' : 'Pin'}
                        aria-label={n.pinned ? 'Unpin' : 'Pin'}
                        onClick={() => void togglePin(n.id, !n.pinned)}
                      >
                        {n.pinned ? <PinOff /> : <Pin />}
                      </button>
                      <button type="button" className="icon-btn sm" title="Move to trash" aria-label="Move to trash" onClick={() => void trashNote(n.id)}>
                        <Trash2 />
                      </button>
                    </>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  )
}

function DeleteFolderButton({ id }: { id: string }) {
  return (
    <ConfirmButton
      title="Delete folder (notes are kept)"
      label="Delete folder"
      onConfirm={async () => {
        await api.folders.remove(id)
        await useData.getState().refresh()
        go({ view: 'notes', filter: { kind: 'all' } })
      }}
    />
  )
}

function FolderTitle({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  const save = async (): Promise<void> => {
    if (value.trim() && value.trim() !== name) {
      await api.folders.rename(id, value)
      await useData.getState().refresh()
    } else setValue(name)
  }
  return (
    <input
      className="list-title-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="Folder name"
      title="Click to rename"
    />
  )
}
