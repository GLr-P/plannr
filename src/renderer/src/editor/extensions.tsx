import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey, Selection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import Highlight from '@tiptap/extension-highlight'
import Mention from '@tiptap/extension-mention'
import Suggestion from '@tiptap/suggestion'
import {
  ChevronRight,
  Code,
  FormInput,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Images,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Type
} from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { useData } from '../store/data'
import { noteTitle } from '../lib/format'
import type { EntityType } from '../../../shared/api'
import { EntityIcon, ENTITY_LABEL } from '../components/EntityIcon'
import { FormField } from './FormField'
import { popupRenderer, type MenuItem } from './SuggestionPopup'
import { defaultUploader, insertImages, pickImages, type ImageUploader } from './upload'

interface SlashCommand {
  label: string
  hint: string
  icon: ReactNode
  keywords: string
  run: (editor: Editor, range: Range) => void
}

/**
 * With the cursor in a toggle's title: opens the toggle (if closed) and moves the cursor into its body.
 * Without this, Enter on a closed toggle jumps *out* of it, so photos/text land below instead of inside.
 */
function enterToggleBody(editor: Editor): boolean {
  const { state } = editor
  const { $head } = state.selection
  if ($head.parent.type.name !== 'detailsSummary') return false
  const details = $head.node(-1)
  const detailsPos = $head.before(-1)
  // Open first, in its own step: the browser can't put the cursor inside content that is still hidden.
  if (!details.attrs.open) editor.view.dispatch(state.tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true }))
  const { tr, schema } = editor.state
  const bodyStart = detailsPos + 1 + details.child(0).nodeSize + 1 // inside detailsContent, before its first block
  const first = tr.doc.resolve(bodyStart).nodeAfter
  // Like a normal Enter: start on an empty line at the top instead of joining existing text.
  if (!first || !first.isTextblock || first.content.size > 0) tr.insert(bodyStart, schema.nodes.paragraph.create())
  editor.view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(bodyStart + 1), 1)).scrollIntoView())
  return true
}

/** Inserts an open toggle; the cursor ends in its title. */
function insertToggle(editor: Editor, range: Range, title = ''): void {
  editor.chain().focus().deleteRange(range).setDetails().insertContent(title).run()
  const { $head } = editor.state.selection
  if ($head.parent.type.name === 'detailsSummary') {
    const pos = $head.before(-1)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...$head.node(-1).attrs, open: true }))
  }
}

const ToggleKeys = Extension.create({
  name: 'toggleKeys',
  priority: 1000, // before the Details extension's own Enter handling
  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => enterToggleBody(editor) }
  }
})

/** Keeps each editor's image uploader on the editor, so slash commands store images in the right place. */
const Uploader = Extension.create<{ upload: ImageUploader }, { upload: ImageUploader }>({
  name: 'uploader',
  addOptions: () => ({ upload: defaultUploader }),
  addStorage() {
    return { upload: this.options.upload }
  }
})
const uploaderOf = (editor: Editor): ImageUploader =>
  (editor.storage as unknown as Record<string, { upload?: ImageUploader } | undefined>).uploader?.upload ?? defaultUploader

