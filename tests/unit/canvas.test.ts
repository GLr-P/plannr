import { describe, expect, it } from 'vitest'
import { CANVAS_WIDTH, MOVE, boxOf, clampBox, fittedHeight, readingOrder, resizeBox, snapBox, newCanvas } from '../../src/shared/canvas'
import { extractText } from '../../src/main/services/doc'
import type { DocJSON } from '../../src/shared/api'

const item = (x: number, y: number, w = 100, h = 40, extra: Record<string, unknown> = {}): DocJSON => ({ type: 'canvasText', attrs: { box: { x, y, w, h }, ...extra } })

describe('canvas boxes', () => {
  it('keeps boxes on the page, with a minimum size', () => {
    expect(clampBox({ x: -20, y: -5, w: 3, h: 2 })).toEqual({ x: 0, y: 0, w: 8, h: 8 })
    expect(clampBox({ x: 760, y: 10, w: 100, h: 40 })).toEqual({ x: CANVAS_WIDTH - 100, y: 10, w: 100, h: 40 })
    expect(boxOf({ type: 'canvasText' })).toEqual({ x: 0, y: 0, w: 160, h: 40 })
  })

  it('resizes from any edge without going smaller than the minimum', () => {
    const start = { x: 100, y: 100, w: 200, h: 80 }
    expect(resizeBox(start, { left: false, right: true, top: false, bottom: true }, 50, 20)).toEqual({ x: 100, y: 100, w: 250, h: 100 })
    expect(resizeBox(start, { left: true, right: false, top: true, bottom: false }, 30, 10)).toEqual({ x: 130, y: 110, w: 170, h: 70 })
    expect(resizeBox(start, { left: true, right: false, top: false, bottom: false }, 500, 0).w).toBe(12)
  })

  it('snaps to other items and the page centre, and says where the guide is', () => {
    const other = { x: 300, y: 200, w: 120, h: 40 }
    // Left edges 3 units apart: lines up, with a vertical guide at x = 300
    expect(snapBox({ x: 303, y: 400, w: 80, h: 30 }, [other], MOVE)).toEqual({ box: { x: 300, y: 400, w: 80, h: 30 }, guides: [{ axis: 'x', at: 300 }] })
    // Centred on the page
    const centred = snapBox({ x: CANVAS_WIDTH / 2 - 52, y: 10, w: 100, h: 30 }, [], MOVE)
    expect(centred.box.x).toBe(CANVAS_WIDTH / 2 - 50)
    // Tops line up
    expect(snapBox({ x: 10, y: 198, w: 80, h: 30 }, [other], MOVE).box.y).toBe(200)
    // Too far: nothing changes
    expect(snapBox({ x: 120, y: 500, w: 80, h: 30 }, [other], MOVE)).toEqual({ box: { x: 120, y: 500, w: 80, h: 30 }, guides: [] })
    // Resizing from the right edge snaps only that edge
    const r = snapBox({ x: 100, y: 300, w: 317, h: 30 }, [other], { left: false, right: true, top: false, bottom: false })
    expect(r.box).toEqual({ x: 100, y: 300, w: 320, h: 30 })
  })

  it('grows the page to fit, and reads top to bottom then left to right on phones', () => {
    const doc = { ...newCanvas(), content: [item(400, 10), item(10, 12), item(10, 900, 100, 50)] }
    expect(fittedHeight(doc)).toBe(990)
    expect(readingOrder(doc.content).map((i) => boxOf(i).x + ',' + boxOf(i).y)).toEqual(['10,12', '400,10', '10,900'])
  })

  it('canvas text and fields are searchable like documents', () => {
    const doc: DocJSON = {
      type: 'canvas',
      content: [item(0, 0, 100, 40, { text: 'Thank you for your order' }), { type: 'formField', attrs: { label: 'Card message', value: 'Happy birthday', kind: 'textarea', box: { x: 0, y: 50, w: 300, h: 60 } } }]
    }
    const text = extractText(doc)
    expect(text).toContain('Thank you for your order')
    expect(text).toContain('Card message: Happy birthday')
  })
})
