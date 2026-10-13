import { useMemo, useRef, useState } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { BarChart3, Columns3, Minus, Plus, Rows3 } from 'lucide-react'
import { cellName, colName, evaluateSheet, formatCell, cellNumber, type ColumnFormat } from '../../../shared/sheet'
import { formatCurrency } from '../../../shared/api'

/**
 * A spreadsheet in a note: type numbers and text, or formulas like =A1*B1, =SUM(B2:B9), =AVERAGE(C2:C9).
 * Each column can show numbers, money or percent; the header row is bold; a chart can draw one column.
 */
export interface SheetChart {
  type: 'none' | 'bar' | 'line' | 'pie'
  label: number
  value: number
}
const parse = <T,>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string') return (raw as T) ?? fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
export const sheetCells = (attrs: Record<string, unknown>): string[][] => parse<string[][]>(attrs.cells, [['']])

export const Sheet = Node.create({
  name: 'sheet',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    const json = (name: string, fallback: unknown) => ({
      default: JSON.stringify(fallback),
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? JSON.stringify(fallback),
      renderHTML: (a: Record<string, unknown>) => ({ [`data-${name}`]: typeof a[name] === 'string' ? a[name] : JSON.stringify(a[name]) })
    })
    return {
      cells: json('cells', [
        ['Item', 'Qty', 'Price', 'Total'],
        ['', '', '', '=B2*C2'],
        ['', '', '', '=B3*C3'],
        ['Total', '', '', '=SUM(D2:D3)']
      ]),
      formats: json('formats', ['auto', 'number', 'money', 'money']),
      header: { default: true, parseHTML: (el) => el.getAttribute('data-header') !== 'false', renderHTML: (a) => ({ 'data-header': String(a.header) }) },
      chart: json('chart', { type: 'none', label: 0, value: 1 })
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-sheet]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-sheet': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(SheetView, { stopEvent: () => true }) // the grid handles its own clicks and keys
  }
})

const FORMATS: { id: ColumnFormat; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'number', label: '1,234.5' },
  { id: 'money', label: '$ Money' },
  { id: 'percent', label: '% Percent' },
  { id: 'text', label: 'Text' }
]

