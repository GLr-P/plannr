import { api } from './api'
import { useData } from './store/data'
import { go, useNav, type Route } from './store/nav'
import type { EntityType } from '../../shared/api'

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
  type: EntityType
  id: string
}
export function readDrag(e: { dataTransfer: DataTransfer }): DragItem | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as DragItem
  } catch {
    return null
  }
}

export function routeFor(type: EntityType, id: string): Route {
  if (type === 'ticket') return { view: 'ticket', id }
  if (type === 'customer') return { view: 'customer', id }
  return { view: 'note', id }
}

export const openEntity = (type: EntityType, id: string): void => go(routeFor(type, id))

export async function newTicket(input: { templateId?: string | null; customerId?: string | null } = {}): Promise<void> {
  ;(document.activeElement as HTMLElement | null)?.blur()
  const ticket = await api.tickets.create(input)
  void useData.getState().refreshCounts()
  go({ view: 'ticket', id: ticket.id })
}

export async function newCustomer(name = ''): Promise<string> {
  const customer = await api.customers.create({ name })
  go({ view: 'customer', id: customer.id })
  return customer.id
}
