import type { DocJSON } from '../../../shared/api'
import { CANVAS_WIDTH, DEFAULT_TEXT_STYLE, type Box, type CanvasPart } from '../../../shared/canvas'

/*
 * Ready-made canvas items for the designer's toolbar, each placed at a given top-left (boxes in page units).
 */

const id = (): string => crypto.randomUUID()
const M = 24 // page margin
const FULL = CANVAS_WIDTH - 2 * M
const HALF = (FULL - 16) / 2

const field = (box: Box, attrs: Record<string, unknown>): DocJSON => ({
  type: 'formField',
  attrs: { id: id(), box, label: 'New field', kind: 'text', options: [], value: '', width: 'full', labelPos: 'top', placeholder: '', hint: '', rows: 2, link: '', ...attrs }
})

export function textItem(y: number, heading = false): DocJSON {
  return {
    type: 'canvasText',
    attrs: { id: id(), box: { x: M, y, w: heading ? 420 : 320, h: heading ? 44 : 30 }, text: heading ? 'Heading' : 'Text', style: { ...DEFAULT_TEXT_STYLE, ...(heading ? { size: 26, bold: true } : {}) } }
  }
}

export const fieldItem = (y: number): DocJSON => field({ x: M, y, w: HALF, h: 62 }, {})

export const customerItems = (y: number): DocJSON[] => [
  field({ x: M, y, w: HALF, h: 62 }, { label: 'Customer name', link: 'customer.name' }),
  field({ x: M + HALF + 16, y, w: HALF, h: 62 }, { label: 'Phone', link: 'customer.phone', kind: 'phone' }),
  field({ x: M, y: y + 72, w: HALF, h: 62 }, { label: 'Email', link: 'customer.email', kind: 'email' }),
  field({ x: M + HALF + 16, y: y + 72, w: HALF, h: 92 }, { label: 'Address', link: 'customer.address', kind: 'textarea' })
]

export const titleItem = (y: number): DocJSON => field({ x: M, y, w: FULL, h: 62 }, { label: 'Ticket title', link: 'ticket.device' })

export const dateItems = (y: number): DocJSON[] => [
  field({ x: M, y, w: HALF, h: 62 }, { label: 'Received', link: 'ticket.receivedOn', kind: 'date' }),
  field({ x: M + HALF + 16, y, w: HALF, h: 62 }, { label: 'Pickup', link: 'ticket.pickupOn', kind: 'date' })
]

export function imageItem(y: number, src: string, alt: string, ratio: number): DocJSON {
  const w = 240
  return { type: 'image', attrs: { id: id(), box: { x: M, y, w, h: Math.max(24, Math.round(w * ratio)) }, src, alt, fit: 'contain' } }
}

export const boxItem = (y: number): DocJSON => ({
  type: 'canvasShape',
  attrs: { id: id(), box: { x: M, y, w: 320, h: 140 }, shape: 'box', fill: '', borderColor: '', borderWidth: 2, radius: 10 }
})

export const lineItem = (y: number): DocJSON => ({
  type: 'canvasShape',
  attrs: { id: id(), box: { x: M, y, w: FULL, h: 10 }, shape: 'line', borderColor: '', borderWidth: 2 }
})

const PART_HEIGHT: Record<CanvasPart, number> = { photos: 160, lines: 220, payments: 80 }
export const partItem = (y: number, part: CanvasPart): DocJSON => ({
  type: 'canvasPart',
  attrs: { id: id(), box: { x: M, y, w: FULL, h: PART_HEIGHT[part] }, part }
})

/** A new canvas template starts with a heading, the customer's details and the dates, ready to rearrange. */
export function starterCanvas(): DocJSON {
  const heading = textItem(M, true)
  heading.attrs!.text = 'Order form'
  return { type: 'canvas', attrs: { height: 520 }, content: [heading, ...customerItems(96), ...dateItems(280), field({ x: M, y: 362, w: FULL, h: 110 }, { label: 'Notes', kind: 'textarea', rows: 4 })] }
}

/** A copy with new ids, nudged down and right (Duplicate) */
export function duplicate(item: DocJSON): DocJSON {
  const b = item.attrs?.box as Box
  return { ...item, attrs: { ...item.attrs, id: id(), box: { ...b, x: Math.min(b.x + 16, CANVAS_WIDTH - b.w), y: b.y + 16 } } }
}
