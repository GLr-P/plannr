import { useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Home,
  LayoutTemplate,
  Lock,
  Pin,
  Plus,
  Settings,
  Trash2,
  Users,
  Wallet,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { Folder as FolderT, NoteSummary, SidebarDest, SidebarSection } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go, useNav, type Route } from '../store/nav'
import { useUi } from '../store/ui'
import { DRAG_MIME, newNote, newTicket, readDrag } from '../actions'
import { noteTitle } from '../lib/format'
import { ItemIcon } from '../lib/icons'
import { childrenOf, isWithin, placeItem, placeNextTo, useAddingFolder, useSidebarDrag, type Dragging, type Entry } from '../lib/sidebarTree'
import { openMenu } from './ContextMenu'
import { navHidden, navOrder, type NavId } from '../lib/navOrder'
import { folderMenu, newSection, noteMenu, renameFolder, renameNote, sectionMenu, sidebarMenu, useRenaming } from '../menus'

/** Section of a detail page, so e.g. "Tickets" stays highlighted while a ticket is open. */
const SECTION: Partial<Record<Route['view'], Route['view']>> = { ticket: 'tickets', customer: 'customers', template: 'templates' }

function isActive(route: Route, target: Route): boolean {
  if (Object.keys(target).length === 1) return (SECTION[route.view] ?? route.view) === target.view
  return JSON.stringify(route) === JSON.stringify(target)
}

type Zone = 'before' | 'after' | 'inside'
const SIDEBAR_MIME = 'application/x-plannr-sidebar'

/** What's being dragged over: something from the sidebar, or a note dragged in from a list (id read on drop). */
function draggingNow(e: DragEvent): NonNullable<Dragging> | null {
  const d = useSidebarDrag.getState().dragging
  if (d) return d
  return e.dataTransfer.types.includes(DRAG_MIME) ? { kind: 'note', id: '' } : null
}

/** Picks the drop zone from where the pointer is over the row: top edge, bottom edge or middle. */
function zoneAt(e: DragEvent, zones: Zone[]): Zone {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = (e.clientY - r.top) / r.height
  if (zones.includes('inside') && (zones.length === 1 || (y > 0.28 && y < 0.72))) return 'inside'
  return y < 0.5 ? 'before' : 'after'
}

/** Drag-and-drop wiring shared by rows and section headers. */
function useDrop(accepts: ((d: NonNullable<Dragging>) => Zone[]) | undefined, onDrop: ((d: NonNullable<Dragging>, zone: Zone) => void) | undefined) {
  const [zone, setZone] = useState<Zone | null>(null)
  if (!accepts || !onDrop) return { zone: null, handlers: {} }
  return {
    zone,
    handlers: {
      onDragOver: (e: DragEvent) => {
        const d = draggingNow(e)
        const zones = d ? accepts(d) : []
        if (!zones.length) return
        e.preventDefault()
        e.stopPropagation()
        setZone(zoneAt(e, zones))
      },
      onDragLeave: () => setZone(null),
      onDrop: (e: DragEvent) => {
        const d = draggingNow(e)
        const zones = d ? accepts(d) : []
        setZone(null)
        if (!d || !zones.length) return
        e.preventDefault()
        e.stopPropagation()
        const id = d.id || readDrag(e)?.id || ''
        if (id) onDrop({ ...d, id }, zoneAt(e, zones))
      }
    }
  }
}

function startDrag(e: DragEvent, d: NonNullable<Dragging>): void {
  e.stopPropagation()
  useSidebarDrag.getState().set(d)
  // Notes keep the shared payload so they can also be dropped on the calendar.
  if (d.kind === 'note') e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: 'note', id: d.id }))
  else e.dataTransfer.setData(SIDEBAR_MIME, JSON.stringify(d))
  e.dataTransfer.effectAllowed = 'move'
}
const endDrag = (): void => useSidebarDrag.getState().set(null)

