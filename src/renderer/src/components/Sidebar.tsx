import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderPlus, Home, Pin, Plus, Settings, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useData } from '../store/data'
import { go, useNav, type Route } from '../store/nav'
import { useUi } from '../store/ui'
import { DRAG_MIME, moveNote, newNote, readDrag, type DragItem } from '../actions'
import { noteTitle } from '../lib/format'
import type { Folder as FolderT, NoteSummary } from '../../../shared/api'

function isActive(route: Route, target: Route): boolean {
  return JSON.stringify(route) === JSON.stringify(target)
}

function NavItem(props: {
  icon: ReactNode
  label: string
  target: Route
  count?: number
  indent?: number
  draggable?: DragItem
  onDropItem?: (item: DragItem) => void
  actions?: ReactNode
  chevron?: ReactNode
}) {
  const route = useNav((s) => s.route)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`nav-item ${isActive(route, props.target) ? 'active' : ''} ${over ? 'drop-over' : ''}`}
      style={{ paddingLeft: 8 + (props.indent ?? 0) * 14 }}
      role="button"
      tabIndex={0}
      onClick={() => go(props.target)}
      onKeyDown={(e) => e.key === 'Enter' && go(props.target)}
      draggable={!!props.draggable}
      onDragStart={(e) => {
        if (!props.draggable) return
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(props.draggable))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (props.onDropItem && e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const item = readDrag(e)
        if (item && props.onDropItem) {
          e.preventDefault()
          props.onDropItem(item)
        }
      }}
    >
      {props.chevron}
      <span className="nav-icon">{props.icon}</span>
      <span className="nav-label">{props.label}</span>
      {props.count !== undefined && <span className="nav-count">{props.count}</span>}
      {props.actions && (
        <span className="nav-actions" onClick={(e) => e.stopPropagation()}>
          {props.actions}
        </span>
      )}
    </div>
  )
}

function FolderNode({ folder, notes }: { folder: FolderT; notes: NoteSummary[] }) {
  const key = `folder:${folder.id}`
  const collapsed = useUi((s) => s.collapsed[key] ?? true)
  const toggle = useUi((s) => s.toggle)
  return (
    <>
      <NavItem
        icon={<Folder />}
        label={folder.name}
        target={{ view: 'notes', filter: { kind: 'folder', id: folder.id } }}
        chevron={
          <button
            type="button"
            className="chevron"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation()
              toggle(key)
            }}
          >
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </button>
        }
        onDropItem={(item) => item.type === 'note' && void moveNote(item.id, folder.id)}
        actions={
          <button type="button" className="icon-btn sm" title="New note in folder" onClick={() => void newNote(folder.id)}>
            <Plus />
          </button>
        }
      />
      {!collapsed &&
        (notes.length ? (
          notes.map((n) => <NoteNode key={n.id} note={n} indent={2} />)
        ) : (
          <div className="nav-empty" style={{ paddingLeft: 8 + 2 * 14 }}>
            Empty — drag notes here
          </div>
        ))}
    </>
  )
}

function NoteNode({ note, indent = 1 }: { note: NoteSummary; indent?: number }) {
  return (
    <NavItem
      icon={<FileText />}
      label={noteTitle(note.title)}
      target={{ view: 'note', id: note.id }}
      indent={indent}
      draggable={{ type: 'note', id: note.id }}
    />
  )
}

function NewFolderInput({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const submit = async (): Promise<void> => {
    if (name.trim()) {
      await api.folders.create(name)
      await useData.getState().refresh()
    }
    onDone()
  }
  return (
    <div className="nav-item editing" style={{ paddingLeft: 8 + 14 }}>
      <span className="nav-icon">
        <Folder />
      </span>
      <input
        autoFocus
        className="nav-input"
        placeholder="Folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onDone()
        }}
      />
    </div>
  )
}

export function Sidebar() {
  const notes = useData((s) => s.notes)
  const folders = useData((s) => s.folders)
  const notesCollapsed = useUi((s) => s.collapsed['section:notes'] ?? false)
  const toggle = useUi((s) => s.toggle)
  const [addingFolder, setAddingFolder] = useState(false)
  const pinned = notes.filter((n) => n.pinned)
  const recent = notes
    .filter((n) => !n.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  return (
    <nav className="sidebar" aria-label="Main">
      <NavItem icon={<Home />} label="Home" target={{ view: 'home' }} />

      <div className="section-header">
        <button type="button" className="section-toggle" onClick={() => toggle('section:notes')}>
          {notesCollapsed ? <ChevronRight /> : <ChevronDown />}
          Notes
        </button>
        <span className="section-actions">
          <button type="button" className="icon-btn sm" title="New folder" aria-label="New folder" onClick={() => setAddingFolder(true)}>
            <FolderPlus />
          </button>
          <button type="button" className="icon-btn sm" title="New note (Ctrl+N)" aria-label="New note" onClick={() => void newNote()}>
            <Plus />
          </button>
        </span>
      </div>

      {!notesCollapsed && (
        <>
          <NavItem
            icon={<FileText />}
            label="All notes"
            target={{ view: 'notes', filter: { kind: 'all' } }}
            count={notes.length}
            indent={1}
            onDropItem={(item) => item.type === 'note' && void moveNote(item.id, null)}
          />
          {pinned.length > 0 && <div className="nav-subheading">Pinned</div>}
          {pinned.map((n) => (
            <NavItem
              key={n.id}
              icon={<Pin />}
              label={noteTitle(n.title)}
              target={{ view: 'note', id: n.id }}
              indent={1}
              draggable={{ type: 'note', id: n.id }}
            />
          ))}
          {recent.length > 0 && <div className="nav-subheading">Recent</div>}
          {recent.map((n) => (
            <NoteNode key={n.id} note={n} />
          ))}
          {(folders.length > 0 || addingFolder) && <div className="nav-subheading">Folders</div>}
          {folders.map((f) => (
            <FolderNode key={f.id} folder={f} notes={notes.filter((n) => n.folderId === f.id)} />
          ))}
          {addingFolder && <NewFolderInput onDone={() => setAddingFolder(false)} />}
          <NavItem icon={<Trash2 />} label="Trash" target={{ view: 'notes', filter: { kind: 'trash' } }} indent={1} />
        </>
      )}

      <div className="sidebar-spacer" />
      <NavItem icon={<Settings />} label="Settings" target={{ view: 'settings' }} />
    </nav>
  )
}
