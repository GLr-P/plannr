import type { MouseEvent } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { BookmarkPlus, ChevronDown, ChevronUp, FileText, MoreHorizontal, Save, X } from 'lucide-react'
import { ICONS } from '../lib/icons'
import { findSection, sectionPreset } from '../../../shared/ticket-sections'
import type { DocJSON } from '../../../shared/api'
import { showToast, undoToast } from '../lib/toast'
import { openMenu } from '../components/ContextMenu'
import { newSectionId, useSections } from '../store/sections'

/**
 * A ticket section: a named block (Passcode & logins, Work done, or one of yours) added with + Add.
 * Its name is typed over in place; the arrows move it, × removes it, and ⋯ saves it to your sections so + Add and
 * the / menu offer it next time (a built-in one saves as your version of it).
 * Stored as `ticketSection` with attrs `preset` (which section it came from) and `title`.
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
  const lib = useSections((s) => s.lib)
  const presetId = String(node.attrs.preset ?? '')
  const preset = findSection(presetId, lib)
  const Icon = (preset && ICONS[preset.icon]) || FileText
  const title = String(node.attrs.title ?? '')
  const editable = editor.isEditable

  /** Swaps this section with the one above or below it */
  const move = (dir: -1 | 1): void => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos === undefined) return
    const $pos = editor.state.doc.resolve(pos)
    const other = $pos.parent.maybeChild($pos.index() + dir)
    if (!other) return
    const tr = editor.state.tr
    if (dir === -1) tr.delete(pos, pos + node.nodeSize).insert(pos - other.nodeSize, node)
    else tr.insert(pos + node.nodeSize + other.nodeSize, node).delete(pos, pos + node.nodeSize)
    editor.view.dispatch(tr.scrollIntoView())
  }

  /**
   * From the name into the section, right away: its first fill-in box, or the start of its first line. (The editor's
   * focus command waits a frame, so the next key used to land in the name.)
   */
  const enterBody = (from: HTMLElement): void => {
    const box = from.closest('.ticket-section')?.querySelector<HTMLElement>('.ticket-section-body input, .ticket-section-body textarea, .ticket-section-body select')
    if (box) return box.focus()
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos === undefined) return
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 2))))
    editor.view.focus()
  }

  const remove = (): void => {
    deleteNode()
    undoToast(`Removed “${title || 'Section'}”`, () => {
      editor.commands.undo()
    })
  }

  /** Saves this section's boxes (answers emptied) to your sections, under `id` */
  const save = async (id: string, verb: string): Promise<void> => {
    const content = (node.toJSON() as { content?: DocJSON[] }).content ?? []
    const base = findSection(id, lib) ?? preset
    const hint = base?.hint && base.hint !== 'Your section' ? base.hint : 'Your section'
    await useSections.getState().saveSection({ id, title: title || 'Section', icon: base?.icon ?? 'FileText', group: base?.group ?? 'other', hint, content })
    if (id !== presetId) updateAttributes({ preset: id })
    showToast(`${verb} “${title || 'Section'}”. It’s in + Add and the / menu.`)
  }

  const openMore = (e: MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const builtIn = sectionPreset(presetId)
    const mine = !builtIn && lib.custom.some((c) => c.id === presetId)
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
      ...(mine
        ? [{ label: 'Update it in your sections', icon: <Save />, onSelect: () => save(presetId, 'Updated') }]
        : builtIn
          ? [{ label: `Save as your version of “${builtIn.title}”`, icon: <Save />, onSelect: () => save(presetId, 'Saved your version of') }]
          : []),
      { label: 'Save as a new section', icon: <BookmarkPlus />, onSelect: () => save(newSectionId(), 'Saved') },
      'separator',
      { label: 'Move up', icon: <ChevronUp />, onSelect: () => move(-1) },
      { label: 'Move down', icon: <ChevronDown />, onSelect: () => move(1) },
      { label: 'Remove from this ticket', icon: <X />, onSelect: remove }
    ])
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
                enterBody(e.currentTarget)
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
            <button type="button" className="icon-btn sm" aria-label={`More for “${title}”`} title="Save to your sections, and more" onClick={openMore}>
              <MoreHorizontal />
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
