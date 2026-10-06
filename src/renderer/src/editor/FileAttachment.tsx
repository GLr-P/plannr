import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon, ExternalLink } from 'lucide-react'
import { api } from '../api'

/** Sizes like "2.4 MB" */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['bytes', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`
}

function iconFor(mime: string, name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (mime.startsWith('image/')) return FileImage
  if (mime.startsWith('video/')) return FileVideo
  if (mime.startsWith('audio/')) return FileAudio
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet
  if (['zip', 'rar', '7z', 'gz'].includes(ext)) return FileArchive
  if (mime === 'application/pdf' || ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return FileText
  return FileIcon
}

const idOf = (src: string): string | null => /^plannr:\/\/file\/([0-9a-f-]{36})$/.exec(src)?.[1] ?? null

/** Any file (PDF, document, spreadsheet…) kept in Plannr's own storage; click to open it in its usual app. */
export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      name: { default: 'file' },
      size: { default: 0 },
      mime: { default: '' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-file]',
        getAttrs: (el) => ({
          src: el.getAttribute('data-src') ?? '',
          name: el.getAttribute('data-name') ?? 'file',
          size: Number(el.getAttribute('data-size')) || 0,
          mime: el.getAttribute('data-mime') ?? ''
        })
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-file': '', 'data-src': node.attrs.src, 'data-name': node.attrs.name, 'data-size': node.attrs.size, 'data-mime': node.attrs.mime }),
      node.attrs.name
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileView)
  }
})

function FileView({ node, selected }: NodeViewProps) {
  const { src, name, size, mime } = node.attrs as { src: string; name: string; size: number; mime: string }
  const Icon = iconFor(mime, name)
  const id = idOf(src)
  const open = (): void => {
    if (id) void api.files.open(id)
  }
  return (
    <NodeViewWrapper className={`file-block ${selected ? 'selected' : ''}`} data-drag-handle>
      <div className="file-chip" contentEditable={false} onDoubleClick={open} title={`${name} · double-click to open`}>
        <Icon className="file-chip-icon" />
        <span className="file-chip-name">{name}</span>
        {size > 0 && <span className="file-chip-size">{formatSize(size)}</span>}
        <button type="button" className="icon-btn sm" title="Open in its app" aria-label={`Open ${name}`} disabled={!id} onClick={open}>
          <ExternalLink />
        </button>
      </div>
    </NodeViewWrapper>
  )
}
