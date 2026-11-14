import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * A toggle's title only holds one line of text. ProseMirror pastes blocks into it by splitting the toggle apart
 * (empty toggles, text spilling outside), so pastes there are handled here instead:
 * - one line of text (part of a paragraph, a heading, a list item, another title) goes into the title, formatting kept;
 * - anything bigger (several lines, pictures, tables, a whole toggle) goes at the top of the toggle's body.
 * Pure apart from `pasteIntoToggle`, so the unit tests run it without a window.
 */

/** Position of the toggle whose title holds the selection (both ends), or null */
export function toggleTitleAt(state: EditorState, from = state.selection.from, to = state.selection.to): number | null {
  const $from = state.doc.resolve(from)
  if ($from.parent.type.name !== 'detailsSummary' || !$from.sameParent(state.doc.resolve(to))) return null
  return $from.before(-1)
}

/** Inside the toggle's body, before its first block */
export function toggleBodyStart(doc: PMNode, detailsPos: number): number {
  return detailsPos + 1 + doc.nodeAt(detailsPos)!.child(0).nodeSize + 1
}

/** The pasted text as title content, or null when it's more than one line of plain(ly formatted) text */
export function titleContent(slice: Slice, summary: PMNode): Fragment | null {
  const blocks: PMNode[] = []
  let rich = false
  slice.content.descendants((node) => {
    if (rich) return false
    if (node.isTextblock) {
      if (node.content.size) blocks.push(node)
      return false
    }
    if (node.isText) {
      blocks.push(node) // an inline slice (no surrounding block)
      return false
    }
    // pictures, fields, drawings, spreadsheets, a toggle's body (a whole toggle, not just part of a title)…
    if (node.isLeaf || node.isAtom || node.type.name === 'table' || node.type.name === 'detailsContent') rich = true
    return !rich
  })
  if (rich || blocks.length > 1) return null
  const schema = summary.type.schema
  const nodes: PMNode[] = []
  const inline = blocks[0] ? (blocks[0].isText ? Fragment.from(blocks[0]) : blocks[0].content) : Fragment.empty
  let ok = true
  inline.forEach((n) => {
    if (n.isText) nodes.push(schema.text(n.text!, n.marks.filter((m) => summary.type.allowsMarkType(m.type))))
    else if (n.type.name === 'hardBreak') nodes.push(schema.text(' '))
    else ok = false // @-links and other inline pieces a title can't hold
  })
  return ok ? Fragment.from(nodes) : null
}

/** Puts the text into the title in place of the selection; the cursor ends after it */
export function pasteIntoTitle(state: EditorState, content: Fragment): Transaction {
  const { from, to } = state.selection
  const tr = state.tr.replaceWith(from, to, content)
  tr.setSelection(TextSelection.create(tr.doc, from + content.size))
  return tr
}

/** Puts the pasted piece at the top of an (open) toggle's body, replacing an empty first line */
export function pasteIntoBody(state: EditorState, detailsPos: number, slice: Slice): Transaction {
  const start = toggleBodyStart(state.doc, detailsPos)
  const first = state.doc.nodeAt(start)
  const end = first && first.isTextblock && first.content.size === 0 ? start + first.nodeSize : start
  const tr = state.tr.replaceRange(start, end, slice)
  const after = tr.mapping.map(end, 1)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size)), -1))
  return tr
}

/** Opens a closed toggle on its own: opening and moving the cursor in one step leaves the browser cursor in the title */
export function openToggle(view: EditorView, detailsPos: number): void {
  const details = view.state.doc.nodeAt(detailsPos)
  if (details && !details.attrs.open) view.dispatch(view.state.tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true }))
}

/** Handles a paste whose target is a toggle's title. Returns false when the selection isn't in one. */
export function pasteIntoToggle(view: EditorView, slice: Slice): boolean {
  const detailsPos = toggleTitleAt(view.state)
  if (detailsPos === null) return false
  const summary = view.state.doc.nodeAt(detailsPos)!.child(0)
  const text = titleContent(slice, summary)
  if (text) {
    view.dispatch(pasteIntoTitle(view.state, text).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
    return true
  }
  openToggle(view, detailsPos)
  view.dispatch(pasteIntoBody(view.state, detailsPos, slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
  return true
}
