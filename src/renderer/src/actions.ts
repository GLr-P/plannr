import { api } from './api'
import { useData } from './store/data'
import { go, useNav } from './store/nav'

export async function newNote(folderId: string | null = null, title?: string): Promise<void> {
  // Leave the current note right away so keys typed while the new one opens can't land in it.
  ;(document.activeElement as HTMLElement | null)?.blur()
  const note = await api.notes.create({ folderId, title })
  useData.getState().upsertNote(note)
  go({ view: 'note', id: note.id })
}

export async function trashNote(id: string): Promise<void> {
  await api.notes.trash(id)
  await useData.getState().refresh()
  const { route, back } = useNav.getState()
  if (route.view === 'note' && route.id === id) back()
}

export async function moveNote(id: string, folderId: string | null): Promise<void> {
  const summary = await api.notes.update(id, { folderId })
  useData.getState().upsertNote(summary)
}

export async function togglePin(id: string, pinned: boolean): Promise<void> {
  const summary = await api.notes.update(id, { pinned })
  useData.getState().upsertNote(summary)
}

/** Drag-and-drop payload shared by every draggable item (notes now; customers/tickets later). */
export const DRAG_MIME = 'application/x-plannr-item'
export interface DragItem {
  type: 'note'
  id: string
}
export function readDrag(e: { dataTransfer: DataTransfer }): DragItem | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as DragItem
  } catch {
    return null
  }
}
