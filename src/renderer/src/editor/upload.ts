import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { StoredFile } from '../../../shared/api'
import { api } from '../api'

export async function storeFile(file: File): Promise<StoredFile> {
  const data = new Uint8Array(await file.arrayBuffer())
  return api.files.save({ name: file.name || 'image.png', mime: file.type, data })
}

export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

/**
 * Inserts an image at [from, to] and leaves the cursor on an empty line right after it
 * (in the same container, e.g. inside a toggle). Leaving the image selected would make
 * the next paste replace it.
 */
function insertImage(view: EditorView, src: string, alt: string, from: number, to: number): void {
  const { schema } = view.state
  const node = schema.nodes.image.create({ src, alt })
  const tr = view.state.tr.replaceRangeWith(from, to, node)
  let imagePos = -1
  tr.doc.descendants((n, pos) => {
    if (imagePos < 0 && n.type === node.type && n.attrs.src === src) imagePos = pos
    return imagePos < 0
  })
  if (imagePos >= 0) {
    const after = imagePos + node.nodeSize
    const next = tr.doc.resolve(after).nodeAfter
    if (!next || !next.isTextblock || next.content.size > 0) tr.insert(after, schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
  }
  view.dispatch(tr.scrollIntoView())
}

/** Saves images into Plannr and inserts them at `pos` (or the cursor), one after another. */
export async function insertImages(view: EditorView, files: File[], pos?: number): Promise<void> {
  let at = pos
  for (const file of files) {
    const stored = await storeFile(file)
    if (view.isDestroyed) return
    const size = view.state.doc.content.size
    const [from, to] = at != null ? [Math.min(at, size), Math.min(at, size)] : [view.state.selection.from, view.state.selection.to]
    insertImage(view, stored.url, stored.name, from, to)
    at = undefined // following images go after the previous one (where the cursor now is)
  }
}

export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => resolve(imageFiles(input.files))
    input.click()
  })
}
