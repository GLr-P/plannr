import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, Underline } from 'lucide-react'
import type { DocJSON } from '../../../shared/api'
import { buildExtensions } from './extensions'
import { imageFiles, insertImages } from './upload'

interface Props {
  noteId: string
  content: DocJSON | null
  editable: boolean
  onChange: (doc: DocJSON) => void
  onOpenMention: (kind: string, id: string) => void
  onReady?: (editor: Editor) => void
}

export function NoteEditor({ noteId, content, editable, onChange, onOpenMention, onReady }: Props) {
  // Latest callbacks without re-creating the editor.
  const onChangeRef = useRef(onChange)
  const onOpenRef = useRef(onOpenMention)
  onChangeRef.current = onChange
  onOpenRef.current = onOpenMention

  const editor = useEditor({
    extensions: buildExtensions(noteId),
    content: content ?? '',
    editable,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files)
        if (!files.length) return false
        void insertImages(view, files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFiles(event.dataTransfer?.files)
        if (!files.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImages(view, files, pos)
        return true
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement
        const mention = target.closest<HTMLElement>('[data-type="mention"]')
        if (mention?.dataset.id) {
          onOpenRef.current(mention.dataset.kind ?? 'note', mention.dataset.id)
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
        !state.selection.empty && e.isEditable && !e.isActive('image') && !e.isActive('codeBlock')
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
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
