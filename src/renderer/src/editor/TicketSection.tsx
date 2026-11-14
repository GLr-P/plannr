import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { ChevronDown, ChevronUp, FileText, X } from 'lucide-react'
import { ICONS } from '../lib/icons'
import { sectionPreset } from '../../../shared/ticket-sections'
import { undoToast } from '../lib/toast'

/**
 * A ticket section: a named block (Passcode & logins, Work done…) added with + Add and removed with its ×.
 * Its name can be changed by clicking it. Stored as `ticketSection` with attrs `preset` (which built-in section it
 * came from, so + Add can tick it) and `title`.
 */
export const TicketSection = Node.create({
  name: 'ticketSection',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      preset: { default: '', parseHTML: (el) => el.getAttribute('data-preset') ?? '', renderHTML: (a) => ({ 'data-preset': a.preset }) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') ?? '', renderHTML: (a) => ({ 'data-title': a.title }) }
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-ticket-section]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-ticket-section': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TicketSectionView)
  }
})

function TicketSectionView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const preset = sectionPreset(String(node.attrs.preset))
  const Icon = (preset && ICONS[preset.icon]) || FileText
  const title = String(node.attrs.title ?? '')
  const editable = editor.isEditable

  /** Swaps this section with the one above or below it */
  const move = (dir: -1 | 1): void => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos === undefined) return
    const $pos = editor.state.doc.resolve(pos)
    const parent = $pos.parent
    const index = $pos.index()
    const other = parent.maybeChild(index + dir)
    if (!other) return
    const tr = editor.state.tr
    if (dir === -1) {
      const start = pos - other.nodeSize
      tr.delete(pos, pos + node.nodeSize).insert(start, node)
    } else {
      tr.insert(pos + node.nodeSize + other.nodeSize, node).delete(pos, pos + node.nodeSize)
    }
    editor.view.dispatch(tr.scrollIntoView())
  }

  const remove = (): void => {
    deleteNode()
    undoToast(`Removed “${title || 'Section'}”`, () => {
      editor.commands.undo()
    })
  }

  return (
    <NodeViewWrapper className="ticket-section" data-preset={node.attrs.preset}>
      <div className="ticket-section-head" contentEditable={false}>
        <Icon className="ticket-section-icon" />
        {editable ? (
          <input
            className="ticket-section-title"
            value={title}
            placeholder="Section name"
            aria-label="Section name"
            onChange={(e) => updateAttributes({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                editor.commands.focus()
              }
            }}
          />
        ) : (
          <span className="ticket-section-title">{title}</span>
        )}
        {editable && (
          <span className="ticket-section-tools">
            <button type="button" className="icon-btn sm" aria-label={`Move “${title}” up`} title="Move up" onClick={() => move(-1)}>
              <ChevronUp />
            </button>
            <button type="button" className="icon-btn sm" aria-label={`Move “${title}” down`} title="Move down" onClick={() => move(1)}>
              <ChevronDown />
            </button>
            <button type="button" className="icon-btn sm" aria-label={`Remove “${title}”`} title="Remove section" onClick={remove}>
              <X />
            </button>
          </span>
        )}
      </div>
      <NodeViewContent className="ticket-section-body" />
    </NodeViewWrapper>
  )
}