function SheetView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const cells = sheetCells(node.attrs)
  const formats = parse<ColumnFormat[]>(node.attrs.formats, [])
  const chart = parse<SheetChart>(node.attrs.chart, { type: 'none', label: 0, value: 1 })
  const header = node.attrs.header !== false
  const editable = editor.isEditable
  const rows = cells.length
  const cols = Math.max(1, ...cells.map((r) => r.length))
  const grid = cells.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
  const values = useMemo(() => evaluateSheet(grid), [node.attrs.cells])
  const [sel, setSel] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [editing, setEditing] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const save = (next: string[][], extra: Record<string, unknown> = {}): void => updateAttributes({ cells: JSON.stringify(next), ...extra })
  const setCell = (r: number, c: number, text: string): void => {
    const next = grid.map((row) => [...row])
    next[r][c] = text
    save(next)
  }
  const commit = (move?: 'down' | 'right' | 'left'): void => {
    if (editing === null) return
    if (editing !== grid[sel.r][sel.c]) setCell(sel.r, sel.c, editing)
    setEditing(null)
    if (move === 'down') setSel({ r: Math.min(rows - 1, sel.r + 1), c: sel.c })
    if (move === 'right') setSel({ r: sel.r, c: Math.min(cols - 1, sel.c + 1) })
    if (move === 'left') setSel({ r: sel.r, c: Math.max(0, sel.c - 1) })
    wrap.current?.focus()
  }
  const addRow = (): void => save([...grid.slice(0, sel.r + 1), Array(cols).fill(''), ...grid.slice(sel.r + 1)])
  const addCol = (): void =>
    save(
      grid.map((row) => [...row.slice(0, sel.c + 1), '', ...row.slice(sel.c + 1)]),
      { formats: JSON.stringify([...formats.slice(0, sel.c + 1), 'auto', ...formats.slice(sel.c + 1)]) }
    )
  const delRow = (): void => {
    if (rows < 2) return
    save(grid.filter((_, r) => r !== sel.r))
    setSel({ r: Math.max(0, sel.r - 1), c: sel.c })
  }
  const delCol = (): void => {
    if (cols < 2) return
    save(
      grid.map((row) => row.filter((_, c) => c !== sel.c)),
      { formats: JSON.stringify(formats.filter((_, c) => c !== sel.c)) }
    )
    setSel({ r: sel.r, c: Math.max(0, sel.c - 1) })
  }
  const onKey = (e: React.KeyboardEvent): void => {
    e.stopPropagation() // the sheet handles its own keys (not the note's editor)
    if (!editable || editing !== null) return
    const k = e.key
    if (k === 'ArrowDown') setSel({ r: Math.min(rows - 1, sel.r + 1), c: sel.c })
    else if (k === 'ArrowUp') setSel({ r: Math.max(0, sel.r - 1), c: sel.c })
    else if (k === 'ArrowRight' || k === 'Tab') setSel({ r: sel.r, c: Math.min(cols - 1, sel.c + 1) })
    else if (k === 'ArrowLeft') setSel({ r: sel.r, c: Math.max(0, sel.c - 1) })
    else if (k === 'Enter' || k === 'F2') setEditing(grid[sel.r][sel.c])
    else if (k === 'Delete' || k === 'Backspace') setCell(sel.r, sel.c, '')
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) setEditing(k)
    else return
    e.preventDefault()
  }

  const money = (cents: number): string => formatCurrency(cents)
  const shown = (r: number, c: number): string => {
    const v = values[r]?.[c] ?? null
    return formatCell(v, header && r === 0 ? 'text' : (formats[c] ?? 'auto'), money)
  }

  return (
    <NodeViewWrapper className={`sheet-block ${selected ? 'selected' : ''}`} contentEditable={false}>
      {editable && (
        <div className="sheet-toolbar">
          <span className="sheet-cell-name">{cellName(sel.r, sel.c)}</span>
          <input
            className="sheet-formula"
            aria-label="Cell contents"
            placeholder="Type a value, or a formula like =SUM(B2:B5)"
            value={editing ?? grid[sel.r]?.[sel.c] ?? ''}
            onFocus={() => editing === null && setEditing(grid[sel.r][sel.c])}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.preventDefault(), commit('down'))
              if (e.key === 'Escape') setEditing(null)
            }}
            onBlur={() => commit()}
          />
          <button type="button" className="icon-btn sm" title="Add a row below" aria-label="Add row" onClick={addRow}>
            <Rows3 />
            <Plus className="sheet-plus" />
          </button>
          <button type="button" className="icon-btn sm" title="Add a column to the right" aria-label="Add column" onClick={addCol}>
            <Columns3 />
            <Plus className="sheet-plus" />
          </button>
          <button type="button" className="icon-btn sm" title="Delete this row" aria-label="Delete row" disabled={rows < 2} onClick={delRow}>
            <Rows3 />
            <Minus className="sheet-plus" />
          </button>
          <button type="button" className="icon-btn sm" title="Delete this column" aria-label="Delete column" disabled={cols < 2} onClick={delCol}>
            <Columns3 />
            <Minus className="sheet-plus" />
          </button>
          <select
            aria-label="Column format"
            title={`How column ${colName(sel.c)} shows numbers`}
            value={formats[sel.c] ?? 'auto'}
            onChange={(e) => {
              const next = Array.from({ length: cols }, (_, c) => formats[c] ?? 'auto')
              next[sel.c] = e.target.value as ColumnFormat
              updateAttributes({ formats: JSON.stringify(next) })
            }}
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="sheet-check" title="Make the first row bold, as column titles">
            <input type="checkbox" checked={header} onChange={(e) => updateAttributes({ header: e.target.checked })} /> Header
          </label>
          <span className="sheet-chart-pick">
            <BarChart3 />
            <select aria-label="Chart" value={chart.type} onChange={(e) => updateAttributes({ chart: JSON.stringify({ ...chart, type: e.target.value, value: chart.type === 'none' ? cols - 1 : chart.value }) })}>
              <option value="none">No chart</option>
              <option value="bar">Bar chart</option>
              <option value="line">Line chart</option>
              <option value="pie">Pie chart</option>
            </select>
            {chart.type !== 'none' && (
              <>
                <select aria-label="Chart labels" title="Labels from column" value={chart.label} onChange={(e) => updateAttributes({ chart: JSON.stringify({ ...chart, label: Number(e.target.value) }) })}>
                  {Array.from({ length: cols }, (_, c) => (
                    <option key={c} value={c}>
                      Labels: {header ? grid[0][c] || colName(c) : colName(c)}
                    </option>
                  ))}
                </select>
                <select aria-label="Chart values" title="Values from column" value={chart.value} onChange={(e) => updateAttributes({ chart: JSON.stringify({ ...chart, value: Number(e.target.value) }) })}>
                  {Array.from({ length: cols }, (_, c) => (
                    <option key={c} value={c}>
                      Values: {header ? grid[0][c] || colName(c) : colName(c)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </span>
        </div>
      )}
      <div className="sheet-scroll" ref={wrap} tabIndex={0} onKeyDown={onKey} aria-label="Spreadsheet">
        <table className="sheet-grid">
          <thead>
            <tr>
              <th className="sheet-corner" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className={sel.c === c ? 'on' : ''}>
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r} className={header && r === 0 ? 'sheet-header-row' : ''}>
                <th className={sel.r === r ? 'on' : ''}>{r + 1}</th>
                {row.map((raw, c) => {
                  const isSel = sel.r === r && sel.c === c
                  const v = values[r]?.[c]
                  const numeric = typeof v === 'number' && !(header && r === 0)
                  const error = typeof v === 'string' && v.startsWith('#') && raw.startsWith('=')
                  return (
                    <td
                      key={c}
                      className={`${isSel ? 'sel' : ''} ${numeric ? 'num' : ''} ${error ? 'err' : ''} ${raw.startsWith('=') ? 'formula' : ''}`}
                      title={raw.startsWith('=') ? raw : undefined}
                      onMouseDown={(e) => {
                        if (!editable) return
                        e.preventDefault()
                        if (editing !== null && !isSel) commit()
                        setSel({ r, c })
                        wrap.current?.focus()
                      }}
                      onDoubleClick={() => editable && setEditing(raw)}
                    >
                      {isSel && editing !== null ? (
                        <input
                          autoFocus
                          className="sheet-input"
                          value={editing}
                          aria-label={`Cell ${cellName(r, c)}`}
                          onChange={(e) => setEditing(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') (e.preventDefault(), commit('down'))
                            else if (e.key === 'Tab') (e.preventDefault(), commit(e.shiftKey ? 'left' : 'right'))
                            else if (e.key === 'Escape') (setEditing(null), wrap.current?.focus())
                          }}
                          onBlur={() => commit()}
                        />
                      ) : (
                        shown(r, c)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.type !== 'none' && <SheetChartView grid={grid} values={values} chart={chart} header={header} />}
    </NodeViewWrapper>
  )
}

const CHART_COLORS = ['#2f6ae0', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#64748b']

/** A bar, line or pie chart of one column, labelled by another */
function SheetChartView({ grid, values, chart, header }: { grid: string[][]; values: ReturnType<typeof evaluateSheet>; chart: SheetChart; header: boolean }) {
  const data = grid
    .map((_, r) => r)
    .filter((r) => !(header && r === 0))
    .map((r) => ({ label: String(values[r]?.[chart.label] ?? grid[r][chart.label] ?? ''), value: typeof values[r]?.[chart.value] === 'number' ? (values[r][chart.value] as number) : (cellNumber(String(values[r]?.[chart.value] ?? '')) ?? NaN) }))
    .filter((d) => Number.isFinite(d.value) && d.label.toLowerCase() !== 'total')
  if (!data.length) return <div className="sheet-chart empty muted small">Put numbers in the values column to see a chart.</div>
  const W = 640
  const H = 220
  const max = Math.max(...data.map((d) => d.value), 0) || 1
  if (chart.type === 'pie') {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1
    let a = -Math.PI / 2
    return (
      <div className="sheet-chart">
        <svg viewBox="0 0 640 220" role="img" aria-label="Pie chart">
          {data.map((d, i) => {
            const share = Math.max(0, d.value) / total
            const b = a + share * Math.PI * 2
            const large = share > 0.5 ? 1 : 0
            const p = (ang: number) => `${110 + 95 * Math.cos(ang)} ${110 + 95 * Math.sin(ang)}`
            const path = share >= 0.999 ? 'M110 15 A95 95 0 1 1 109.9 15Z' : `M110 110 L${p(a)} A95 95 0 ${large} 1 ${p(b)} Z`
            a = b
            return <path key={i} d={path} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          })}
          {data.map((d, i) => (
            <g key={`l${i}`} transform={`translate(240 ${20 + i * 22})`}>
              <rect width="12" height="12" rx="2" fill={CHART_COLORS[i % CHART_COLORS.length]} />
              <text x="20" y="11" fontSize="13" fill="currentColor">
                {d.label || '—'} · {Math.round((Math.max(0, d.value) / total) * 100)}%
              </text>
            </g>
          ))}
        </svg>
      </div>
    )
  }
  const step = (W - 40) / data.length
  const y = (v: number): number => H - 30 - (Math.max(0, v) / max) * (H - 50)
  return (
    <div className="sheet-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chart.type === 'bar' ? 'Bar' : 'Line'} chart`}>
        <line x1="30" y1={H - 30} x2={W - 10} y2={H - 30} stroke="currentColor" strokeOpacity="0.25" />
        {chart.type === 'bar'
          ? data.map((d, i) => <rect key={i} x={34 + i * step + step * 0.15} y={y(d.value)} width={step * 0.7} height={H - 30 - y(d.value)} rx="3" fill={CHART_COLORS[0]} />)
          : (
            <polyline fill="none" stroke={CHART_COLORS[0]} strokeWidth="3" strokeLinejoin="round" points={data.map((d, i) => `${34 + i * step + step / 2},${y(d.value)}`).join(' ')} />
          )}
        {data.map((d, i) => (
          <g key={`t${i}`}>
            <text x={34 + i * step + step / 2} y={H - 12} fontSize="12" textAnchor="middle" fill="currentColor" opacity="0.7">
              {d.label.slice(0, 14)}
            </text>
            <text x={34 + i * step + step / 2} y={y(d.value) - 5} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.8">
              {d.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
