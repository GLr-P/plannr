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

/** Saves images into Plannr and inserts them at `pos` (or the current selection). */
export async function insertImages(view: EditorView, files: File[], pos?: number): Promise<void> {
  let at = pos
  for (const file of files) {
    const stored = await storeFile(file)
    if (view.isDestroyed) return
    const node = view.state.schema.nodes.image.create({ src: stored.url, alt: stored.name })
    const tr = at != null ? view.state.tr.insert(Math.min(at, view.state.doc.content.size), node) : view.state.tr.replaceSelectionWith(node)
    view.dispatch(tr)
    if (at != null) at += node.nodeSize
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
