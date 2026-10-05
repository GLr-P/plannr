import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderPlus, Home, LayoutTemplate, CalendarDays, Lock, Wallet, Pin, Plus, Settings, Trash2, Users, Wrench } from 'lucide-react'
import { api } from '../api'
import { useData } from '../store/data'
import { go, useNav, type Route } from '../store/nav'
import { useUi } from '../store/ui'
import { DRAG_MIME, moveNote, newNote, newTicket, readDrag, type DragItem } from '../actions'
import { noteTitle } from '../lib/format'
import type { Folder as FolderT, NoteSummary } from '../../../shared/api'
import { ItemIcon } from '../lib/icons'
import { openMenu } from './ContextMenu'
import { folderMenu, noteMenu, renameFolder, renameNote, useRenaming } from '../menus'
import type { LucideIcon } from 'lucide-react'

/** Section of a detail page, so e.g. "Tickets" stays highlighted while a ticket is open. */
const SECTION: Partial<Record<Route['view'], Route['view']>> = { ticket: 'tickets', customer: 'customers', template: 'templates' }

function isActive(route: Route, target: Route): boolean {
  if (Object.keys(target).length === 1) return (SECTION[route.view] ?? route.view) === target.view
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
  onContextMenu?: (e: MouseEvent) => void
  /** Renamable in place: the id the right-click "Rename" sets, the current name and how to save a new one */
  rename?: { id: string; value: string; save: (name: string) => Promise<void> }
}) {
  const route = useNav((s) => s.route)
  const [over, setOver] = useState(false)
  const renaming = useRenaming((s) => props.rename !== undefined && s.id === props.rename.id)
  return (
    <div
      className={`nav-item ${isActive(route, props.target) ? 'active' : ''} ${over ? 'drop-over' : ''}`}
      style={{ paddingLeft: 8 + (props.indent ?? 0) * 14 }}
      role="button"
      tabIndex={0}
      onClick={() => !renaming && go(props.target)}
      onKeyDown={(e) => e.key === 'Enter' && !renaming && go(props.target)}
      onContextMenu={props.onContextMenu}
      draggable={!!props.draggable && !renaming}
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
      <span className="nav-icon">{props.icon}</span>
      {renaming && props.rename ? <RenameInput value={props.rename.value} save={props.rename.save} /> : <span className="nav-label">{props.label}</span>}
      {props.count !== undefined && <span className="nav-count">{props.count}</span>}
      {props.actions && (
        <span className="nav-actions" onClick={(e) => e.stopPropagation()}>
          {props.actions}
        </span>
      )}
    </div>
  )
}

function RenameInput({ value, save }: { value: string; save: (name: string) => Promise<void> }) {
  const [name, setName] = useState(value)
  const setRenaming = useRenaming((s) => s.set)
  const finished = useRef(false)
  const finish = async (keep: boolean): Promise<void> => {
    if (finished.current) return
    finished.current = true
    if (keep && name.trim() && name.trim() !== value) await save(name.trim())
    setRenaming(null)
  }
  return (
    <input
      autoFocus
      className="nav-input"
      value={name}
      aria-label="New name"
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => void finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') void finish(true)
        if (e.key === 'Escape') void finish(false)
      }}
    />
  )
}

function FolderNode({ folder, notes }: { folder: FolderT; notes: NoteSummary[] }) {
  const key = `folder:${folder.id}`
  const collapsed = useUi((s) => s.collapsed[key] ?? true)
  const setCollapsed = useUi((s) => s.setCollapsed)
  return (
    <>
      <NavItem
        icon={
          // Folder icon; on hover it becomes the expand/collapse chevron (keeps folders aligned with the rest).
          <button
            type="button"
            className="chevron folder-chevron"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed(key, !collapsed)
            }}
          >
            <ItemIcon icon={folder.icon} color={folder.color} fallback={Folder} className="when-idle" />
            {collapsed ? <ChevronRight className="when-hover" /> : <ChevronDown className="when-hover" />}
          </button>
        }
        label={folder.name}
        target={{ view: 'notes', filter: { kind: 'folder', id: folder.id } }}
        onDropItem={(item) => item.type === 'note' && void moveNote(item.id, folder.id)}
        onContextMenu={(e) => openMenu(e, folderMenu(folder))}
        rename={{ id: folder.id, value: folder.name, save: (name) => renameFolder(folder.id, name) }}
        actions={
          <button type="button" className="icon-btn sm" title="New note in folder" onClick={() => void newNote(folder.id)}>
            <Plus />
          </button>
        }
      />
      {!collapsed &&
        (notes.length ? (
          notes.map((n) => <NoteNode key={n.id} note={n} place="folder" indent={1} />)
        ) : (
          <div className="nav-empty" style={{ paddingLeft: 8 + 14 + 22 }}>
            Empty — drag notes here
          </div>
        ))}
    </>
  )
}

