import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { Node, Slice } from '@tiptap/pm/model'
import { copySlice, pasteIntoBody, pasteIntoTitle, titleContent, toggleTitleAt } from '../../src/renderer/src/editor/toggle-clipboard'

// Pasting onto a toggle's title used to split the toggle apart (empty toggles, text outside it).
const schema = getSchema([StarterKit, Image, Details.configure({ persist: true }), DetailsSummary, DetailsContent])
const P = (text?: string) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const toggle = (title: string, body = [P('body')]) => ({
  type: 'details',
  attrs: { open: true },
  content: [{ type: 'detailsSummary', content: [{ type: 'text', text: title }] }, { type: 'detailsContent', content: body }]
})
const TITLE_START = 10 // "before" paragraph (0–8), details at 8, summary at 9, its text from 10

function stateAt(pos: number, body?: ReturnType<typeof P>[]): EditorState {
  const doc = Node.fromJSON(schema, { type: 'doc', content: [P('before'), toggle('Title', body)] })
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** Pastes like the editor does when the cursor is in a title */
function paste(state: EditorState, json: unknown): EditorState {
  const slice = Slice.fromJSON(schema, json as never)
  const detailsPos = toggleTitleAt(state)!
  const text = titleContent(slice, state.doc.nodeAt(detailsPos)!.child(0))
  return state.apply(text ? pasteIntoTitle(state, text) : pasteIntoBody(state, detailsPos, slice))
}

const outline = (doc: Node): unknown =>
  doc.toJSON().content.map(function s(n: { type: string; text?: string; content?: unknown[] }): unknown {
    return n.text ?? (n.content ? { [n.type]: n.content.map(s as never) } : n.type)
  })

describe('pasting onto a toggle title', () => {
  it('knows when the cursor is in a title', () => {
    expect(toggleTitleAt(stateAt(TITLE_START + 2))).toBe(8)
    expect(toggleTitleAt(stateAt(3))).toBeNull()
  })

  it('one line of text goes into the title, keeping bold', () => {
    const s = paste(stateAt(TITLE_START + 5), {
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ' fixed', marks: [{ type: 'bold' }] }] }],
      openStart: 1,
      openEnd: 1
    })
    expect(outline(s.doc)).toEqual([{ paragraph: ['before'] }, { details: [{ detailsSummary: ['Title', ' fixed'] }, { detailsContent: [{ paragraph: ['body'] }] }] }])
    expect(s.doc.nodeAt(8)!.child(0).child(1).marks.map((m) => m.type.name)).toEqual(['bold'])
    expect(s.selection.$head.parent.type.name).toBe('detailsSummary')
  })

  it('text copied from another title, a heading or a list item goes into the title', () => {
    const fromTitle = { content: [{ type: 'details', attrs: { open: true }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'abc' }] }] }], openStart: 2, openEnd: 2 }
    const heading = { content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'abc' }] }], openStart: 1, openEnd: 1 }
    const listItem = { content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [P('abc')] }] }], openStart: 3, openEnd: 3 }
    for (const json of [fromTitle, heading, listItem]) {
      const s = paste(stateAt(TITLE_START), json)
      expect(s.doc.childCount).toBe(2)
      expect(s.doc.child(1).child(0).textContent).toBe('abcTitle')
      expect(s.doc.child(1).child(1).textContent).toBe('body')
    }
  })

  it('several lines go at the top of the body, leaving the toggle whole', () => {
    const s = paste(stateAt(TITLE_START + 5), { content: [P('aa'), P('bb')], openStart: 1, openEnd: 1 })
    expect(outline(s.doc)).toEqual([{ paragraph: ['before'] }, { details: [{ detailsSummary: ['Title'] }, { detailsContent: [{ paragraph: ['aa'] }, { paragraph: ['bb'] }, { paragraph: ['body'] }] }] }])
    expect(s.selection.$head.parent.textContent).toBe('bb')
  })

  it('a whole copied toggle goes inside the body (nested), replacing an empty first line', () => {
    const s = paste(stateAt(TITLE_START + 5, [P()]), { content: [toggle('Copied', [P('inside')])], openStart: 0, openEnd: 0 })
    expect(s.doc.childCount).toBe(2)
    const body = s.doc.child(1).child(1)
    expect(s.doc.child(1).child(0).textContent).toBe('Title')
    expect(body.child(0).type.name).toBe('details')
    expect(body.child(0).textContent).toBe('Copiedinside')
  })

  it('pictures go in the body', () => {
    const s = paste(stateAt(TITLE_START), { content: [{ type: 'image', attrs: { src: 'x.png' } }], openStart: 0, openEnd: 0 })
    expect(s.doc.child(1).child(0).textContent).toBe('Title')
    expect(s.doc.child(1).child(1).child(0).type.name).toBe('image')
  })
})

// Copying from a toggle used to carry the toggle along: pasting the title's text made a new toggle, and pasting
// a title + body onto a line pulled that line into the new toggle.
describe('copying from a toggle', () => {
  // Intro (0–7), toggle at 7: title "Parts" 9–14, body line "Screen" 17–23; Outro after it
  const doc = Node.fromJSON(schema, { type: 'doc', content: [P('Intro'), toggle('Parts', [P('Screen')]), P('Outro')] })
  const copyOf = (from: number, to: number): Slice => {
    const s = EditorState.create({ doc, schema })
    return copySlice(s.apply(s.tr.setSelection(TextSelection.create(doc, from, to))))
  }
  const pasteAt = (slice: Slice, pos: number): unknown => {
    const s = EditorState.create({ doc, schema })
    return outline(s.tr.setSelection(TextSelection.create(doc, pos)).replaceSelection(slice).doc)
  }
  const INTRO_START = 1

  it('the title text (selected, or triple-clicked into the next line) pastes as plain text', () => {
    for (const [from, to] of [[9, 14], [9, 17], [11, 14]]) {
      const slice = copyOf(from, to)
      expect(slice.content.childCount).toBe(1)
      expect(slice.content.firstChild!.type.name).toBe('paragraph')
      expect(pasteAt(slice, INTRO_START)).toEqual([
        { paragraph: [doc.textBetween(from, Math.min(to, 14)) + 'Intro'] },
        { details: [{ detailsSummary: ['Parts'] }, { detailsContent: [{ paragraph: ['Screen'] }] }] },
        { paragraph: ['Outro'] }
      ])
    }
  })

  it('title + body copies a whole toggle that does not swallow the line it is pasted on', () => {
    const slice = copyOf(9, 23)
    expect([slice.openStart, slice.openEnd]).toEqual([0, 0])
    expect(pasteAt(slice, INTRO_START)).toEqual([
      { details: [{ detailsSummary: ['Parts'] }, { detailsContent: [{ paragraph: ['Screen'] }] }] },
      { paragraph: ['Intro'] },
      { details: [{ detailsSummary: ['Parts'] }, { detailsContent: [{ paragraph: ['Screen'] }] }] },
      { paragraph: ['Outro'] }
    ])
  })

  it('from the body out past the toggle copies just the lines', () => {
    const slice = copyOf(17, 32)
    expect(slice.content.firstChild!.type.name).toBe('paragraph')
    expect(slice.content.textBetween(0, slice.content.size, '|')).toBe('Screen|Outro')
  })

  it('from a line above into the title keeps the toggle whole', () => {
    const slice = copyOf(3, 12)
    expect(slice.content.lastChild!.type.name).toBe('details')
    expect(slice.openEnd).toBe(0)
    expect(slice.content.lastChild!.childCount).toBe(2) // title and (empty) body
  })
})
