import { useRef, useState } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { ArrowUpRight, Circle, Eraser, Highlighter, Minus, Pencil, Redo2, Square, Trash2, Undo2 } from 'lucide-react'
import { DRAW_WIDTH, hitsStroke, parseStrokes, strokePath, type DrawTool, type Stroke } from '../../../shared/drawing'

/** A drawing in a note: pen, marker, eraser, lines, arrows, boxes and circles, in any colour. */
export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      strokes: { default: '[]', parseHTML: (el) => el.getAttribute('data-strokes') ?? '[]', renderHTML: (a) => ({ 'data-strokes': typeof a.strokes === 'string' ? a.strokes : JSON.stringify(a.strokes) }) },
      height: { default: 420, parseHTML: (el) => Number(el.getAttribute('data-height')) || 420, renderHTML: (a) => ({ 'data-height': String(a.height) }) },
      paper: { default: 'plain', parseHTML: (el) => el.getAttribute('data-paper') ?? 'plain', renderHTML: (a) => ({ 'data-paper': a.paper }) }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-drawing]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-drawing': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView, { stopEvent: () => true }) // the drawing handles its own pointer and keys
  }
})

function DrawingView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`drawing-block ${selected ? 'selected' : ''}`} contentEditable={false}>
      <DrawingPad
        strokes={parseStrokes(node.attrs.strokes)}
        height={Number(node.attrs.height) || 420}
        paper={String(node.attrs.paper ?? 'plain')}
        editable={editor.isEditable}
        onChange={(strokes) => updateAttributes({ strokes: JSON.stringify(strokes) })}
        onHeight={(height) => updateAttributes({ height })}
        onPaper={(paper) => updateAttributes({ paper })}
      />
    </NodeViewWrapper>
  )
}

const COLORS = ['#22221f', '#d23f3f', '#2f6ae0', '#16a34a', '#f59e0b', '#7c3aed', '#db2777', '#ffffff']
const SIZES = [3, 6, 12]
const TOOLS: { id: DrawTool; label: string; icon: React.ReactNode }[] = [
  { id: 'pen', label: 'Pen', icon: <Pencil /> },
  { id: 'marker', label: 'Highlighter', icon: <Highlighter /> },
  { id: 'eraser', label: 'Eraser (touch a line to remove it)', icon: <Eraser /> },
  { id: 'line', label: 'Straight line', icon: <Minus /> },
  { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight /> },
  { id: 'rect', label: 'Box', icon: <Square /> },
  { id: 'ellipse', label: 'Circle', icon: <Circle /> }
]