/** `place` tells apart the same note shown twice (e.g. pinned and in its folder) when renaming in place. */
function NoteNode({ note, place, indent = 1, fallback = FileText }: { note: NoteSummary; place: string; indent?: number; fallback?: LucideIcon }) {
  const renameKey = `${place}:${note.id}`
  return (
    <NavItem
      icon={<ItemIcon icon={note.icon} color={note.color} fallback={fallback} />}
      label={noteTitle(note.title)}
      target={{ view: 'note', id: note.id }}
      indent={indent}
      draggable={{ type: 'note', id: note.id }}
      onContextMenu={(e) => openMenu(e, noteMenu(note, { renameKey }))}
      rename={{ id: renameKey, value: note.title, save: (title) => renameNote(note.id, title) }}
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
    <div className="nav-item editing" style={{ paddingLeft: 8 }}>
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

/** A small collapsible group (Pinned, Recent, Folders): a quiet label, items at the same indent as the main nav. */
function SidebarGroup({ id, title, actions, children }: { id: string; title: string; actions?: ReactNode; children: ReactNode }) {
  const collapsed = useUi((s) => s.collapsed[`section:${id}`] ?? false)
  const toggle = useUi((s) => s.toggle)
  return (
    <div className="sidebar-group">
      <div className="section-header">
        <button type="button" className="section-toggle" aria-expanded={!collapsed} onClick={() => toggle(`section:${id}`)}>
          {title}
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
        {actions && <span className="section-actions">{actions}</span>}
      </div>
      {!collapsed && children}
    </div>
  )
}

export function Sidebar() {
  const notes = useData((s) => s.notes)
  const folders = useData((s) => s.folders)
  const openTickets = useData((s) => s.counts.open)
  const showRecent = useUi((s) => s.prefs.sidebarRecent === '1')
  const [addingFolder, setAddingFolder] = useState(false)
  const pinned = notes.filter((n) => n.pinned)
  const recent = notes
    .filter((n) => !n.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  return (
    <nav className="sidebar" aria-label="Main">
      <NavItem icon={<Home />} label="Home" target={{ view: 'home' }} />
      <NavItem
        icon={<Wrench />}
        label="Tickets"
        target={{ view: 'tickets' }}
        count={openTickets || undefined}
        actions={
          <button type="button" className="icon-btn sm" title="New ticket" aria-label="New ticket" onClick={() => void newTicket()}>
            <Plus />
          </button>
        }
      />
      <NavItem icon={<Users />} label="Customers" target={{ view: 'customers' }} />
      <NavItem icon={<CalendarDays />} label="Calendar" target={{ view: 'calendar' }} />
      <NavItem icon={<Wallet />} label="Money" target={{ view: 'money' }} />
      <NavItem icon={<Lock />} label="Vault" target={{ view: 'vault' }} />
      <NavItem
        icon={<FileText />}
        label="Notes"
        target={{ view: 'notes', filter: { kind: 'all' } }}
        count={notes.length || undefined}
        onDropItem={(item) => item.type === 'note' && void moveNote(item.id, null)}
        actions={
          <>
            <button type="button" className="icon-btn sm" title="New folder" aria-label="New folder" onClick={() => setAddingFolder(true)}>
              <FolderPlus />
            </button>
            <button type="button" className="icon-btn sm" title="New note (Ctrl+N)" aria-label="New note" onClick={() => void newNote()}>
              <Plus />
            </button>
          </>
        }
      />

      {pinned.length > 0 && (
        <SidebarGroup id="pinned" title="Pinned">
          {pinned.map((n) => (
            <NoteNode key={n.id} note={n} place="pinned" indent={0} fallback={Pin} />
          ))}
        </SidebarGroup>
      )}

      {showRecent && recent.length > 0 && (
        <SidebarGroup id="recent" title="Recent">
          {recent.map((n) => (
            <NoteNode key={n.id} note={n} place="recent" indent={0} />
          ))}
        </SidebarGroup>
      )}

      {(folders.length > 0 || addingFolder) && (
        <SidebarGroup
          id="folders"
          title="Folders"
          actions={
            <button type="button" className="icon-btn sm" title="New folder" aria-label="New folder" onClick={() => setAddingFolder(true)}>
              <FolderPlus />
            </button>
          }
        >
          {folders.map((f) => (
            <FolderNode key={f.id} folder={f} notes={notes.filter((n) => n.folderId === f.id)} />
          ))}
          {addingFolder && <NewFolderInput onDone={() => setAddingFolder(false)} />}
        </SidebarGroup>
      )}

      <div className="sidebar-spacer" />
      <NavItem icon={<LayoutTemplate />} label="Templates" target={{ view: 'templates' }} />
      <NavItem icon={<Trash2 />} label="Trash" target={{ view: 'notes', filter: { kind: 'trash' } }} />
      <NavItem icon={<Settings />} label="Settings" target={{ view: 'settings' }} />
    </nav>
  )
}