function NavItem(props: {
  icon: ReactNode
  label: string
  target: Route
  count?: number
  indent?: number
  drag?: NonNullable<Dragging>
  accepts?: (d: NonNullable<Dragging>) => Zone[]
  onDrop?: (d: NonNullable<Dragging>, zone: Zone) => void
  actions?: ReactNode
  onContextMenu?: (e: MouseEvent) => void
  /** Renamable in place: the id the right-click "Rename" sets, the current name and how to save a new one */
  rename?: { id: string; value: string; save: (name: string) => Promise<void> }
}) {
  const route = useNav((s) => s.route)
  const renaming = useRenaming((s) => props.rename !== undefined && s.id === props.rename.id)
  const { zone, handlers } = useDrop(props.accepts, props.onDrop)
  return (
    <div
      className={`nav-item ${isActive(route, props.target) ? 'active' : ''} ${zone ? `drop-${zone}` : ''}`}
      style={{ paddingLeft: 8 + (props.indent ?? 0) * 14 }}
      role="button"
      tabIndex={0}
      onClick={() => !renaming && go(props.target)}
      onKeyDown={(e) => e.key === 'Enter' && !renaming && go(props.target)}
      onContextMenu={props.onContextMenu}
      draggable={!!props.drag && !renaming}
      onDragStart={props.drag ? (e) => startDrag(e, props.drag!) : undefined}
      onDragEnd={endDrag}
      {...handlers}
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

/** Drop rules for an item row: before/after it (same place), or inside it if it's a folder. */
function rowDrop(entry: Entry, dest: SidebarDest, folders: FolderT[]) {
  const self = entry.type === 'note' ? { type: 'note' as const, id: entry.note.id } : { type: 'folder' as const, id: entry.folder.id }
  const destFolder = 'folderId' in dest ? dest.folderId : null
  const accepts = (d: NonNullable<Dragging>): Zone[] => {
    if (d.kind !== 'note' && d.kind !== 'folder') return []
    if (d.kind === self.type && d.id === self.id) return []
    // A folder can't go next to/inside something within itself.
    if (d.kind === 'folder' && isWithin(folders, destFolder, d.id)) return []
    const intoFolder = entry.type === 'folder' && !(d.kind === 'folder' && isWithin(folders, entry.folder.id, d.id))
    return intoFolder ? ['before', 'inside', 'after'] : ['before', 'after']
  }
  const onDrop = (d: NonNullable<Dragging>, zone: Zone): void => {
    const item = { type: d.kind as 'note' | 'folder', id: d.id }
    if (zone === 'inside' && entry.type === 'folder') void placeItem(item, { folderId: entry.folder.id })
    else void placeNextTo(item, self, dest, zone === 'after')
  }
  return { accepts, onDrop }
}

function FolderNode({ folder, dest, indent }: { folder: FolderT; dest: SidebarDest; indent: number }) {
  const notes = useData((s) => s.notes)
  const folders = useData((s) => s.folders)
  const key = `folder:${folder.id}`
  const collapsed = useUi((s) => s.collapsed[key] ?? true)
  const setCollapsed = useUi((s) => s.setCollapsed)
  const adding = useAddingFolder((s) => s.dest)
  const inside = { folderId: folder.id }
  const children = childrenOf(inside, notes, folders)
  const addingHere = adding !== null && 'folderId' in adding && adding.folderId === folder.id
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
        indent={indent}
        drag={{ kind: 'folder', id: folder.id }}
        {...rowDrop({ type: 'folder', folder }, dest, folders)}
        onContextMenu={(e) => openMenu(e, folderMenu(folder))}
        rename={{ id: folder.id, value: folder.name, save: (name) => renameFolder(folder.id, name) }}
        actions={
          <button type="button" className="icon-btn sm" title="New note in folder" aria-label="New note in folder" onClick={() => void newNote(folder.id)}>
            <Plus />
          </button>
        }
      />
      {(!collapsed || addingHere) && (
        <>
          <Entries entries={children} dest={inside} indent={indent + 1} place={`folder-${folder.id}`} />
          {addingHere && <NewFolderInput dest={inside} indent={indent + 1} />}
          {!children.length && !addingHere && (
            <div className="nav-empty" style={{ paddingLeft: 8 + (indent + 1) * 14 + 22 }}>
              Empty — drag notes here
            </div>
          )}
        </>
      )}
    </>
  )
}

/** `place` tells apart the same note shown twice (e.g. pinned and in its folder) when renaming in place. */
function NoteNode({ note, dest, place, indent, fallback = FileText }: { note: NoteSummary; dest: SidebarDest | null; place: string; indent: number; fallback?: LucideIcon }) {
  const folders = useData((s) => s.folders)
  const renameKey = `${place}:${note.id}`
  return (
    <NavItem
      icon={<ItemIcon icon={note.icon} color={note.color} fallback={fallback} />}
      label={noteTitle(note.title)}
      target={{ view: 'note', id: note.id }}
      indent={indent}
      drag={{ kind: 'note', id: note.id }}
      {...(dest ? rowDrop({ type: 'note', note }, dest, folders) : {})}
      onContextMenu={(e) => openMenu(e, noteMenu(note, { renameKey }))}
      rename={{ id: renameKey, value: note.title, save: (title) => renameNote(note.id, title) }}
    />
  )
}

function Entries({ entries, dest, indent, place, noteFallback }: { entries: Entry[]; dest: SidebarDest; indent: number; place: string; noteFallback?: LucideIcon }) {
  return (
    <>
      {entries.map((e) =>
        e.type === 'folder' ? (
          <FolderNode key={e.folder.id} folder={e.folder} dest={dest} indent={indent} />
        ) : (
          <NoteNode key={e.note.id} note={e.note} dest={dest} place={place} indent={indent} fallback={noteFallback} />
        )
      )}
    </>
  )
}

function NewFolderInput({ dest, indent = 0 }: { dest: SidebarDest; indent?: number }) {
  const [name, setName] = useState('')
  const setAdding = useAddingFolder((s) => s.set)
  const done = useRef(false)
  const submit = async (): Promise<void> => {
    if (done.current) return
    done.current = true
    if (name.trim()) {
      await api.folders.create(name, 'folderId' in dest ? { parentId: dest.folderId } : { sectionId: dest.sectionId })
      await useData.getState().refresh()
    }
    setAdding(null)
  }
  return (
    <div className="nav-item editing" style={{ paddingLeft: 8 + indent * 14 }}>
      <span className="nav-icon">
        <Folder />
      </span>
      <input
        autoFocus
        className="nav-input"
        placeholder="Folder name"
        aria-label="Folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            done.current = true
            setAdding(null)
          }
        }}
      />
    </div>
  )
}

