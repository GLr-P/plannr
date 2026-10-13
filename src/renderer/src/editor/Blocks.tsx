import { useEffect, useState } from 'react'
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Calculator, ListTree } from 'lucide-react'
import { calculate } from '../../../shared/sheet'

/** Side-by-side columns (2 or 3), each holding any blocks */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-columns]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-columns': '', class: `columns columns-${node.childCount}` }), 0]
  }
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'column' }), 0]
  }
})

export const columnsContent = (n: number) => ({ type: 'columns', content: Array.from({ length: n }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) })

/** A table of contents: the note's headings, kept up to date; click one to go there */
export const TableOfContents = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(TocView)
  }
})

export interface Heading {
  level: number
  text: string
  pos: number
}
export function headingsOf(doc: { descendants: (f: (node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }, pos: number) => void) => void }): Heading[] {
  const out: Heading[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) out.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos })
  })
  return out
}

function TocView({ editor, selected }: NodeViewProps) {
  const [items, setItems] = useState<Heading[]>(() => headingsOf(editor.state.doc))
  useEffect(() => {
    const update = (): void => setItems(headingsOf(editor.state.doc))
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])
  return (
    <NodeViewWrapper className={`toc-block ${selected ? 'selected' : ''}`} contentEditable={false}>
      <div className="toc-title">
        <ListTree /> Contents
      </div>
      {items.length === 0 ? (
        <div className="muted small">Add headings (type / then Heading) and they’ll be listed here.</div>
      ) : (
        <ol className="toc-list">
          {items.map((h, i) => (
            <li key={i} className={`toc-l${h.level}`}>
              <button type="button" className="link-like" onClick={() => scrollToHeading(editor, h.pos)}>
                {h.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  )
}

export function scrollToHeading(editor: { view: { nodeDOM: (pos: number) => unknown } }, pos: number): void {
  const el = editor.view.nodeDOM(pos)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1200)
  }
}

/** One line of arithmetic with its answer: 12 × 3.5 + 10% = 46.2 */
export const MathLine = Node.create({
  name: 'mathLine',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { expr: { default: '', parseHTML: (el) => el.getAttribute('data-expr') ?? '', renderHTML: (a) => ({ 'data-expr': a.expr }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-math]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { stopEvent: () => true })
  }
})

function MathView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const [expr, setExpr] = useState(String(node.attrs.expr ?? ''))
  const result = calculate(expr)
  return (
    <NodeViewWrapper className={`math-line ${selected ? 'selected' : ''}`} contentEditable={false}>
      <Calculator className="math-icon" />
      <input
        value={expr}
        placeholder="Type a calculation, e.g. 1299 * 0.12 + 45"
        aria-label="Calculation"
        readOnly={!editor.isEditable}
        onChange={(e) => {
          setExpr(e.target.value)
          updateAttributes({ expr: e.target.value })
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span className={`math-result ${result === null ? 'empty' : ''}`}>= {result === null ? '…' : result.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
      {result !== null && (
        <button type="button" className="link-btn small" onClick={() => void navigator.clipboard.writeText(String(result))}>
          Copy
        </button>
      )}
    </NodeViewWrapper>
  )
}

/** Left / centre / right / justified paragraphs and headings */
export const TextAlign = Extension.create({
  name: 'textAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el) => el.style.textAlign || null,
            renderHTML: (a) => (a.textAlign ? { style: `text-align: ${a.textAlign}` } : {})
          }
        }
      }
    ]
  }
})
