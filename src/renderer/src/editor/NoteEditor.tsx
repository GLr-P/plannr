import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, Underline, Palette, ALargeSmall, AlignLeft, AlignCenter, AlignRight, AlignJustify, RemoveFormatting } from 'lucide-react'
import type { DocJSON, EntityType } from '../../../shared/api'
import { openEntity } from '../actions'
import { buildExtensions, type EditorOptions } from './extensions'
import { imageFiles, insertFiles, insertImages, otherFiles } from './upload'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { openMenu } from '../components/ContextMenu'
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, Rows3, Table2, Trash2 } from 'lucide-react'

interface Props {
  /** Id of the note/ticket/template being edited (excluded from its own @-mentions) */
  docId: string
  content: DocJSON | null
  editable: boolean
  onChange: (doc: DocJSON) => void
  onReady?: (editor: Editor) => void
  /** Image storage and @-links, see EditorOptions */
  options?: EditorOptions
}

export function NoteEditor({ docId, content, editable, onChange, onReady, options }: Props) {
  // Latest callbacks without re-creating the editor.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editorRef = useRef<Editor | null>(null)

  const editor = useEditor({
    extensions: buildExtensions(docId, options),
    content: content ?? '',
    editable,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      // Pictures go in as images; other files as file blocks (not in the vault, which keeps its own encrypted files).
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files)
        const others = options?.upload ? [] : otherFiles(event.clipboardData?.files)
        if (!files.length && !others.length) return false
        void insertImages(view, files, undefined, options?.upload).then(() => insertFiles(view, others))
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFiles(event.dataTransfer?.files)
        const others = options?.upload ? [] : otherFiles(event.dataTransfer?.files)
        if (!files.length && !others.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImages(view, files, pos, options?.upload).then(() => insertFiles(view, others, files.length ? undefined : pos))
        return true
      },
      handleDOMEvents: {
        // Right-click inside a table: add/remove rows and columns.
        contextmenu: (view, event) => {
          const editor = editorRef.current
          if (!editor || !editor.isEditable) return false
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!at) return false
          if (!(event.target as HTMLElement).closest('td, th')) return false
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))))
          const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => void fn(editor.chain().focus()).run()
          openMenu(event, [
            { label: 'Add row above', icon: <ArrowUpToLine />, onSelect: run((c) => c.addRowBefore()) },
            { label: 'Add row below', icon: <ArrowDownToLine />, onSelect: run((c) => c.addRowAfter()) },
            { label: 'Add column left', icon: <ArrowLeftToLine />, onSelect: run((c) => c.addColumnBefore()) },
            { label: 'Add column right', icon: <ArrowRightToLine />, onSelect: run((c) => c.addColumnAfter()) },
            'separator',
            { label: 'Header row on/off', icon: <Table2 />, onSelect: run((c) => c.toggleHeaderRow()) },
            { label: 'Delete row', icon: <Rows3 />, onSelect: run((c) => c.deleteRow()) },
            { label: 'Delete column', icon: <Columns3 />, onSelect: run((c) => c.deleteColumn()) },
            { label: 'Delete table', icon: <Trash2 />, danger: true, onSelect: run((c) => c.deleteTable()) }
          ])
          return true
        }
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement
        const mention = target.closest<HTMLElement>('[data-type="mention"]')
        if (mention?.dataset.id) {
          openEntity((mention.dataset.kind ?? 'note') as EntityType, mention.dataset.id)
          return true
        }
        const link = target.closest<HTMLAnchorElement>('a[href]')
        if (link && (event.ctrlKey || event.metaKey)) {
          window.open(link.href, '_blank')
          return true
        }
        return false
      }
    },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.docChanged) onChangeRef.current(editor.getJSON() as DocJSON)
    }
  })

  useEffect(() => {
    // emitUpdate=false: toggling editability must not look like an edit (it would re-save the note).
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false)
  }, [editor, editable])

  useEffect(() => {
    editorRef.current = editor
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  if (!editor) return null
  return (
    <>
      {editable && <SelectionToolbar editor={editor} />}
      <EditorContent editor={editor} className="editor" />
    </>
  )
}

function SelectionToolbar({ editor }: { editor: Editor }) {
  const [linkMode, setLinkMode] = useState(false)
  const [panel, setPanel] = useState<'' | 'color' | 'size'>('')
  const [href, setHref] = useState('')
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? '',
      size: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
      align: ((e.getAttributes('paragraph').textAlign ?? e.getAttributes('heading').textAlign) as string | undefined) ?? 'left',
      linkHref: (e.getAttributes('link').href as string | undefined) ?? ''
    })
  })

  const applyLink = (): void => {
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href.trim()) chain.setLink({ href: href.trim() }).run()
    else chain.unsetLink().run()
    setLinkMode(false)
  }

  const btn = (label: string, isActive: boolean, icon: React.ReactNode, run: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={isActive ? 'active' : ''}
      onMouseDown={(e) => {
        e.preventDefault()
        run()
      }}
    >
      {icon}
    </button>
  )

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8, onHide: () => setLinkMode(false) }}
      shouldShow={({ editor: e, state }) =>
        // Only for selected text: not for a selected fill-in field, file or picture (nothing to format there)
        !state.selection.empty && !(state.selection instanceof NodeSelection) && e.isEditable && !e.isActive('image') && !e.isActive('codeBlock')
      }
    >
      <div className="bubble">
        {linkMode ? (
          <input
            autoFocus
            className="bubble-input"
            placeholder="Paste a link, Enter to save"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') {
                setLinkMode(false)
                editor.commands.focus()
              }
            }}
          />
        ) : (
          <>
            {btn('Bold (Ctrl+B)', active.bold, <Bold />, () => editor.chain().focus().toggleBold().run())}
            {btn('Italic (Ctrl+I)', active.italic, <Italic />, () => editor.chain().focus().toggleItalic().run())}
            {btn('Underline (Ctrl+U)', active.underline, <Underline />, () => editor.chain().focus().toggleUnderline().run())}
            {btn('Strikethrough', active.strike, <Strikethrough />, () => editor.chain().focus().toggleStrike().run())}
            {btn('Highlight', active.highlight, <Highlighter />, () => editor.chain().focus().toggleHighlight().run())}
            {btn('Inline code', active.code, <Code />, () => editor.chain().focus().toggleCode().run())}
            {btn('Link', active.link, <Link2 />, () => {
              setHref(active.linkHref)
              setLinkMode(true)
            })}
            <span className="bubble-sep" />
            {btn('Text colour and highlight', panel === 'color' || Boolean(active.color), <Palette style={active.color ? { color: active.color } : undefined} />, () => setPanel(panel === 'color' ? '' : 'color'))}
            {btn('Text size', panel === 'size' || Boolean(active.size), <ALargeSmall />, () => setPanel(panel === 'size' ? '' : 'size'))}
            {btn('Align left', active.align === 'left', <AlignLeft />, () => align(editor, null))}
            {btn('Centre', active.align === 'center', <AlignCenter />, () => align(editor, 'center'))}
            {btn('Align right', active.align === 'right', <AlignRight />, () => align(editor, 'right'))}
            {btn('Justify', active.align === 'justify', <AlignJustify />, () => align(editor, 'justify'))}
            {btn('Clear formatting', false, <RemoveFormatting />, () => editor.chain().focus().unsetAllMarks().run())}
            {panel === 'color' && (
              <div className="bubble-panel" onMouseDown={(e) => e.preventDefault()}>
                <span className="small muted">Text</span>
                {TEXT_COLORS.map((c) => (
                  <button key={c || 'default'} type="button" className={`bubble-swatch ${active.color === c ? 'on' : ''}`} style={{ background: c || 'var(--text)' }} title={c ? c : 'Default'} aria-label={`Text colour ${c || 'default'}`} onClick={() => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run())} />
                ))}
                <span className="small muted">Highlight</span>
                {HIGHLIGHTS.map((c) => (
                  <button key={c || 'none'} type="button" className="bubble-swatch hl" style={{ background: c || 'transparent' }} title={c ? c : 'No highlight'} aria-label={`Highlight ${c || 'none'}`} onClick={() => (c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run())} />
                ))}
              </div>
            )}
            {panel === 'size' && (
              <div className="bubble-panel" onMouseDown={(e) => e.preventDefault()}>
                {SIZES.map((s) => (
                  <button key={s.label} type="button" className={`bubble-size ${active.size === s.value ? 'on' : ''}`} onClick={() => (s.value ? editor.chain().focus().setFontSize(s.value).run() : editor.chain().focus().unsetFontSize().run())}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}

const TEXT_COLORS = ['', '#d23f3f', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2f6ae0', '#7c3aed', '#db2777', '#6b7280']
const HIGHLIGHTS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '']
const SIZES = [
  { label: 'Small', value: '13px' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '19px' },
  { label: 'Huge', value: '26px' }
]
/** Alignment for the paragraphs and headings in the selection */
function align(editor: Editor, value: string | null): void {
  editor.chain().focus().updateAttributes('paragraph', { textAlign: value }).updateAttributes('heading', { textAlign: value }).run()
}
