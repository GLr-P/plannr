import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  CalendarRange,
  Copy,
  FormInput,
  Heading,
  ImageIcon,
  Images,
  Italic,
  ListOrdered,
  Magnet,
  Minus,
  Redo2,
  SendToBack,
  Settings2,
  Square,
  Trash2,
  Type,
  Undo2,
  UserRound,
  Wallet,
  TextCursorInput
} from 'lucide-react'
import type { DocJSON } from '../../../shared/api'
import {
  CANVAS_MIN_HEIGHT,
  CANVAS_WIDTH,
  MOVE,
  boxOf,
  clampBox,
  fittedHeight,
  resizeBox,
  snapBox,
  type Box,
  type CanvasPart,
  type Edges,
  type Guide,
  type TextStyle
} from '../../../shared/canvas'
import { FieldConfig, fieldAttrs } from '../editor/FormField'
import { storeFile } from '../editor/upload'
import { pickImages } from '../editor/upload'
import { CanvasItemContent, textStyle } from './CanvasItem'
import { useWidth } from './CanvasView'
import { boxItem, customerItems, dateItems, duplicate, fieldItem, imageItem, lineItem, partItem, textItem, titleItem } from './presets'

/*
 * The canvas designer (ticket templates made as a canvas): put anything anywhere and resize it, like Canva.
 * Drag to move, drag the handles to resize, double-click text to type; things snap to each other and to the page
 * centre (hold Alt to place freely). Arrow keys nudge (Shift = 10), Delete removes, Ctrl+D duplicates, Ctrl+Z undoes.
 */

const HANDLES: { id: string; edges: Edges }[] = [
  { id: 'nw', edges: { left: true, right: false, top: true, bottom: false } },
  { id: 'n', edges: { left: false, right: false, top: true, bottom: false } },
  { id: 'ne', edges: { left: false, right: true, top: true, bottom: false } },
  { id: 'e', edges: { left: false, right: true, top: false, bottom: false } },
  { id: 'se', edges: { left: false, right: true, top: false, bottom: true } },
  { id: 's', edges: { left: false, right: false, top: false, bottom: true } },
  { id: 'sw', edges: { left: true, right: false, top: false, bottom: true } },
  { id: 'w', edges: { left: true, right: false, top: false, bottom: false } }
]
const COLORS = ['', '#111111', '#6d6d68', '#2f6ae0', '#16a34a', '#db2777', '#ea580c', '#9333ea']
const FILLS = ['', '#ffffff', '#f3f3f1', '#fdf2f8', '#eff6ff', '#f0fdf4', '#fff7ed', '#111111']

const itemId = (it: DocJSON): string => String(it.attrs?.id)

interface Drag {
  id: string
  edges: Edges
  start: Box
  x: number
  y: number
  moved: boolean
}