/** The drawing surface with its tools; used in notes and on free-form pages */
export function DrawingPad({
  strokes,
  height,
  paper = 'plain',
  editable,
  onChange,
  onHeight,
  onPaper,
  fill = false
}: {
  strokes: Stroke[]
  height: number
  paper?: string
  editable: boolean
  onChange: (strokes: Stroke[]) => void
  onHeight?: (h: number) => void
  onPaper?: (paper: string) => void
  /** Fill the parent box (free-form pages) instead of keeping its own height */
  fill?: boolean
}) {
  const [tool, setTool] = useState<DrawTool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[0])
  const [live, setLive] = useState<Stroke | null>(null)
  const [redo, setRedo] = useState<Stroke[][]>([])
  const svg = useRef<SVGSVGElement>(null)
  const drawing = useRef<Stroke | null>(null)
  const current = useRef(strokes)
  current.current = strokes

  const point = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    const k = DRAW_WIDTH / r.width
    return [Math.round((e.clientX - r.left) * k * 10) / 10, Math.round((e.clientY - r.top) * k * 10) / 10]
  }
  const erase = (x: number, y: number): void => {
    const left = current.current.filter((s) => !hitsStroke(s, x, y, 10))
    if (left.length !== current.current.length) {
      current.current = left
      onChange(left)
    }
  }
  const down = (e: React.PointerEvent): void => {
    if (!editable || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    svg.current?.setPointerCapture(e.pointerId)
    const [x, y] = point(e)
    if (tool === 'eraser') return erase(x, y)
    drawing.current = { tool, color, size: tool === 'marker' ? size * 3 : size, points: [x, y] }
    setLive({ ...drawing.current })
  }
  const move = (e: React.PointerEvent): void => {
    if (!editable) return
    const [x, y] = point(e)
    if (tool === 'eraser' && e.buttons === 1) return erase(x, y)
    const s = drawing.current
    if (!s) return
    if (s.tool === 'pen' || s.tool === 'marker') s.points.push(x, y)
    else s.points = [s.points[0], s.points[1], x, y]
    setLive({ ...s, points: [...s.points] })
  }
  const up = (): void => {
    const s = drawing.current
    drawing.current = null
    setLive(null)
    if (!s) return
    setRedo([])
    onChange([...current.current, s])
  }
  const undo = (): void => {
    if (!strokes.length) return
    setRedo((r) => [...r, strokes.slice(-1)])
    onChange(strokes.slice(0, -1))
  }
  const redoOne = (): void => {
    const last = redo[redo.length - 1]
    if (!last) return
    setRedo((r) => r.slice(0, -1))
    onChange([...strokes, ...last])
  }

  return (
    <div className={`draw-pad ${fill ? 'fill' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
      {editable && (
        <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools" onPointerDown={(e) => e.stopPropagation()}>
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={`icon-btn sm ${tool === t.id ? 'on' : ''}`} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              {t.icon}
            </button>
          ))}
          <span className="draw-sep" />
          {COLORS.map((c) => (
            <button key={c} type="button" className={`draw-color ${color === c ? 'on' : ''}`} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
          ))}
          <span className="draw-sep" />
          {SIZES.map((s) => (
            <button key={s} type="button" className={`draw-size ${size === s ? 'on' : ''}`} title={`Thickness ${s}`} aria-label={`Thickness ${s}`} onClick={() => setSize(s)}>
              <span style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
          <span className="draw-sep" />
          <button type="button" className="icon-btn sm" title="Undo" aria-label="Undo drawing" disabled={!strokes.length} onClick={undo}>
            <Undo2 />
          </button>
          <button type="button" className="icon-btn sm" title="Redo" aria-label="Redo drawing" disabled={!redo.length} onClick={redoOne}>
            <Redo2 />
          </button>
          <button type="button" className="icon-btn sm" title="Clear the drawing" aria-label="Clear drawing" disabled={!strokes.length} onClick={() => (setRedo((r) => [...r, strokes]), onChange([]))}>
            <Trash2 />
          </button>
          {onPaper && (
            <select className="draw-paper" aria-label="Paper" value={paper} onChange={(e) => onPaper(e.target.value)}>
              <option value="plain">Plain</option>
              <option value="grid">Grid</option>
              <option value="dots">Dots</option>
              <option value="lines">Lines</option>
            </select>
          )}
        </div>
      )}
      <div className="draw-frame" style={fill ? undefined : { aspectRatio: `${DRAW_WIDTH} / ${Math.round(height)}` }}>
      <svg
        ref={svg}
        className={`draw-surface paper-${paper} ${editable ? `tool-${tool}` : ''}`}
        viewBox={`0 0 ${DRAW_WIDTH} ${Math.round(height)}`}
        preserveAspectRatio={fill ? 'none' : 'xMidYMid meet'}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="Drawing"
        role="img"
      >
        {[...strokes, ...(live ? [live] : [])].map((s, i) => (
          <StrokeView key={i} s={s} />
        ))}
      </svg>
      </div>
      {editable && onHeight && !fill && (
        <div
          className="draw-resize"
          title="Drag to make the drawing taller or shorter"
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const startY = e.clientY
            const k = DRAW_WIDTH / (svg.current?.getBoundingClientRect().width || DRAW_WIDTH)
            const start = height
            const onMove = (ev: PointerEvent): void => onHeight(Math.max(160, Math.min(3000, Math.round(start + (ev.clientY - startY) * k))))
            const onUp = (): void => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        />
      )}
    </div>
  )
}

function StrokeView({ s }: { s: Stroke }) {
  const [x1, y1] = [s.points[0] ?? 0, s.points[1] ?? 0]
  const [x2, y2] = [s.points[s.points.length - 2] ?? x1, s.points[s.points.length - 1] ?? y1]
  const p = { stroke: s.color, strokeWidth: s.size, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  switch (s.tool) {
    case 'line':
      return <line x1={x1} y1={y1} x2={x2} y2={y2} {...p} />
    case 'arrow': {
      const a = Math.atan2(y2 - y1, x2 - x1)
      const h = Math.max(12, s.size * 4)
      const pt = (da: number) => `${x2 - h * Math.cos(a + da)},${y2 - h * Math.sin(a + da)}`
      return (
        <g>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...p} />
          <polyline points={`${pt(0.45)} ${x2},${y2} ${pt(-0.45)}`} {...p} />
        </g>
      )
    }
    case 'rect':
      return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={6} {...p} />
    case 'ellipse':
      return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} {...p} />
    case 'marker':
      return <path d={strokePath(s.points)} {...p} strokeOpacity={0.35} />
    default:
      return <path d={strokePath(s.points)} {...p} />
  }
}