const SLASH_COMMANDS: SlashCommand[] = [
  { label: 'Text', hint: 'Plain paragraph', icon: <Type />, keywords: 'paragraph p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { label: 'Heading 1', hint: 'Large section title', icon: <Heading1 />, keywords: 'h1 title', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: 'Heading 2', hint: 'Medium section title', icon: <Heading2 />, keywords: 'h2 subtitle', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: 'Heading 3', hint: 'Small section title', icon: <Heading3 />, keywords: 'h3', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: 'Bulleted list', hint: 'Simple list', icon: <List />, keywords: 'ul unordered bullet', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: 'Numbered list', hint: 'List with numbers', icon: <ListOrdered />, keywords: 'ol ordered number', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: 'To-do list', hint: 'Checkboxes', icon: <ListChecks />, keywords: 'todo task check checkbox', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: 'Toggle section', hint: 'Collapsible dropdown', icon: <ChevronRight />, keywords: 'toggle dropdown collapse details fold', run: (e, r) => insertToggle(e, r) },
  { label: 'Photo dropdown', hint: 'Collapsible photos', icon: <Images />, keywords: 'photos pictures images gallery toggle dropdown before after', run: (e, r) => {
      insertToggle(e, r, 'Photos')
      enterToggleBody(e)
      void pickImages().then((files) => {
        if (files.length) return insertImages(e.view, files, undefined, uploaderOf(e))
      })
    } },
  { label: 'Image', hint: 'Upload photos', icon: <ImageIcon />, keywords: 'photo picture img upload', run: (e, r) => {
      e.chain().focus().deleteRange(r).run()
      void pickImages().then((files) => {
        if (files.length) return insertImages(e.view, files, undefined, uploaderOf(e))
      })
    } },
  { label: 'Form field', hint: 'Fill-in box (for templates)', icon: <FormInput />, keywords: 'field input form box template fill', run: (e, r) =>
      e.chain().focus().deleteRange(r).insertContent([{ type: 'formField', attrs: { label: '', kind: 'text' } }, { type: 'text', text: ' ' }]).run() },
  { label: 'Quote', hint: 'Quoted text', icon: <Quote />, keywords: 'blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: 'Code', hint: 'Code or command block', icon: <Code />, keywords: 'codeblock pre', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: 'Divider', hint: 'Horizontal line', icon: <Minus />, keywords: 'hr line separator rule', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() }
]

const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    return [
      Suggestion<MenuItem<SlashCommand>, SlashCommand>({
        pluginKey: new PluginKey('slashCommands'),
        editor: this.editor,
        char: '/',
        items: ({ query }) => {
          const q = query.toLowerCase()
          return SLASH_COMMANDS.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q)).map((c) => ({
            key: c.label,
            label: c.label,
            hint: c.hint,
            icon: c.icon,
            value: c
          }))
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: popupRenderer<SlashCommand>('No matching blocks')
      })
    ]
  }
})

interface MentionValue {
  id: string
  label: string
  kind: EntityType
}

function mention(currentDocId: string) {
  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        kind: {
          default: 'note',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') ?? 'note',
          renderHTML: (attrs: Record<string, unknown>) => ({ 'data-kind': attrs.kind })
        }
      }
    }
  }).configure({
    HTMLAttributes: { class: 'mention' },
    suggestion: {
      char: '@',
      items: async ({ query }): Promise<MenuItem<MentionValue>[]> => {
        const found: { id: string; title: string; type: EntityType }[] = query.trim()
          ? (await api.search.query(query, { limit: 10 })).map((r) => ({ id: r.id, title: r.title, type: r.type }))
          : useData.getState().notes.slice(0, 8).map((n) => ({ id: n.id, title: n.title, type: 'note' as const }))
        return found
          .filter((n) => n.id !== currentDocId)
          .map((n) => ({
            key: n.id,
            label: noteTitle(n.title),
            hint: ENTITY_LABEL[n.type],
            icon: <EntityIcon type={n.type} />,
            value: { id: n.id, label: noteTitle(n.title), kind: n.type }
          }))
      },
      render: popupRenderer<MentionValue>('No matches')
    }
  })
}

export interface EditorOptions {
  /** Where pasted/dropped images go (default: Plannr's normal file storage) */
  upload?: ImageUploader
  /** @-links to notes/tickets/customers (off in the vault so vault text never feeds the links index) */
  mentions?: boolean
}

export function buildExtensions(docId: string, options: EditorOptions = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading'
        if (node.type.name === 'detailsSummary') return 'Toggle title'
        return options.mentions === false ? "Type '/' for headings, checklists, toggles, images…" : "Type '/' for blocks, '@' to link a note, ticket or customer"
      }
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 80 } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }),
    DetailsSummary,
    DetailsContent,
    ToggleKeys,
    Highlight,
    FormField,
    SlashCommands,
    Uploader.configure({ upload: options.upload ?? defaultUploader }),
    ...(options.mentions === false ? [] : [mention(docId)])
  ]
}
