import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment, Slice, type Schema } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { copiedSlice, copyHtml, copyText, type CopiedSlice } from '../../../shared/rich-copy'
import { api } from '../api'
import { copySlice, pasteIntoToggle, toggleTitleAt } from './toggle-clipboard'
import { imageFiles, otherFiles } from './upload'

/**
 * Copy and cut give other programs formatting they understand and tidy plain text (shared/rich-copy.ts); pasting a
 * copy back into Plannr restores the exact piece. Pictures saved in Plannr are swapped for the picture itself
 * (app.copyRich) so they show up in Word or an email too.
 */
function copy(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const { state } = view
  const data = event.clipboardData
  if (state.selection.empty || !data) return false
  const slice = copySlice(state).toJSON() as CopiedSlice | null
  if (!slice) return false
  const html = copyHtml(slice)
  const text = copyText(slice)
  event.preventDefault()
  data.clearData()
  data.setData('text/html', html)
  data.setData('text/plain', text)
  // After the copy itself has landed (otherwise it can overwrite the version with pictures)
  if (html.includes('plannr://file/')) setTimeout(() => void api.app.copyRich(html, text).catch(() => undefined), 150)
  if (cut && view.editable) view.dispatch(state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
  return true
}

/**
 * Plain text (Notepad, a text message, a web form) as lines. ProseMirror's own reading drops blank lines, which
 * squashed spaced-out notes together. One trailing line break (copying a whole line) doesn't add an empty line.
 */
export function textSlice(text: string, schema: Schema): Slice {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  return new Slice(Fragment.fromArray(lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : null))), 1, 1)
}

/** A Plannr copy on the clipboard, rebuilt exactly (null if there's none or this editor can't hold it) */
function plannrSlice(view: EditorView, event: ClipboardEvent): Slice | null {
  const html = event.clipboardData?.getData('text/html')
  const copied = html ? copiedSlice(html) : null
  if (!copied) return null
  let slice: Slice
  try {
    slice = Slice.fromJSON(view.state.schema, copied)
  } catch {
    return null // something this editor can't hold (e.g. an @-link in the vault): paste the formatted HTML instead
  }
  view.someProp('transformPasted', (f) => {
    slice = f(slice, view, false)
  })
  return slice
}

/** `parsed` is ProseMirror's own reading of the clipboard (formatted HTML or plain text) */
function paste(view: EditorView, event: ClipboardEvent, parsed: Slice): boolean {
  if (view.state.selection.$from.parent.type.spec.code) return false
  const slice = plannrSlice(view, event)
  if (toggleTitleAt(view.state) !== null) {
    if (imageFiles(event.clipboardData?.files).length || otherFiles(event.clipboardData?.files).length) return false // upload.ts puts them in the body
    return pasteIntoToggle(view, slice ?? parsed)
  }
  if (!slice) return false
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
  return true
}

export const RichClipboard = Extension.create({
  name: 'richClipboard',
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('richClipboard'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => copy(view, event, false),
            cut: (view, event) => copy(view, event, true)
          },
          handlePaste: (view, event, slice) => paste(view, event, slice),
          clipboardTextParser: (text, $context) => textSlice(text, $context.doc.type.schema)
        }
      })
    ]
  }
})