export function CanvasDesigner({ doc, onChange }: { doc: DocJSON; onChange: (doc: DocJSON) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const width = useWidth(hostRef)
  const scale = width ? Math.min(1, width / CANVAS_WIDTH) : 1
  const [current, setCurrent] = useState<DocJSON>(doc)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null) // text being typed
  const [fieldSettings, setFieldSettings] = useState(false)
  const [guides, setGuides] = useState<Guide[]>([])
  const [snap, setSnap] = useState(true)
  const history = useRef<{ past: DocJSON[]; future: DocJSON[] }>({ past: [], future: [] })
  const drag = useRef<Drag | null>(null)
  const items = current.content ?? []
  const sel = items.find((it) => itemId(it) === selected) ?? null
  const latest = useRef(current)
  latest.current = current

  /** A change that can be undone (and is saved). */
  const commit = useCallback(
    (next: DocJSON, from: DocJSON = latest.current) => {
      history.current.past = [...history.current.past.slice(-99), from]
      history.current.future = []
      setCurrent(next)
      onChange(next)
    },
    [onChange]
  )
  const withItems = (list: DocJSON[], base = latest.current): DocJSON => ({ ...base, content: list })
  const patchItem = (id: string, attrs: Record<string, unknown>): void =>
    commit(withItems(items.map((it) => (itemId(it) === id ? { ...it, attrs: { ...it.attrs, ...attrs } } : it))))
  const bottom = (): number => items.reduce((m, it) => Math.max(m, boxOf(it).y + boxOf(it).h), 0)
  const add = (list: DocJSON[], opts: { configure?: boolean } = {}): void => {
    const next = withItems([...items, ...list])
    commit({ ...next, attrs: { ...next.attrs, height: fittedHeight(next) } })
    setSelected(itemId(list[0]))
    setFieldSettings(Boolean(opts.configure))
    hostRef.current?.focus()
  }
  const remove = (id: string): void => {
    commit(withItems(items.filter((it) => itemId(it) !== id)))
    setSelected(null)
    setFieldSettings(false)
  }
  const reorder = (id: string, toFront: boolean): void => {
    const it = items.find((x) => itemId(x) === id)
    if (!it) return
    const rest = items.filter((x) => x !== it)
    commit(withItems(toFront ? [...rest, it] : [it, ...rest]))
  }
  const undo = (): void => {
    const prev = history.current.past.pop()
    if (!prev) return
    history.current.future.push(latest.current)
    setCurrent(prev)
    onChange(prev)
  }
  const redo = (): void => {
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(latest.current)
    setCurrent(next)
    onChange(next)
  }

  // ---------- Moving and resizing ----------

  const startDrag = (e: React.PointerEvent, item: DocJSON, edges: Edges): void => {
    if (e.button !== 0 || editing === itemId(item)) return
    e.preventDefault()
    e.stopPropagation()
    setSelected(itemId(item))
    if (selected !== itemId(item)) setFieldSettings(false)
    hostRef.current?.focus()
    drag.current = { id: itemId(item), edges, start: boxOf(item), x: e.clientX, y: e.clientY, moved: false }
    const before = latest.current
    const onMove = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      const dx = (ev.clientX - d.x) / scale
      const dy = (ev.clientY - d.y) / scale
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return
      d.moved = true
      const isMove = d.edges === MOVE
      let box = isMove ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : resizeBox(d.start, d.edges, dx, dy)
      let shown: Guide[] = []
      if (snap && !ev.altKey) {
        const others = latest.current.content!.filter((it) => itemId(it) !== d.id).map(boxOf)
        const snapped = snapBox(box, others, d.edges)
        box = snapped.box
        shown = snapped.guides
      }
      box = clampBox(box)
      setGuides(shown)
      // Kept in the ref right away: letting go straight after the last move must keep that position
      const cur = latest.current
      const moved = { ...cur, content: cur.content!.map((it) => (itemId(it) === d.id ? { ...it, attrs: { ...it.attrs, box } } : it)) }
      const next = { ...moved, attrs: { ...moved.attrs, height: Math.max(Number(cur.attrs?.height) || 0, fittedHeight(moved)) } }
      latest.current = next
      setCurrent(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGuides([])
      if (drag.current?.moved) commit(latest.current, before)
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** The page's own height, dragged from the strip at its bottom */
  const startPageResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = Number(current.attrs?.height) || fittedHeight(current)
    const before = latest.current
    const min = Math.max(CANVAS_MIN_HEIGHT, bottom() + 20)
    const onMove = (ev: PointerEvent): void => {
      const h = Math.max(min, Math.round(startH + (ev.clientY - startY) / scale))
      const next = { ...latest.current, attrs: { ...latest.current.attrs, height: h } }
      latest.current = next
      setCurrent(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      commit(latest.current, before)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---------- Keyboard ----------

  const onKeyDown = (e: KeyboardEvent): void => {
    if (editing || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable=true], .ff-config, .ctx-menu, .dialog')) return
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? redo() : undo()
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      return redo()
    }
    if (!sel) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(itemId(sel))
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      add([duplicate(sel)])
    } else if (e.key === 'Escape') setSelected(null)
    else if (e.key === 'Enter' && sel.type === 'canvasText') {
      e.preventDefault()
      setEditing(itemId(sel))
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const b = boxOf(sel)
      const box = clampBox({ ...b, x: b.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y: b.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) })
      patchItem(itemId(sel), { box })
    }
  }

  // Shortcuts work wherever the focus is on the page (not while typing in a box)
  const keyRef = useRef(onKeyDown)
  keyRef.current = onKeyDown
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => keyRef.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    if (!editing) return
    const el = document.querySelector<HTMLTextAreaElement>('.cv-edit-text')
    el?.focus()
    el?.select()
  }, [editing])

  const addPicture = async (): Promise<void> => {
    const [file] = await pickImages()
    if (!file) return
    const stored = await storeFile(file)
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalHeight / img.naturalWidth || 0.66)
      img.onerror = () => resolve(0.66)
      img.src = stored.url
    })
    add([imageItem(bottom() + 16, stored.url, stored.name, ratio)])
  }

  const height = Math.max(Number(current.attrs?.height) || 0, fittedHeight(current))
  const y = (): number => (items.length ? bottom() + 16 : 24)

  return (
    <div className="cv-designer">
      <div className="cv-toolbar" role="toolbar" aria-label="Add to the page">
        <span className="cv-toolbar-label">Add</span>
        <ToolButton icon={<Type />} label="Text" onClick={() => add([textItem(y())])} />
        <ToolButton icon={<Heading />} label="Heading" onClick={() => add([textItem(y(), true)])} />
        <ToolButton icon={<FormInput />} label="Field" onClick={() => add([fieldItem(y())], { configure: true })} />
        <ToolButton icon={<UserRound />} label="Customer" title="Customer details: name, phone, email, address" onClick={() => add(customerItems(y()))} />
        <ToolButton icon={<TextCursorInput />} label="Title" title="The ticket's title" onClick={() => add([titleItem(y())])} />
        <ToolButton icon={<CalendarRange />} label="Dates" title="The ticket's two dates" onClick={() => add(dateItems(y()))} />
        <ToolButton icon={<ImageIcon />} label="Picture" onClick={() => void addPicture()} />
        <ToolButton icon={<Square />} label="Box" onClick={() => add([boxItem(y())])} />
        <ToolButton icon={<Minus />} label="Line" onClick={() => add([lineItem(y())])} />
        <ToolButton icon={<Images />} label="Photos" title="The ticket's photos" onClick={() => add([partItem(y(), 'photos')])} />
        <ToolButton icon={<ListOrdered />} label="Lines" title="Quote & invoice lines" onClick={() => add([partItem(y(), 'lines' as CanvasPart)])} />
        <ToolButton icon={<Wallet />} label="Payments" title="Price & payments" onClick={() => add([partItem(y(), 'payments')])} />
        <span className="cv-toolbar-gap" />
        <IconButton icon={<Undo2 />} label="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current.past.length} />
        <IconButton icon={<Redo2 />} label="Redo (Ctrl+Y)" onClick={redo} disabled={!history.current.future.length} />
        <IconButton icon={<Magnet />} label={snap ? 'Snapping on (hold Alt to place freely)' : 'Snapping off'} onClick={() => setSnap(!snap)} pressed={snap} />
      </div>

      <PropertiesBar
        item={sel}
        fieldSettings={fieldSettings}
        onFieldSettings={setFieldSettings}
        onPatch={(attrs) => sel && patchItem(itemId(sel), attrs)}
        onDuplicate={() => sel && add([duplicate(sel)])}
        onFront={() => sel && reorder(itemId(sel), true)}
        onBack={() => sel && reorder(itemId(sel), false)}
        onDelete={() => sel && remove(itemId(sel))}
        onEditText={() => sel && setEditing(itemId(sel))}
      />

      <div
        ref={hostRef}
        className="cv-host cv-design-host"
        tabIndex={0}
        aria-label="Canvas"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setSelected(null)
        }}
      >
        <div className="cv-view" style={{ height: (height + 18) * scale }}>
          <div
            className="cv-page cv-design prose"
            style={{ width: CANVAS_WIDTH, height, transform: `scale(${scale})` }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setSelected(null)
                setFieldSettings(false)
                hostRef.current?.focus()
              }
            }}
          >
            {items.map((it) => {
              const b = boxOf(it)
              const id = itemId(it)
              const isSel = id === selected
              return (
                <div
                  key={id}
                  className={`cv-item cv-type-${it.type} ${isSel ? 'selected' : ''}`}
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                  data-label={it.type === 'formField' ? String(it.attrs?.label ?? '') : undefined}
                  onPointerDown={(e) => startDrag(e, it, MOVE)}
                  onDoubleClick={() => {
                    if (it.type === 'canvasText') setEditing(id)
                    if (it.type === 'formField') setFieldSettings(true)
                  }}
                >
                  {editing === id ? (
                    <TextEditor
                      item={it}
                      onDone={(text) => {
                        setEditing(null)
                        if (text !== String(it.attrs?.text ?? '')) patchItem(id, { text })
                        hostRef.current?.focus()
                      }}
                    />
                  ) : (
                    <>
                      <CanvasItemContent item={it} live={false} />
                      <div className="cv-shield" />
                    </>
                  )}
                  {isSel &&
                    editing !== id &&
                    HANDLES.map((h) => (
                      <span
                        key={h.id}
                        className={`cv-handle cv-handle-${h.id}`}
                        style={{ transform: `scale(${1 / scale})` }}
                        onPointerDown={(e) => startDrag(e, it, h.edges)}
                        aria-hidden
                      />
                    ))}
                </div>
              )
            })}
            {guides.map((g, i) => (
              <div key={i} className={`cv-guide cv-guide-${g.axis}`} style={g.axis === 'x' ? { left: g.at } : { top: g.at }} />
            ))}
            {!items.length && <div className="cv-empty-page">Add text, fields, pictures and more from the bar above, then drag them anywhere.</div>}
          </div>
          <div className="cv-page-resize" style={{ width: CANVAS_WIDTH * scale }} onPointerDown={startPageResize} title="Drag to make the page taller or shorter">
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolButton({ icon, label, title, onClick }: { icon: React.ReactNode; label: string; title?: string; onClick: () => void }) {
  return (
    <button type="button" className="cv-tool" title={title ?? label} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function IconButton({ icon, label, onClick, disabled, pressed }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${pressed ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  )
}

/** Typing into a text item, in place */
function TextEditor({ item, onDone }: { item: DocJSON; onDone: (text: string) => void }) {
  const st = textStyle(item)
  const [text, setText] = useState(String(item.attrs?.text ?? ''))
  return (
    <textarea
      className="cv-edit-text"
      value={text}
      aria-label="Text"
      style={{ fontSize: st.size, fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal', color: st.color || undefined, textAlign: st.align }}
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          onDone(text)
        }
      }}
    />
  )
}

function Swatches({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <span className="cv-swatches" role="radiogroup" aria-label={label}>
      {options.map((c) => (
        <button
          key={c || 'none'}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c || 'Default'}
          title={c || 'Default'}
          className={`cv-swatch ${value === c ? 'on' : ''} ${c ? '' : 'none'}`}
          style={{ background: c || undefined }}
          onClick={() => onChange(c)}
        />
      ))}
    </span>
  )
}

