import { create } from 'zustand'

/**
 * Fill-in fields can be linked to the ticket they're on: a "Customer name" field shows the ticket's customer and
 * editing it changes the customer. The open ticket page provides the values and a setter here; anywhere else
 * (templates, notes) linked fields just say what they'll fill in with.
 */
export const FIELD_LINKS = [
  { id: 'customer.name', label: 'Customer name', kind: 'text' },
  { id: 'customer.phone', label: 'Customer phone', kind: 'phone' },
  { id: 'customer.email', label: 'Customer email', kind: 'email' },
  { id: 'customer.address', label: 'Customer address', kind: 'textarea' },
  { id: 'ticket.device', label: 'Ticket title', kind: 'text' },
  { id: 'ticket.issue', label: 'Ticket summary', kind: 'text' },
  { id: 'ticket.receivedOn', label: 'Received date', kind: 'date' },
  { id: 'ticket.pickupOn', label: 'Pickup date', kind: 'date' },
  { id: 'ticket.number', label: 'Ticket number', kind: 'text', readOnly: true },
  { id: 'ticket.price', label: 'Ticket price', kind: 'text', readOnly: true }
] as const

export type FieldLink = (typeof FIELD_LINKS)[number]['id']

interface FormLinks {
  /** A ticket page is open and provides the values */
  active: boolean
  values: Partial<Record<FieldLink, string>>
  set: (link: FieldLink, value: string) => void
}

export const useFormLinks = create<FormLinks>(() => ({ active: false, values: {}, set: () => undefined }))

export const linkDef = (id: string | undefined) => FIELD_LINKS.find((l) => l.id === id)
