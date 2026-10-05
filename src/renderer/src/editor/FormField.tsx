import { useState } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Settings2 } from 'lucide-react'

export const FIELD_KINDS = [
  { id: 'text', label: 'Short text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'select', label: 'Dropdown' }
] as const
type FieldKind = (typeof FIELD_KINDS)[number]['id']

interface FieldAttrs {
  label: string
  kind: FieldKind
  options: string[]
  value: string
}

/**
 * A fill-in box inside a document (used by ticket templates): label + input.
 * The value lives in the node's attrs, so it's saved, copied with templates and searchable.
 */
export const FormField = Node.create({
  name: 'formField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label') ?? '', renderHTML: (a) => ({ 'data-label': a.label }) },
      kind: { default: 'text', parseHTML: (el) => el.getAttribute('data-kind') ?? 'text', renderHTML: (a) => ({ 'data-kind': a.kind }) },
      options: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-options') ?? '[]') as string[]
          } catch {
            return []
          }
        },
        renderHTML: (a) => ({ 'data-options': JSON.stringify(a.options ?? []) })
      },
      value: { default: '', parseHTML: (el) => el.getAttribute('data-value') ?? '', renderHTML: (a) => ({ 'data-value': a.value }) }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-form-field]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-form-field': '' })]
  },

  renderText({ node }) {
    return `${node.attrs.label}: ${node.attrs.value}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(FieldView)
  }
})

function FieldView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const attrs = node.attrs as FieldAttrs
  const editable = editor.isEditable
  const [configuring, setConfiguring] = useState(!attrs.label && editable)
  const setValue = (value: string): void => updateAttributes({ value })

  let control: React.ReactNode
  switch (attrs.kind) {
    case 'checkbox':
      control = <input type="checkbox" checked={attrs.value === 'true'} disabled={!editable} onChange={(e) => setValue(String(e.target.checked))} />
      break
    case 'select':
      control = (
        <select value={attrs.value} disabled={!editable} onChange={(e) => setValue(e.target.value)}>
          <option value="">—</option>
          {attrs.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
      break
    case 'date':
      control = <input type="date" value={attrs.value} readOnly={!editable} onChange={(e) => setValue(e.target.value)} />
      break
    case 'textarea':
      control = <textarea rows={2} value={attrs.value} readOnly={!editable} onChange={(e) => setValue(e.target.value)} />
      break
    default:
      control = (
        <input
          type="text"
          inputMode={attrs.kind === 'number' ? 'decimal' : undefined}
          value={attrs.value}
          readOnly={!editable}
          onChange={(e) => setValue(e.target.value)}
        />
      )
  }

  return (
    <NodeViewWrapper as="span" className={`ff ff-${attrs.kind}`} data-label={attrs.label}>
      <span className="ff-label">{attrs.label || 'New field'}</span>
      {control}
      {editable && (
        <button type="button" className="ff-gear" title="Edit field" aria-label={`Edit field ${attrs.label}`} onClick={() => setConfiguring(true)}>
          <Settings2 />
        </button>
      )}
      {configuring && (
        <FieldConfig
          attrs={attrs}
          onSave={(next) => {
            updateAttributes(next)
            setConfiguring(false)
          }}
          onDelete={deleteNode}
          onCancel={() => (attrs.label ? setConfiguring(false) : deleteNode())}
        />
      )}
    </NodeViewWrapper>
  )
}

function FieldConfig({
  attrs,
  onSave,
  onDelete,
  onCancel
}: {
  attrs: FieldAttrs
  onSave: (a: Partial<FieldAttrs>) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(attrs.label)
  const [kind, setKind] = useState<FieldKind>(attrs.kind)
  const [options, setOptions] = useState(attrs.options.join('\n'))

  const save = (): void => {
    const opts = options
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)
    onSave({ label: label.trim() || 'Field', kind, options: opts })
  }

  return (
    <span
      className="ff-config"
      role="dialog"
      aria-label="Field settings"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          save()
        }
      }}
    >
      <label>
        Label
        <input autoFocus value={label} placeholder="e.g. Passcode" onChange={(e) => setLabel(e.target.value)} aria-label="Field label" />
      </label>
      <label>
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as FieldKind)} aria-label="Field type">
          {FIELD_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {kind === 'select' && (
        <label>
          Choices (one per line)
          <textarea rows={3} value={options} onChange={(e) => setOptions(e.target.value)} aria-label="Dropdown choices" />
        </label>
      )}
      <span className="ff-config-actions">
        <button type="button" className="btn sm danger" onClick={onDelete}>
          Remove
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn sm primary" onClick={save}>
          Done
        </button>
      </span>
    </span>
  )
}
