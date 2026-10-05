import { create } from 'zustand'
import type { Folder, NoteSummary, SidebarDest, SidebarRef } from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { useUi } from '../store/ui'
import { showToast } from './toast'

/* What's inside each sidebar section and folder, and moving things around (drag and drop, right-click "Move to"). */

export type Entry = { type: 'note'; note: NoteSummary } | { type: 'folder'; folder: Folder }

export const refOf = (e: Entry): SidebarRef => (e.type === 'note' ? { type: 'note', id: e.note.id } : { type: 'folder', id: e.folder.id })
const same = (a: SidebarRef, b: SidebarRef): boolean => a.type === b.type && a.id === b.id

/** Items in a section or folder, top to bottom: by the order you set, then folders A–Z and newest notes first. */
export function childrenOf(dest: SidebarDest, notes: NoteSummary[], folders: Folder[]): Entry[] {
  const inFolder = 'folderId' in dest
  const fs = folders.filter((f) => (inFolder ? f.parentId === dest.folderId : !f.parentId && f.sectionId === dest.sectionId))
  const ns = notes.filter((n) => (inFolder ? n.folderId === dest.folderId : n.sectionId === dest.sectionId))
  const entries: Entry[] = [...fs.map((folder) => ({ type: 'folder' as const, folder })), ...ns.map((note) => ({ type: 'note' as const, note }))]
  const sortOf = (e: Entry): number => (e.type === 'note' ? e.note.sort : e.folder.sort)
  return entries.sort((a, b) => {
    if (sortOf(a) !== sortOf(b)) return sortOf(a) - sortOf(b)
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    if (a.type === 'folder' && b.type === 'folder') return a.folder.name.localeCompare(b.folder.name)
    return a.type === 'note' && b.type === 'note' ? b.note.updatedAt - a.note.updatedAt : 0
  })
}

/** True when folder `id` is `ancestor` or inside it (so `ancestor` can't be moved there). */
export function isWithin(folders: Folder[], id: string | null, ancestor: string): boolean {
  for (let cur = id, guard = 0; cur && guard < 100; guard++) {
    if (cur === ancestor) return true
    cur = folders.find((f) => f.id === cur)?.parentId ?? null
  }
  return false
}

/** Puts `item` into `dest` at `index` (or the end) and saves the new order of everything there. */
export async function placeItem(item: SidebarRef, dest: SidebarDest, index: number | 'end' = 'end'): Promise<void> {
  const { notes, folders } = useData.getState()
  const order = childrenOf(dest, notes, folders)
    .map(refOf)
    .filter((r) => !same(r, item))
  order.splice(index === 'end' ? order.length : Math.max(0, Math.min(index, order.length)), 0, item)
  try {
    await api.sidebar.move(item, dest, order)
  } catch (err) {
    showToast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
  }
  if ('folderId' in dest) useUi.getState().setCollapsed(`folder:${dest.folderId}`, false) // show where it went
  await useData.getState().refresh()
}

/** Puts `item` right before/after `target` in the same place. */
export async function placeNextTo(item: SidebarRef, target: SidebarRef, dest: SidebarDest, after: boolean): Promise<void> {
  const { notes, folders } = useData.getState()
  const siblings = childrenOf(dest, notes, folders)
    .map(refOf)
    .filter((r) => !same(r, item))
  const at = siblings.findIndex((r) => same(r, target))
  await placeItem(item, dest, at < 0 ? 'end' : at + (after ? 1 : 0))
}

/** What's being dragged inside the sidebar (the browser hides drag data until the drop). */
export type Dragging = { kind: 'note' | 'folder' | 'section' | 'nav'; id: string } | null
export const useSidebarDrag = create<{ dragging: Dragging; set: (d: Dragging) => void }>((set) => ({ dragging: null, set: (dragging) => set({ dragging }) }))

/** Where a new folder is being typed in, if anywhere. */
export const useAddingFolder = create<{ dest: SidebarDest | null; set: (d: SidebarDest | null) => void }>((set) => ({ dest: null, set: (dest) => set({ dest }) }))
