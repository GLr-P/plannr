import { Extension, textblockTypeInputRule } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

/**
 * Keys that should behave the way people expect while writing a page:
 * - ``` turns the line into a code block straight away (TipTap waited for a space and took the first word typed
 *   after it as a hidden "language", so "```chkdsk " lost "chkdsk");
 * - Backspace at the start of a heading turns it back into normal text instead of merging it into the line above;
 * - Tab never leaves the page: lists indent, tables and code blocks handle it themselves, columns move to the next
 *   column, and anywhere else it does nothing (it used to move focus to a checkbox, which the next space ticked).
 */

/** Start of the column after (dir 1), or end of the one before (dir -1), the one holding the cursor; null if none */
export function columnTarget(state: EditorState, dir: 1 | -1): number | null {
  const $head = state.selection.$head
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name !== 'column') continue
    const columns = $head.node(d - 1)
    const index = $head.index(d - 1) + dir
    if (index < 0 || index >= columns.childCount) return null
    let pos = $head.before(d - 1) + 1
    for (let i = 0; i < index; i++) pos += columns.child(i).nodeSize
    return dir === 1 ? pos + 1 : pos + columns.child(index).nodeSize - 1 // inside that column
  }
  return null
}

export const HeadingBackspace = Extension.create({
  name: 'headingBackspace',
  priority: 1000, // before joining with the line above
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        const { $from } = selection
        if (!selection.empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'heading') return false
        return editor.commands.setParagraph()
      }
    }
  }
})

/**
 * Backspace at the start of a line right below a toggle or columns: ProseMirror selected the whole block, so the next
 * key deleted it. Instead the line joins the end of the block's last line (an open toggle's body, a closed toggle's
 * title, the last column), the way it would join an ordinary line. Returns null when that doesn't apply.
 */
export function backspaceIntoBlock(state: EditorState): Transaction | null {
  const { selection } = state
  const { $from } = selection
  if (!selection.empty || $from.parentOffset !== 0 || !$from.parent.isTextblock || $from.depth < 1) return null
  const index = $from.index($from.depth - 1)
  if (index === 0) return null
  const container = $from.node($from.depth - 1)
  const prev = container.child(index - 1)
  if (prev.type.name !== 'details' && prev.type.name !== 'columns') return null
  const prevPos = $from.before() - prev.nodeSize
  // The last line inside it that's visible: a closed toggle only shows its title
  let target = -1
  const look = prev.type.name === 'details' && !prev.attrs.open ? prev.child(0) : prev
  const lookPos = look === prev ? prevPos : prevPos + 1
  look.descendants((node, pos) => {
    if (node.isTextblock) target = lookPos + 1 + pos + node.nodeSize - 1 // end of that line's content
    return !node.isTextblock
  })
  if (look.isTextblock) target = lookPos + look.nodeSize - 1
  if (target < 0) return null
  const line = $from.parent
  const targetNode = state.doc.resolve(target).parent
  // The line's text joins that line (a title only takes plain text: @-links and the like keep the old behaviour)
  if (line.content.size && !targetNode.type.validContent(targetNode.content.append(line.content))) return null
  const tr = state.tr.delete($from.before(), $from.after())
  if (line.content.size) tr.insert(target, line.content)
  tr.setSelection(TextSelection.create(tr.doc, target))
  return tr.scrollIntoView()
}

export const BlockBackspace = Extension.create({
  name: 'blockBackspace',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const tr = backspaceIntoBlock(editor.state)
        if (!tr) return false
        editor.view.dispatch(tr)
        return true
      }
    }
  }
})

export const CodeFence = Extension.create({
  name: 'codeFence',
  priority: 1000,
  addInputRules() {
    const type = this.editor.schema.nodes.codeBlock
    return type ? [textblockTypeInputRule({ find: /^```$/, type })] : []
  }
})

export const TabKeeper = Extension.create({
  name: 'tabKeeper',
  priority: 1, // after lists, tables and code blocks have had their turn
  addKeyboardShortcuts() {
    const move = (dir: 1 | -1) => (): boolean => {
      const { state, view } = this.editor
      const target = columnTarget(state, dir)
      if (target !== null) view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(target), dir)).scrollIntoView())
      return true
    }
    return { Tab: move(1), 'Shift-Tab': move(-1) }
  }
})
