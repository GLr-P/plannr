import type { ReactNode } from 'react'
import { create } from 'zustand'
import { Images, ListOrdered, Wallet } from 'lucide-react'
import type { DocJSON } from '../../../shared/api'
import { CANVAS_PARTS, DEFAULT_TEXT_STYLE, type CanvasPart, type TextStyle } from '../../../shared/canvas'
import { FieldBody, FieldLabel, fieldAttrs, fieldClass, fieldVars } from '../editor/FormField'

/** The open ticket page supplies its photos, quote lines and payments for canvas templates to place. */
export const useTicketParts = create<{ parts: Partial<Record<CanvasPart, () => ReactNode>> }>(() => ({ parts: {} }))

export const textStyle = (item: DocJSON): TextStyle => ({ ...DEFAULT_TEXT_STYLE, ...((item.attrs?.style as Partial<TextStyle> | undefined) ?? {}) })

const PART_ICONS: Record<CanvasPart, ReactNode> = { photos: <Images />, lines: <ListOrdered />, payments: <Wallet /> }

/**
 * One canvas item's content (its box is positioned by the caller). On a ticket fields can be filled in and parts
 * are live; in the designer everything is a picture of itself (clicks select and drag instead).
 */
export function CanvasItemContent({ item, live, onValue }: { item: DocJSON; live: boolean; onValue?: (value: string) => void }) {
  const a = item.attrs ?? {}
  switch (item.type) {
    case 'formField': {
      const attrs = fieldAttrs(a)
      return (
        <span className={`${fieldClass({ ...attrs, width: 'full' })} cv-field`} data-label={attrs.label} style={fieldVars(attrs)}>
          {attrs.labelPos !== 'hidden' && <FieldLabel attrs={attrs} />}
          <FieldBody attrs={attrs} editable={live} store={(v) => onValue?.(v)} />
        </span>
      )
    }
    case 'canvasText': {
      const st = textStyle(item)
      return (
        <div
          className="cv-text"
          style={{ fontSize: st.size, fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal', color: st.color || undefined, textAlign: st.align }}
        >
          {String(a.text ?? '') || (live ? '' : <span className="cv-empty">Double-click to type</span>)}
        </div>
      )
    }
    case 'image':
      return a.src ? (
        <img className="cv-image" src={String(a.src)} alt={String(a.alt ?? '')} style={{ objectFit: a.fit === 'cover' ? 'cover' : 'contain' }} draggable={false} />
      ) : (
        <div className="cv-placeholder">Picture</div>
      )
    case 'canvasShape': {
      const line = a.shape === 'line'
      const border = Number(a.borderWidth ?? 2)
      return line ? (
        <div className="cv-line" style={{ borderTop: `${Math.max(1, border)}px solid ${String(a.borderColor || 'var(--border-strong)')}` }} />
      ) : (
        <div
          className="cv-shape"
          style={{
            background: String(a.fill || 'transparent'),
            border: border ? `${border}px solid ${String(a.borderColor || 'var(--border-strong)')}` : 'none',
            borderRadius: Number(a.radius ?? 8)
          }}
        />
      )
    }
    case 'canvasPart':
      return <PartView part={a.part as CanvasPart} live={live} />
    default:
      return null
  }
}

/** A built-in ticket part: live on a ticket, a labelled placeholder in the designer */
function PartView({ part, live }: { part: CanvasPart; live: boolean }) {
  const render = useTicketParts((s) => s.parts[part])
  if (live && render) return <div className="cv-part">{render()}</div>
  return (
    <div className="cv-placeholder">
      {PART_ICONS[part]} {CANVAS_PARTS.find((p) => p.id === part)?.label ?? 'Ticket part'}
      <span className="muted small">(on each ticket)</span>
    </div>
  )
}
