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

/**
 * What a copy holds. ProseMirror keeps the nodes around the selection (`includeParents`), so a piece of a toggle
 * came with the toggle wrapped round it, and pasting rebuilt a toggle around plain text or pulled the line you pasted
 * on into it. Now:
 * - text from a title (also a triple-click, which runs on to the start of the next line) is copied like any line of text;
 * - a selection starting in a toggle's body copies just those lines;
 * - a toggle cut through by the selection (title included) is copied as a whole toggle holding what was selected.
 */
export function copySlice(state: EditorState): Slice {
  const { $from, from, to } = state.selection
  if ($from.parent.type.name === 'detailsSummary') {
    const titleEnd = $from.end()
    const rest = to > titleEnd ? state.doc.textBetween(titleEnd, to, '\n', '￼').trim() : ''
    if (to <= titleEnd || !rest) {
      const text = state.doc.slice(from, Math.min(to, titleEnd)).content
      return new Slice(Fragment.from(state.schema.nodes.paragraph.create(null, text)), 1, 1)
    }
  }
  return closeToggles(state.selection.content())
}

function closeToggles(slice: Slice): Slice {
  const nodes: PMNode[] = []
  slice.content.forEach((n) => nodes.push(n))
  let { openStart, openEnd } = slice
  const isToggle = (n: PMNode | undefined): n is PMNode => n?.type.name === 'details'
  const whole = (n: PMNode): PMNode => n.type.createAndFill(n.attrs, n.content) ?? n

  if (openStart > 0 && isToggle(nodes[0])) {
    const first = nodes[0]
    const single = nodes.length === 1
    if (first.firstChild?.type.name === 'detailsContent') {
      // Started inside the body: only the lines (the body's own blocks)
      const lines: PMNode[] = []
      first.firstChild.content.forEach((n) => lines.push(n))
      nodes.splice(0, 1, ...lines)
      openStart = Math.max(0, openStart - 2)
      if (single) openEnd = Math.max(0, openEnd - 2)
    } else {
      nodes[0] = whole(first)
      openStart = 0
      if (single) openEnd = 0
    }
  }
  const last = nodes[nodes.length - 1]
  if (openEnd > 0 && isToggle(last) && last.firstChild?.type.name === 'detailsSummary') {
    nodes[nodes.length - 1] = whole(last)
    openEnd = 0
  }
  if (!nodes.length) return slice
  return new Slice(Fragment.fromArray(nodes), openStart, openEnd)
}

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
