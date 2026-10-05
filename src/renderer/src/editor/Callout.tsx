import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { AlertTriangle, Info, Lightbulb, OctagonAlert, StickyNote } from 'lucide-react'

export const CALLOUT_TONES = [
  { id: 'info', label: 'Info', icon: Info },
  { id: 'tip', label: 'Tip', icon: Lightbulb },
  { id: 'warning', label: 'Warning', icon: AlertTriangle },
  { id: 'danger', label: 'Important', icon: OctagonAlert },
  { id: 'note', label: 'Note', icon: StickyNote }
] as const

/** A coloured box with an icon, for tips and warnings. Click the icon to change its kind. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: { default: 'info', parseHTML: (el) => el.getAttribute('data-tone') ?? 'info', renderHTML: (a) => ({ 'data-tone': a.tone }) }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  }
})

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const at = CALLOUT_TONES.findIndex((t) => t.id === node.attrs.tone)
  const tone = CALLOUT_TONES[at < 0 ? 0 : at]
  const Icon = tone.icon
  return (
    <NodeViewWrapper className={`callout callout-${tone.id}`}>
      <button
        type="button"
        className="callout-icon"
        contentEditable={false}
        title={editor.isEditable ? `${tone.label}. Click to change` : tone.label}
        aria-label={`Callout: ${tone.label}`}
        disabled={!editor.isEditable}
        onClick={() => updateAttributes({ tone: CALLOUT_TONES[(Math.max(at, 0) + 1) % CALLOUT_TONES.length].id })}
      >
        <Icon />
      </button>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}
