import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { copiedSlice, copyHtml, copyText, type CopiedSlice } from '../../../shared/rich-copy'
import { api } from '../api'

/**
 * Copy and cut give other programs formatting they understand and tidy plain text (shared/rich-copy.ts); pasting a
 * copy back into Plannr restores the exact piece. Pictures saved in Plannr are swapped for the picture itself
 * (app.copyRich) so they show up in Word or an email too.
 */
function copy(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const { state } = view
  const data = event.clipboardData
  if (state.selection.empty || !data) return false
  const slice = state.selection.content().toJSON() as CopiedSlice | null
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

function paste(view: EditorView, event: ClipboardEvent): boolean {
  const html = event.clipboardData?.getData('text/html')
  const copied = html ? copiedSlice(html) : null
  if (!copied || view.state.selection.$from.parent.type.spec.code) return false
  let slice: Slice
  try {
    slice = Slice.fromJSON(view.state.schema, copied)
  } catch {
    return false // something this editor can't hold (e.g. an @-link in the vault): paste the formatted HTML instead
  }
  view.someProp('transformPasted', (f) => {
    slice = f(slice, view, false)
  })
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
          handlePaste: (view, event) => paste(view, event)
        }
      })
    ]
  }
})
