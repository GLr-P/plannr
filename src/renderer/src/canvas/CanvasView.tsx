import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { DocJSON } from '../../../shared/api'
import { CANVAS_WIDTH, boxOf, fittedHeight, readingOrder } from '../../../shared/canvas'
import { CanvasItemContent } from './CanvasItem'
import { calcResult, fieldAttrs } from '../editor/FormField'
import { useFormLinks } from '../editor/formLinks'
import { collectFields } from '../../../shared/formula'

/** The element's width, kept up to date as the window resizes. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** Below this width (phones) items stack top to bottom instead of keeping their places. */
export const STACK_BELOW = 560

/** A canvas on a ticket: everything where the template put it, scaled to fit; fields can be filled in. */
export function CanvasView({ doc, editable, onChange }: { doc: DocJSON; editable: boolean; onChange: (doc: DocJSON) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const [current, setCurrent] = useState(doc)
  useEffect(() => setCurrent(doc), [doc])
  const items = current.content ?? []

  // Calculated fields follow the fields they use (and linked ones from the ticket)
  const links = useFormLinks()
  useEffect(() => {
    if (!editable) return
    const fields = collectFields(current, (link) => (links.active ? links.values[link as keyof typeof links.values] : undefined))
    let changed = false
    const content = items.map((it) => {
      if (it.type !== 'formField' || it.attrs?.kind !== 'calc') return it
      const value = calcResult(fieldAttrs(it.attrs), fields)
      if (value === String(it.attrs?.value ?? '')) return it
      changed = true
      return { ...it, attrs: { ...it.attrs, value } }
    })
    if (!changed) return
    const next = { ...current, content }
    setCurrent(next)
    onChange(next)
  }, [current, links.values, editable]) // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = (id: unknown, value: string): void => {
    const next = { ...current, content: items.map((it) => (it.attrs?.id === id ? { ...it, attrs: { ...it.attrs, value } } : it)) }
    setCurrent(next)
    onChange(next)
  }

  // One host element for both layouts, so its width keeps being measured when the window crosses into phone size
  const stacked = width > 0 && width < STACK_BELOW
  const scale = width ? Math.min(1, width / CANVAS_WIDTH) : 1
  const height = fittedHeight(current)
  return (
    <div ref={ref} className="cv-host">
      {stacked ? (
        <div className="cv-stack prose">
          {readingOrder(items)
            .filter((it) => it.type !== 'canvasShape')
            .map((it) => (
              <div key={String(it.attrs?.id)} className={`cv-stack-item cv-type-${it.type}`}>
                <CanvasItemContent item={it} live={editable} onValue={(v) => setValue(it.attrs?.id, v)} />
              </div>
            ))}
        </div>
      ) : (
        <div className="cv-view" style={{ height: height * scale }}>
          <div className="cv-page cv-live prose" style={{ width: CANVAS_WIDTH, height, transform: `scale(${scale})` }}>
            {items.map((it) => {
              const b = boxOf(it)
              return (
                <div key={String(it.attrs?.id)} className={`cv-item cv-type-${it.type}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
                  <CanvasItemContent item={it} live={editable} onValue={(v) => setValue(it.attrs?.id, v)} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