function NumberBox({ label, value, onChange, min = 0, max = 4000 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="cv-num">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        max={max}
        aria-label={label}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
    </label>
  )
}

/** Settings for the selected item: position and size, plus what fits its kind. */
function PropertiesBar({
  item,
  fieldSettings,
  onFieldSettings,
  onPatch,
  onDuplicate,
  onFront,
  onBack,
  onDelete,
  onEditText
}: {
  item: DocJSON | null
  fieldSettings: boolean
  onFieldSettings: (open: boolean) => void
  onPatch: (attrs: Record<string, unknown>) => void
  onDuplicate: () => void
  onFront: () => void
  onBack: () => void
  onDelete: () => void
  onEditText: () => void
}) {
  if (!item) return <div className="cv-props cv-props-empty muted">Click something to change it. Drag to move, drag its corners to resize, double-click text to type. Hold Alt while dragging to place it freely.</div>
  const b = boxOf(item)
  const a = item.attrs ?? {}
  const setBox = (patch: Partial<Box>): void => onPatch({ box: clampBox({ ...b, ...patch }) })
  const st = textStyle(item)
  const setStyle = (patch: Partial<TextStyle>): void => onPatch({ style: { ...st, ...patch } })
  return (
    <div className="cv-props" role="group" aria-label="Selected item">
      <NumberBox label="X" value={b.x} onChange={(x) => setBox({ x })} max={CANVAS_WIDTH} />
      <NumberBox label="Y" value={b.y} onChange={(y) => setBox({ y })} />
      <NumberBox label="W" value={b.w} onChange={(w) => setBox({ w })} min={8} max={CANVAS_WIDTH} />
      <NumberBox label="H" value={b.h} onChange={(h) => setBox({ h })} min={8} />
      <span className="cv-props-sep" />

      {item.type === 'canvasText' && (
        <>
          <button type="button" className="btn sm" onClick={onEditText}>
            Edit text
          </button>
          <NumberBox label="Size" value={st.size} onChange={(size) => setStyle({ size })} min={8} max={96} />
          <IconButton icon={<Bold />} label="Bold" pressed={st.bold} onClick={() => setStyle({ bold: !st.bold })} />
          <IconButton icon={<Italic />} label="Italic" pressed={st.italic} onClick={() => setStyle({ italic: !st.italic })} />
          <IconButton icon={<AlignLeft />} label="Align left" pressed={st.align === 'left'} onClick={() => setStyle({ align: 'left' })} />
          <IconButton icon={<AlignCenter />} label="Centre" pressed={st.align === 'center'} onClick={() => setStyle({ align: 'center' })} />
          <IconButton icon={<AlignRight />} label="Align right" pressed={st.align === 'right'} onClick={() => setStyle({ align: 'right' })} />
          <Swatches label="Text colour" value={st.color} options={COLORS} onChange={(color) => setStyle({ color })} />
        </>
      )}

      {item.type === 'formField' && (
        <span className="cv-field-settings">
          <button type="button" className="btn sm" onClick={() => onFieldSettings(!fieldSettings)} aria-expanded={fieldSettings}>
            <Settings2 /> Field settings
          </button>
          {fieldSettings && (
            <FieldConfig
              attrs={fieldAttrs(a)}
              onSave={(next) => {
                onPatch(next)
                onFieldSettings(false)
              }}
              onDelete={onDelete}
              onCancel={() => onFieldSettings(false)}
            />
          )}
        </span>
      )}

      {item.type === 'canvasShape' && (
        <>
          {a.shape !== 'line' && <Swatches label="Fill" value={String(a.fill ?? '')} options={FILLS} onChange={(fill) => onPatch({ fill })} />}
          <Swatches label="Border colour" value={String(a.borderColor ?? '')} options={COLORS} onChange={(borderColor) => onPatch({ borderColor })} />
          <NumberBox label="Border" value={Number(a.borderWidth ?? 2)} onChange={(borderWidth) => onPatch({ borderWidth })} max={12} />
          {a.shape !== 'line' && <NumberBox label="Corners" value={Number(a.radius ?? 8)} onChange={(radius) => onPatch({ radius })} max={80} />}
        </>
      )}

      {item.type === 'image' && (
        <span className="segmented sm" role="radiogroup" aria-label="Picture fit">
          <button type="button" role="radio" aria-checked={a.fit !== 'cover'} className={a.fit !== 'cover' ? 'active' : ''} onClick={() => onPatch({ fit: 'contain' })}>
            Fit
          </button>
          <button type="button" role="radio" aria-checked={a.fit === 'cover'} className={a.fit === 'cover' ? 'active' : ''} onClick={() => onPatch({ fit: 'cover' })}>
            Fill
          </button>
        </span>
      )}

      <span className="cv-toolbar-gap" />
      <IconButton icon={<Copy />} label="Duplicate (Ctrl+D)" onClick={onDuplicate} />
      <IconButton icon={<BringToFront />} label="Bring to front" onClick={onFront} />
      <IconButton icon={<SendToBack />} label="Send to back" onClick={onBack} />
      <IconButton icon={<Trash2 />} label="Delete (Del)" onClick={onDelete} />
    </div>
  )
}
