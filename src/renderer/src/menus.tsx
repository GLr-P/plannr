import { create } from 'zustand'
import {
  ExternalLink,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  FolderMinus,
  FolderPlus,
  LayoutList,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2
} from 'lucide-react'
import type { Folder, NoteSummary, SidebarSection } from '../../shared/api'
import { api } from './api'
import { useData } from './store/data'
import { go, useNav } from './store/nav'
import { moveNote, newNote, togglePin, trashNote } from './actions'
import { IconPicker, type MenuEntry } from './components/ContextMenu'
import { ItemIcon } from './lib/icons'
import { placeItem, useAddingFolder } from './lib/sidebarTree'

/** Which sidebar item is being renamed in place (set from the right-click menu). */
export const useRenaming = create<{ id: string | null; set: (id: string | null) => void }>((set) => ({ id: null, set: (id) => set({ id }) }))

export async function styleNote(id: string, style: { icon?: string; color?: string }): Promise<void> {
  useData.getState().upsertNote(await api.notes.update(id, style))
}

export async function renameNote(id: string, title: string): Promise<void> {
  useData.getState().upsertNote(await api.notes.update(id, { title }))
}

export async function styleFolder(id: string, style: { icon?: string; color?: string }): Promise<void> {
  await api.folders.style(id, style)
  await useData.getState().refresh()
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await api.folders.rename(id, name)
  await useData.getState().refresh()
}

/** Adds a section at the bottom and starts renaming it. */
export async function newSection(): Promise<void> {
  const s = await api.sidebar.createSection('New section')
  await useData.getState().refresh()
  useRenaming.getState().set(`section:${s.id}`)
}

const sectionChoices = (current: string | null, onPick: (s: SidebarSection) => void): MenuEntry[] =>
  useData.getState().sections.map((s) => ({ label: s.name, icon: <LayoutList />, checked: current === s.id, onSelect: () => onPick(s) }))

/** Right-click menu for a note. `renameKey` = the item can be renamed in place (sidebar) under this key. */
export function noteMenu(note: NoteSummary, opts: { renameKey?: string } = {}): MenuEntry[] {
  const folders = useData.getState().folders
  return [
    { label: 'Open', icon: <ExternalLink />, onSelect: () => go({ view: 'note', id: note.id }) },
    ...(opts.renameKey ? [{ label: 'Rename', icon: <Pencil />, onSelect: () => useRenaming.getState().set(opts.renameKey!) }] : []),
    {
      label: 'Icon & colour',
      icon: <Palette />,
      panel: () => <IconPicker icon={note.icon} color={note.color} onChange={(s) => void styleNote(note.id, s)} />
    },
    note.pinned
      ? { label: note.sectionId === 'pinned' ? 'Unpin' : 'Remove from sidebar', icon: <PinOff />, onSelect: () => togglePin(note.id, false) }
      : { label: 'Pin to sidebar', icon: <Pin />, onSelect: () => togglePin(note.id, true) },
    {
      label: 'Move to section',
      icon: <LayoutList />,
      children: sectionChoices(note.sectionId, (s) => void placeItem({ type: 'note', id: note.id }, { sectionId: s.id }))
    },
    {
      label: 'Move to folder',
      icon: <FolderInput />,
      children: [
        { label: 'No folder', icon: <FolderMinus />, checked: note.folderId === null, onSelect: () => moveNote(note.id, null) },
        ...folders.map((f) => ({
          label: f.name,
          icon: <ItemIcon icon={f.icon} color={f.color} fallback={FolderIcon} />,
          checked: note.folderId === f.id,
          onSelect: () => placeItem({ type: 'note', id: note.id }, { folderId: f.id })
        }))
      ]
    },
    'separator',
    { label: 'Move to trash', icon: <Trash2 />, danger: true, onSelect: () => trashNote(note.id) }
  ]
}

export function folderMenu(folder: Folder): MenuEntry[] {
  return [
    { label: 'Open', icon: <ExternalLink />, onSelect: () => go({ view: 'notes', filter: { kind: 'folder', id: folder.id } }) },
    { label: 'New note here', icon: <Plus />, onSelect: () => newNote(folder.id) },
    { label: 'New folder inside', icon: <FolderPlus />, onSelect: () => useAddingFolder.getState().set({ folderId: folder.id }) },
    { label: 'Rename', icon: <Pencil />, onSelect: () => useRenaming.getState().set(folder.id) },
    {
      label: 'Icon & colour',
      icon: <Palette />,
      panel: () => <IconPicker icon={folder.icon} color={folder.color} onChange={(s) => void styleFolder(folder.id, s)} />
    },
    {
      label: 'Move to section',
      icon: <LayoutList />,
      children: sectionChoices(folder.parentId ? null : folder.sectionId, (s) => void placeItem({ type: 'folder', id: folder.id }, { sectionId: s.id }))
    },
    'separator',
    {
      label: 'Delete folder',
      icon: <Trash2 />,
      danger: true,
      confirm: 'Click again to delete (notes are kept)',
      onSelect: async () => {
        await api.folders.remove(folder.id)
        await useData.getState().refresh()
        const { route } = useNav.getState()
        if (route.view === 'notes' && route.filter.kind === 'folder' && route.filter.id === folder.id) go({ view: 'notes', filter: { kind: 'all' } })
      }
    }
  ]
}

export function sectionMenu(section: SidebarSection): MenuEntry[] {
  return [
    { label: 'Rename', icon: <Pencil />, onSelect: () => useRenaming.getState().set(`section:${section.id}`) },
    { label: 'New folder here', icon: <FolderPlus />, onSelect: () => useAddingFolder.getState().set({ sectionId: section.id }) },
    { label: 'New section', icon: <Plus />, onSelect: () => newSection() },
    ...(section.builtin
      ? []
      : [
          'separator' as const,
          {
            label: 'Remove section',
            icon: <Trash2 />,
            danger: true,
            confirm: 'Click again (its notes go to Pinned)',
            onSelect: async () => {
              await api.sidebar.removeSection(section.id)
              await useData.getState().refresh()
            }
          }
        ])
  ]
}

/** Right-click on empty sidebar space. */
export function sidebarMenu(): MenuEntry[] {
  return [
    { label: 'New note', icon: <FileText />, onSelect: () => newNote() },
    { label: 'New folder', icon: <FolderPlus />, onSelect: () => useAddingFolder.getState().set({ sectionId: 'folders' }) },
    { label: 'New section', icon: <LayoutList />, onSelect: () => newSection() }
  ]
}
