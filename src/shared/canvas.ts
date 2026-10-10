import type { DocJSON } from './api'

/*
 * Canvas templates: a page where items sit wherever they were put, at any size (like Canva), instead of flowing
 * like a document. A canvas is stored as an ordinary DocJSON ({ type: 'canvas', content: [items] }) so search,
 * printing fields, copying between profiles and sync handle it like any other document:
 *   - fill-in fields are 'formField' nodes (the same attrs as in documents) plus a box
 *   - 'canvasText' (attrs.text), 'image' (attrs.src), 'canvasShape' (box or line), 'canvasPart' (built-in ticket parts)
 * Boxes are in page units: the page is CANVAS_WIDTH wide and as tall as attrs.height; it's scaled to fit the window.
 */

export const CANVAS_WIDTH = 780
export const CANVAS_MIN_HEIGHT = 400

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type CanvasItemType = 'formField' | 'canvasText' | 'image' | 'canvasShape' | 'canvasPart'

/** Built-in parts of a ticket that can be placed on a canvas */
export const CANVAS_PARTS = [
  { id: 'photos', label: 'Photos' },
  { id: 'lines', label: 'Quote & invoice lines' },
  { id: 'payments', label: 'Price & payments' }
] as const
export type CanvasPart = (typeof CANVAS_PARTS)[number]['id']

export interface TextStyle {
  size: number
  bold: boolean
  italic: boolean
  color: string
  align: 'left' | 'center' | 'right'
}

export const DEFAULT_TEXT_STYLE: TextStyle = { size: 15, bold: false, italic: false, color: '', align: 'left' }

export const isCanvas = (doc: DocJSON | null | undefined): boolean => doc?.type === 'canvas'

export function newCanvas(): DocJSON {
  return { type: 'canvas', attrs: { height: 600 }, content: [] }
}

export const canvasHeight = (doc: DocJSON): number => Math.max(CANVAS_MIN_HEIGHT, Number(doc.attrs?.height) || 600)

export function boxOf(item: DocJSON): Box {
  const b = (item.attrs?.box ?? {}) as Partial<Box>
  return { x: Number(b.x) || 0, y: Number(b.y) || 0, w: Math.max(8, Number(b.w) || 160), h: Math.max(8, Number(b.h) || 40) }
}

/** Keeps a box on the page (it may run off the bottom: the page grows). */
export function clampBox(b: Box): Box {
  const w = Math.min(Math.max(8, Math.round(b.w)), CANVAS_WIDTH)
  const h = Math.max(8, Math.round(b.h))
  const x = Math.min(Math.max(0, Math.round(b.x)), CANVAS_WIDTH - w)
  const y = Math.max(0, Math.round(b.y))
  return { x, y, w, h }
}

/** The page height that fits every item, with some room underneath. */
export function fittedHeight(doc: DocJSON): number {
  const bottom = (doc.content ?? []).reduce((m, it) => Math.max(m, boxOf(it).y + boxOf(it).h), 0)
  return Math.max(canvasHeight(doc), bottom + 40)
}

/** Reading order for narrow screens (phones): top to bottom, then left to right on the same row. */
export function readingOrder(items: DocJSON[]): DocJSON[] {
  return [...items].sort((a, b) => {
    const A = boxOf(a)
    const B = boxOf(b)
    const sameRow = Math.abs(A.y - B.y) < Math.min(A.h, B.h) / 2
    return sameRow ? A.x - B.x : A.y - B.y
  })
}

// ---------- Snapping (alignment guides while moving or resizing) ----------

export interface Guide {
  /** 'x' = a vertical line at this x; 'y' = a horizontal line at this y */
  axis: 'x' | 'y'
  at: number
}

/** Which edges of the moving box are being changed: a move changes all; resizing from a corner changes two */
export interface Edges {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

export const MOVE: Edges = { left: true, right: true, top: true, bottom: true }

/**
 * Nudges a box being moved or resized so its edges or centre line up with other items or the page (within
 * `threshold` units), and returns the guides to draw.
 */
export function snapBox(box: Box, others: Box[], edges: Edges, threshold = 5): { box: Box; guides: Guide[] } {
  const moving = edges.left && edges.right && edges.top && edges.bottom
  const xs = [0, CANVAS_WIDTH / 2, CANVAS_WIDTH, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])]
  const ys = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])
  const best = (candidates: number[], targets: number[]): { delta: number; at: number } | null => {
    let found: { delta: number; at: number } | null = null
    for (const c of candidates)
      for (const t of targets) {
        const d = t - c
        if (Math.abs(d) <= threshold && (!found || Math.abs(d) < Math.abs(found.delta))) found = { delta: d, at: t }
      }
    return found
  }
  const out = { ...box }
  const guides: Guide[] = []
  // Horizontal
  const xCandidates = moving ? [box.x, box.x + box.w / 2, box.x + box.w] : [edges.left ? box.x : null, edges.right ? box.x + box.w : null].filter((v): v is number => v !== null)
  const sx = best(xCandidates, xs)
  if (sx) {
    if (moving) out.x += sx.delta
    else if (edges.left) {
      out.x += sx.delta
      out.w -= sx.delta
    } else out.w += sx.delta
    guides.push({ axis: 'x', at: sx.at })
  }
  // Vertical
  const yCandidates = moving ? [box.y, box.y + box.h / 2, box.y + box.h] : [edges.top ? box.y : null, edges.bottom ? box.y + box.h : null].filter((v): v is number => v !== null)
  const sy = best(yCandidates, ys)
  if (sy) {
    if (moving) out.y += sy.delta
    else if (edges.top) {
      out.y += sy.delta
      out.h -= sy.delta
    } else out.h += sy.delta
    guides.push({ axis: 'y', at: sy.at })
  }
  return { box: out, guides }
}

/** A box after dragging a resize handle by (dx, dy), never smaller than the minimum. */
export function resizeBox(start: Box, edges: Edges, dx: number, dy: number, min = 12): Box {
  let { x, y, w, h } = start
  if (edges.left) {
    const nx = Math.min(x + dx, x + w - min)
    w += x - nx
    x = nx
  }
  if (edges.right) w = Math.max(min, w + dx)
  if (edges.top) {
    const ny = Math.min(y + dy, y + h - min)
    h += y - ny
    y = ny
  }
  if (edges.bottom) h = Math.max(min, h + dy)
  return { x, y, w, h }
}