/** A sidebar section (Pinned, Folders or your own): a quiet header you can drag, rename and collapse; drop things on it. */
function SectionGroup({ section, entries, sections }: { section: SidebarSection; entries: Entry[]; sections: SidebarSection[] }) {
  const key = `section:${section.id}`
  const collapsed = useUi((s) => s.collapsed[key] ?? false)
  const toggle = useUi((s) => s.toggle)
  const renaming = useRenaming((s) => s.id === key)
  const adding = useAddingFolder((s) => s.dest)
  const addingHere = adding !== null && 'sectionId' in adding && adding.sectionId === section.id
  const dest = { sectionId: section.id }
  const { zone, handlers } = useDrop(
    (d) => (d.kind === 'section' ? (d.id === section.id ? [] : ['before', 'after']) : d.kind === 'note' || d.kind === 'folder' ? ['inside'] : []),
    (d, z) => {
      if (d.kind === 'section') {
        const ids = sections.map((s) => s.id).filter((id) => id !== d.id)
        ids.splice(ids.indexOf(section.id) + (z === 'after' ? 1 : 0), 0, d.id)
        void api.sidebar.reorderSections(ids).then(() => useData.getState().refresh())
      } else void placeItem({ type: d.kind as 'note' | 'folder', id: d.id }, dest)
    }
  )
  return (
    <div className="sidebar-group">
      <div
        className={`section-header ${zone ? `drop-${zone}` : ''}`}
        draggable={!renaming}
        onDragStart={(e) => startDrag(e, { kind: 'section', id: section.id })}
        onDragEnd={endDrag}
        onContextMenu={(e) => openMenu(e, sectionMenu(section))}
        {...handlers}
      >
        {renaming ? (
          <RenameInput value={section.name} save={(name) => api.sidebar.renameSection(section.id, name).then(() => useData.getState().refresh())} />
        ) : (
          <button type="button" className="section-toggle" aria-expanded={!collapsed} onClick={() => toggle(key)}>
            {section.name}
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </button>
        )}
        <span className="section-actions">
          <button
            type="button"
            className="icon-btn sm"
            title={`Add to ${section.name}`}
            aria-label={`Add to ${section.name}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
                { label: 'New note here', icon: <FileText />, onSelect: () => newNoteIn(dest) },
                { label: 'New folder here', icon: <FolderPlus />, onSelect: () => useAddingFolder.getState().set(dest) }
              ])
            }}
          >
            <Plus />
          </button>
        </span>
      </div>
      {(!collapsed || addingHere) && (
        <>
          <Entries entries={entries} dest={dest} indent={0} place={section.id} noteFallback={section.id === 'pinned' ? Pin : undefined} />
          {addingHere && <NewFolderInput dest={dest} />}
          {!entries.length && !addingHere && <div className="nav-empty section-empty">Drag notes or folders here</div>}
        </>
      )}
    </div>
  )
}

async function newNoteIn(dest: SidebarDest): Promise<void> {
  if ('folderId' in dest) return newNote(dest.folderId)
  await newNote()
  const { route } = useNav.getState()
  if (route.view === 'note') await placeItem({ type: 'note', id: route.id }, dest, 0)
}

// ---------- Main menu (drag to reorder; order remembered) ----------

export function Sidebar() {
  const notes = useData((s) => s.notes)
  const folders = useData((s) => s.folders)
  const sections = useData((s) => s.sections)
  const openTickets = useData((s) => s.counts.open)
  const showRecent = useUi((s) => s.prefs.sidebarRecent === '1')
  const order = navOrder(useUi((s) => s.prefs.navOrder))
  const hidden = navHidden(useUi((s) => s.prefs.navHidden))
  const setPref = useUi((s) => s.setPref)
  const adding = useAddingFolder((s) => s.dest)
  const recent = notes
    .filter((n) => !n.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  const navDrop = (id: NavId) => ({
    drag: { kind: 'nav' as const, id },
    accepts: (d: NonNullable<Dragging>): Zone[] => (d.kind === 'nav' && d.id !== id ? ['before', 'after'] : []),
    onDrop: (d: NonNullable<Dragging>, zone: Zone) => {
      const ids = order.filter((x) => x !== d.id)
      ids.splice(ids.indexOf(id) + (zone === 'after' ? 1 : 0), 0, d.id as NavId)
      setPref('navOrder', ids.join(','))
    }
  })

  const nav: Record<NavId, ReactNode> = {
    home: <NavItem key="home" icon={<Home />} label="Home" target={{ view: 'home' }} {...navDrop('home')} />,
    tickets: (
      <NavItem
        key="tickets"
        icon={<Wrench />}
        label="Tickets"
        target={{ view: 'tickets' }}
        count={openTickets || undefined}
        {...navDrop('tickets')}
        actions={
          <button type="button" className="icon-btn sm" title="New ticket" aria-label="New ticket" onClick={() => void newTicket()}>
            <Plus />
          </button>
        }
      />
    ),
    customers: <NavItem key="customers" icon={<Users />} label="Customers" target={{ view: 'customers' }} {...navDrop('customers')} />,
    calendar: <NavItem key="calendar" icon={<CalendarDays />} label="Calendar" target={{ view: 'calendar' }} {...navDrop('calendar')} />,
    money: <NavItem key="money" icon={<Wallet />} label="Money" target={{ view: 'money' }} {...navDrop('money')} />,
    notes: (
      <NavItem
        key="notes"
        icon={<FileText />}
        label="Notes"
        target={{ view: 'notes', filter: { kind: 'all' } }}
        count={notes.length || undefined}
        drag={{ kind: 'nav', id: 'notes' }}
        // Reorder the menu, or drop a note here to take it out of its folder/section.
        accepts={(d) => (d.kind === 'nav' ? (d.id === 'notes' ? [] : ['before', 'after']) : d.kind === 'note' ? ['inside'] : [])}
        onDrop={(d, zone) => {
          if (d.kind === 'nav') return navDrop('notes').onDrop(d, zone)
          void api.notes.update(d.id, { folderId: null, pinned: false }).then(() => useData.getState().refresh())
        }}
        actions={
          <>
            <button type="button" className="icon-btn sm" title="New folder" aria-label="New folder" onClick={() => useAddingFolder.getState().set({ sectionId: 'folders' })}>
              <FolderPlus />
            </button>
            <button type="button" className="icon-btn sm" title="New note (Ctrl+N)" aria-label="New note" onClick={() => void newNote()}>
              <Plus />
            </button>
          </>
        }
      />
    )
  }

  return (
    <nav
      className="sidebar"
      aria-label="Main"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('sidebar-spacer')) openMenu(e, sidebarMenu())
      }}
    >
      {order.filter((id) => !hidden.includes(id)).map((id) => nav[id])}

      {sections.map((s) => {
        const entries = childrenOf({ sectionId: s.id }, notes, folders)
        const addingHere = adding !== null && 'sectionId' in adding && adding.sectionId === s.id
        // Pinned and Folders hide when empty (pin a note or add a folder to bring them back).
        if (s.builtin && !entries.length && !addingHere) return null
        return <SectionGroup key={s.id} section={s} entries={entries} sections={sections} />
      })}

      {showRecent && recent.length > 0 && (
        <div className="sidebar-group">
          <div className="section-header">
            <span className="section-toggle">Recent</span>
          </div>
          {recent.map((n) => (
            <NoteNode key={n.id} note={n} dest={null} place="recent" indent={0} />
          ))}
        </div>
      )}

      <button type="button" className="add-section" onClick={() => void newSection()}>
        <Plus /> New section
      </button>

      <div className="sidebar-spacer" />
      <div className="sidebar-divider" />
      {!hidden.includes('vault') && <NavItem icon={<Lock />} label="Vault" target={{ view: 'vault' }} />}
      {!hidden.includes('templates') && <NavItem icon={<LayoutTemplate />} label="Templates" target={{ view: 'templates' }} />}
      <NavItem icon={<Trash2 />} label="Trash" target={{ view: 'notes', filter: { kind: 'trash' } }} />
      <NavItem icon={<Settings />} label="Settings" target={{ view: 'settings' }} />
    </nav>
  )
}
