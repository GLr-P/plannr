import { describe, expect, it } from 'vitest'
import { getSchema, Node as TNode } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { Node } from '@tiptap/pm/model'
import { backspaceIntoBlock, columnTarget } from '../../src/renderer/src/editor/keys'

// Same shape as editor/Blocks.tsx (a .tsx file the unit tests can't load)
const Columns = TNode.create({ name: 'columns', group: 'block', content: 'column{2,4}', isolating: true })
const Column = TNode.create({ name: 'column', content: 'block+', isolating: true })
const schema = getSchema([StarterKit, Details.configure({ persist: true }), DetailsSummary, DetailsContent, Columns, Column])
const P = (text?: string) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const toggle = (open: boolean) => ({
  type: 'details',
  attrs: { open },
  content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'Parts' }] }, { type: 'detailsContent', content: [P('Battery')] }]
})
const columns = { type: 'columns', content: [{ type: 'column', content: [P('Left')] }, { type: 'column', content: [P('Right')] }] }

/** A state with the cursor at the start of the block after `first` */
function below(first: unknown, line?: string): EditorState {
  const doc = Node.fromJSON(schema, { type: 'doc', content: [first, P(line)] })
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.setSelection(TextSelection.create(doc, doc.child(0).nodeSize + 1)))
}

describe('Backspace below a toggle or columns', () => {
  it('joins the open toggle body, cursor at the join', () => {
    const s = below(toggle(true), 'more').apply(backspaceIntoBlock(below(toggle(true), 'more'))!)
    expect(s.doc.childCount).toBe(1)
    expect(s.doc.child(0).child(1).textContent).toBe('Batterymore')
    expect(s.selection.$head.parent.textContent).toBe('Batterymore')
    expect(s.selection.$head.parentOffset).toBe('Battery'.length)
  })
  it('joins a closed toggle title', () => {
    const st = below(toggle(false), 'more')
    const s = st.apply(backspaceIntoBlock(st)!)
    expect(s.doc.child(0).child(0).textContent).toBe('Partsmore')
    expect(s.selection.$head.parent.type.name).toBe('detailsSummary')
  })
  it('an empty line just goes away', () => {
    const st = below(toggle(true))
    const s = st.apply(backspaceIntoBlock(st)!)
    expect(s.doc.childCount).toBe(1)
    expect(s.selection.$head.parent.textContent).toBe('Battery')
  })
  it('joins the last column', () => {
    const st = below(columns, 'x')
    const s = st.apply(backspaceIntoBlock(st)!)
    expect(s.doc.child(0).child(1).textContent).toBe('Rightx')
  })
  it('leaves other cases to the normal Backspace', () => {
    expect(backspaceIntoBlock(below(P('above'), 'x'))).toBeNull()
  })
})

describe('Tab between columns', () => {
  it('finds the next and previous column', () => {
    const doc = Node.fromJSON(schema, { type: 'doc', content: [columns] })
    const st = EditorState.create({ doc, schema })
    const inLeft = st.apply(st.tr.setSelection(TextSelection.create(doc, 3)))
    const next = columnTarget(inLeft, 1)!
    expect(doc.resolve(next).parent.type.name).toBe('column')
    expect(TextSelection.near(doc.resolve(next)).$head.parent.textContent).toBe('Right')
    expect(columnTarget(inLeft, -1)).toBeNull()
  })
})
