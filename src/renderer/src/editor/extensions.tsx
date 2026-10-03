import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
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
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
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
import { popupRenderer, type MenuItem } from './SuggestionPopup'
import { insertImages, pickImages } from './upload'

interface SlashCommand {
  label: string
  hint: string
  icon: ReactNode
  keywords: string
  run: (editor: Editor, range: Range) => void
}

const SLASH_COMMANDS: SlashCommand[] = [
  { label: 'Text', hint: 'Plain paragraph', icon: <Type />, keywords: 'paragraph p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { label: 'Heading 1', hint: 'Large section title', icon: <Heading1 />, keywords: 'h1 title', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: 'Heading 2', hint: 'Medium section title', icon: <Heading2 />, keywords: 'h2 subtitle', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: 'Heading 3', hint: 'Small section title', icon: <Heading3 />, keywords: 'h3', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: 'Bulleted list', hint: 'Simple list', icon: <List />, keywords: 'ul unordered bullet', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: 'Numbered list', hint: 'List with numbers', icon: <ListOrdered />, keywords: 'ol ordered number', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: 'To-do list', hint: 'Checkboxes', icon: <ListChecks />, keywords: 'todo task check checkbox', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: 'Toggle section', hint: 'Collapsible dropdown', icon: <ChevronRight />, keywords: 'toggle dropdown collapse details fold', run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  { label: 'Image', hint: 'Upload photos', icon: <ImageIcon />, keywords: 'photo picture img upload', run: (e, r) => {
      e.chain().focus().deleteRange(r).run()
      void pickImages().then((files) => {
        if (files.length) return insertImages(e.view, files)
      })
    } },
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
  kind: 'note'
}

function noteMention(currentNoteId: string) {
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
        const found = query.trim()
          ? (await api.search.query(query, { types: ['note'], limit: 8 })).map((r) => ({ id: r.id, title: r.title }))
          : useData.getState().notes.slice(0, 8)
        return found
          .filter((n) => n.id !== currentNoteId)
          .map((n) => ({
            key: n.id,
            label: noteTitle(n.title),
            hint: 'Note',
            icon: <FileText />,
            value: { id: n.id, label: noteTitle(n.title), kind: 'note' as const }
          }))
      },
      render: popupRenderer<MentionValue>('No matching notes')
    }
  })
}

export function buildExtensions(noteId: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading'
        if (node.type.name === 'detailsSummary') return 'Toggle title'
        return "Type '/' for blocks, '@' to link a note"
      }
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 80 } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }),
    DetailsSummary,
    DetailsContent,
    Highlight,
    SlashCommands,
    noteMention(noteId)
  ]
}
