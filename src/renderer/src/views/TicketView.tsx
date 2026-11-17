import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays } from '../lib/time'
import { todayISO } from '../lib/format'
import { CalendarCheck, CalendarDays, DollarSign, ExternalLink, Mail, Phone, RotateCcw, User, ShieldCheck } from 'lucide-react'
import {
  formatCurrency,
  formatTicketNumber,
  statusLabel,
  type Customer,
  type CustomerInput,
  type DocJSON,
  type Ticket,
  type TicketUpdate
} from '../../../shared/api'
import { api } from '../api'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { useAutosave } from '../lib/useAutosave'
import { formatMoney, parseMoney } from '../lib/format'
import { NoteEditor } from '../editor/NoteEditor'
import { ConfirmButton, SaveIndicator, StatusSelect } from '../components/common'
import { showToast, undoToast } from '../lib/toast'
import { openMenu } from '../components/ContextMenu'
import { Printer, Receipt, Tag, ClipboardList, FileText as FileTextIcon, FileCheck, LayoutTemplate } from 'lucide-react'
import { TicketLines } from '../components/TicketLines'
import { MessageSquare } from 'lucide-react'
import { loadTemplates } from '../lib/messages'
import { useMessageDialog } from '../components/MessageDialog'
import type { PrintKind } from '../../../shared/api'
import { openPrint } from '../components/PrintPreview'

/** What a date box is called for screen readers: its own name ("Pickup" → "Pickup date", "Due date" stays) */
const dateLabel = (label: string): string => (/date/i.test(label) ? label : `${label} date`)
const PRINT_NAME: Record<PrintKind, string> = { form: 'Form', intake: 'Customer slip', quote: 'Quote', invoice: 'Invoice', receipt: 'Receipt', label: 'Label' }
import { CustomerPicker, ClearButton } from '../components/CustomerPicker'
import { PhotoGallery } from '../components/PhotoGallery'
import { Backlinks } from '../components/Backlinks'
import { CustomerEmails } from '../components/CustomerEmails'
import { useFormLinks, type FieldLink } from '../editor/formLinks'
import { isCanvas } from '../../../shared/canvas'
import { CanvasView } from '../canvas/CanvasView'
import { useTicketParts } from '../canvas/CanvasItem'
import { LinkedEvents } from '../components/LinkedEvents'
import { TicketPayments } from './MoneyView'
import type { Editor } from '@tiptap/core'
import { Plus, SlidersHorizontal, Users, X } from 'lucide-react'
import { useNavName } from '../store/display'
import { singular } from '../lib/navOrder'
import { ForPicker, MoreTickets } from '../components/TicketLinks'
import { openPanel } from '../components/ContextMenu'
import { AddToTicketPanel } from '../components/AddToTicket'
import { sectionNode, sectionsIn, templateBody, type SectionPreset } from '../../../shared/ticket-sections'
import { newSectionId, useSections } from '../store/sections'
import type { TemplateSummary } from '../../../shared/api'
import { isReadyStatus, ticketLayout, type TicketLayout, type TicketPart } from '../../../shared/api'

export function TicketView({ id }: { id: string }) {
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined)
  const reload = useCallback(() => api.tickets.get(id).then(setTicket), [id])
  // Changed from outside while open (a scan from Troubleshootr, another device): the page starts over with that copy.
  const [version, setVersion] = useState(0)
  const onOutsideChange = useCallback((fresh: Ticket) => {
    setTicket(fresh)
    setVersion((v) => v + 1)
  }, [])
  useEffect(() => {
    let cancelled = false
    setTicket(undefined)
    void api.tickets.get(id).then((t) => !cancelled && setTicket(t))
    return () => {
      cancelled = true
    }
  }, [id])

  if (ticket === undefined) return <div className="page" />
  if (ticket === null)
    return (
      <div className="page empty-state">
        <p>This ticket doesn’t exist anymore.</p>
        <button type="button" className="btn" onClick={() => go({ view: 'tickets' })}>
          All tickets
        </button>
      </div>
    )
  return <TicketPage key={`${ticket.id}:${ticket.deletedAt}:${version}`} ticket={ticket} reload={reload} onOutsideChange={onOutsideChange} />
}

type Fields = Omit<TicketUpdate, 'content' | 'taxExempt' | 'layout'>

/** The ticket's body knows it's a ticket (the / menu offers Customer details and Ticket dates). */
const TICKET_EDITOR = { ticket: true }

function TicketPage({ ticket, reload, onOutsideChange }: { ticket: Ticket; reload: () => Promise<void>; onOutsideChange: (fresh: Ticket) => void }) {
  const [fields, setFields] = useState<Required<Fields>>({
    customerId: ticket.customerId,
    status: ticket.status,
    device: ticket.device,
    issue: ticket.issue,
    priceCents: ticket.priceCents,
    receivedOn: ticket.receivedOn,
    pickupOn: ticket.pickupOn,
    warrantyUntil: ticket.warrantyUntil,
    forId: ticket.forId,
    business: ticket.business,
    parts: ticket.parts
  })
  const [priceText, setPriceText] = useState(formatMoney(ticket.priceCents))
  const [fromLines, setFromLines] = useState(false) // the price comes from the line items
  const [taxExempt, setTaxExempt] = useState(ticket.taxExempt)
  const onLinesTotal = useCallback((cents: number | null) => {
    setFromLines(cents !== null)
    if (cents === null) return
    setFields((f) => ({ ...f, priceCents: cents }))
    setPriceText(formatMoney(cents))
  }, [])
  const [updatedAt, setUpdatedAt] = useState(ticket.updatedAt)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const trashed = ticket.deletedAt !== null
  // The template's layout (names for the boxes, what shows) with this ticket's own changes on top (Customize)
  const [baseLayout, setBaseLayout] = useState(ticket.layout)
  const [own, setOwnState] = useState<Partial<TicketLayout>>(ticket.ownLayout ?? {})
  // Your names for tickets and customers (e.g. Commissions, Clients) stand in for the standard words
  const ticketsName = useNavName('tickets', 'Tickets')
  const customersName = useNavName('customers', 'Customers')
  const layout = useMemo(() => {
    const l = ticketLayout({ ...baseLayout, ...own })
    if (l.customerLabel === 'Customer' && customersName !== 'Customers') {
      const one = singular(customersName)
      l.customerLabel = one.charAt(0).toUpperCase() + one.slice(1)
    }
    return l
  }, [baseLayout, own, customersName])
  const [customizing, setCustomizing] = useState(false)

  const saver = useAutosave<TicketUpdate>(async (patch) => {
    const s = await api.tickets.update(ticket.id, patch)
    setUpdatedAt(s.updatedAt)
    if (patch.status) void useData.getState().refreshCounts()
    // Ready for pickup: offer to let the customer know.
    if (patch.status && isReadyStatus(patch.status)) {
      showToast(`${statusLabel(patch.status)}. Let them know?`, {
        label: 'Message',
        run: async () => openMessage((await loadTemplates()).find((t) => t.id === 'ready'))
      })
    }
  })

  /** Opens a customer message for this ticket (the menu picks a template; the toast opens "Ready for pickup"). */
  const openMessage = async (template?: Awaited<ReturnType<typeof loadTemplates>>[number]): Promise<void> => {
    await saver.flush()
    const latest = await api.tickets.get(ticket.id)
    if (!template || !latest) return
    useMessageDialog.getState().set({ template, ticket: latest, customer: customerIdRef.current ? await api.customers.get(customerIdRef.current) : null })
  }

  // Customer details typed on the ticket are saved to the customer record.
  const customerIdRef = useRef(ticket.customerId)
  const customerSaver = useAutosave<CustomerInput>(async (patch) => {
    if (customerIdRef.current) await api.customers.update(customerIdRef.current, patch)
  })

  const customerRef = useRef<Customer | null>(null)
  customerRef.current = customer
  useEffect(() => {
    customerIdRef.current = fields.customerId
    if (!fields.customerId) return setCustomer(null)
    if (customerRef.current?.id === fields.customerId) return // just created from a fill-in field: already here
    void api.customers.get(fields.customerId).then(setCustomer)
  }, [fields.customerId])

  const set = (patch: Fields, immediate = false): void => {
    setFields((f) => ({ ...f, ...patch }))
    saver.queue(patch)
    if (immediate) void saver.flush()
  }

  const setCustomerField = (patch: CustomerInput): void => {
    if (!customerIdRef.current) return setLinkedCustomer(patch) // still a draft (typed in the form): it becomes a customer
    setCustomer((c) => (c ? { ...c, ...patch } : c))
    customerSaver.queue(patch)
  }

  // Fill-in fields linked to the customer, on a ticket with no customer yet: the name field offers existing
  // customers; a typed name becomes a new customer when you leave the field (other details create it right away).
  const creating = useRef<Promise<void> | null>(null)
  const pendingCustomer = useRef<CustomerInput>({})
  const mounted = useRef(true)
  const setLinkedCustomer = (patch: CustomerInput): void => {
    if (customerIdRef.current) return setCustomerField(patch)
    setCustomer((c) => ({ ...(c ?? { id: '', name: '', phone: '', email: '', address: '', company: '', city: '', region: '', postalCode: '', notes: '', related: [], fields: {}, createdAt: 0, updatedAt: 0, deletedAt: null }), ...patch }))
    pendingCustomer.current = { ...pendingCustomer.current, ...patch }
    if (Object.keys(patch).some((k) => k !== 'name')) createDraftCustomer()
  }
  const createDraftCustomer = (): void => {
    if (creating.current || customerIdRef.current) return
    if (!Object.values(pendingCustomer.current).some((v) => v?.trim())) return
    creating.current = (async () => {
      const first = pendingCustomer.current
      pendingCustomer.current = {}
      const created = await api.customers.create(first)
      customerIdRef.current = created.id
      if (!mounted.current) {
        await api.tickets.update(ticket.id, { customerId: created.id }) // left the page while it was being made
        return
      }
      setCustomer((c) => ({ ...created, ...c, id: created.id }))
      set({ customerId: created.id }, true)
      if (Object.keys(pendingCustomer.current).length) customerSaver.queue(pendingCustomer.current) // typed while it was being created
      pendingCustomer.current = {}
    })().finally(() => (creating.current = null))
  }
  const pickExisting = (id: string): void => {
    pendingCustomer.current = {}
    setCustomer(null)
    void pickCustomer(id)
  }
  useEffect(
    () => () => {
      mounted.current = false
      createDraftCustomer() // a name typed but never left: keep it
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const pickCustomer = async (customerId: string | null): Promise<void> => {
    await customerSaver.flush() // finish saving edits to the previous customer first
    set({ customerId }, true)
  }

  // ---------- Sections (+ Add) ----------
  const editorRef = useRef<Editor | null>(null)
  const onEditorReady = useCallback((editor: Editor) => (editorRef.current = editor), [])
  const [inDoc, setInDoc] = useState(() => sectionsIn(ticket.content)) // text sections on the ticket, by preset id
  const remoteChange = useData((s) => s.remote)
  useEffect(() => void useSections.getState().load(), [remoteChange]) // your sections (synced)
  // This ticket changed outside this page (a Troubleshootr scan added to it, an edit on another device): reload it,
  // or the editor's next save would write its older copy back over that change. Your own unsaved typing goes first.
  const updatedAtRef = useRef(updatedAt)
  updatedAtRef.current = updatedAt
  const saveStatusRef = useRef(saver.status)
  saveStatusRef.current = saver.status
  const firstRemote = useRef(remoteChange)
  useEffect(() => {
    if (remoteChange === firstRemote.current) return
    let cancelled = false
    void (async () => {
      if (saveStatusRef.current !== 'saved') return
      const fresh = await api.tickets.get(ticket.id)
      if (!cancelled && fresh && fresh.updatedAt > updatedAtRef.current && saveStatusRef.current === 'saved') onOutsideChange(fresh)
    })()
    return () => {
      cancelled = true
    }
  }, [remoteChange, ticket.id, onOutsideChange])
  const onContent = useCallback(
    (doc: DocJSON) => {
      saver.queue({ content: doc })
      setInDoc(sectionsIn(doc))
    },
    [saver.queue]
  )
  // Parts with something in them always show, so removing one never hides information
  const [hasLines, setHasLines] = useState(false)
  const [photoCount, setPhotoCount] = useState(0)
  useEffect(() => {
    void api.tickets.items(ticket.id).then((l) => setHasLines(l.length > 0))
    void api.photos.list(ticket.id).then((p) => setPhotoCount(p.length))
  }, [ticket.id])
  const parts = fields.parts
  const added = (p: TicketPart): boolean => parts.includes(p)
  // Removed on this ticket (Customize ×) wins; otherwise a part shows when the template, + Add or its data says so
  const removed = (k: keyof TicketLayout): boolean => own[k] === false
  // Who it's for only shows when there's a choice (a business or linked people), it's set, or you put it there
  const forVisible =
    layout.showFor && (own.showFor === true || customizing || Boolean(customer?.company) || Boolean(customer?.related.length) || Boolean(fields.forId) || fields.business)
  const show = {
    pickup: !removed('showPickup') && (layout.showPickup || added('pickup') || Boolean(fields.pickupOn)),
    warranty: !removed('showWarranty') && ((layout.showWarranty && layout.showPickup) || added('warranty') || Boolean(fields.warrantyUntil)),
    lines: !removed('showLines') && (layout.showLines || added('lines') || hasLines || fromLines),
    photos: !removed('showPhotos') && (layout.showPhotos || added('photos') || photoCount > 0),
    emails: !removed('showEmails') && (layout.showEmails || added('emails'))
  }
  const present = new Set<string>([...inDoc, ...(Object.keys(show) as TicketPart[]).filter((p) => show[p]).map((p) => `part:${p}`)])

  const setParts = (next: TicketPart[]): void => set({ parts: next }, true)

  /** This ticket's own layout changes (a renamed or removed box); saved with the ticket */
  const setOwn = (patch: Partial<TicketLayout>): void => {
    setOwnState((cur) => {
      const next = { ...cur, ...patch }
      saver.queue({ layout: next })
      return next
    })
  }
  const PART_KEY: Record<TicketPart, keyof TicketLayout> = { pickup: 'showPickup', photos: 'showPhotos', lines: 'showLines', warranty: 'showWarranty', emails: 'showEmails' }
  const removePart = (part: TicketPart): void => {
    setParts(parts.filter((p) => p !== part))
    setOwn({ [PART_KEY[part]]: false })
  }
  /** The built-in boxes at the top: removed ones come back from + Add */
  const boxes: { id: string; label: string; shown: boolean; restore: Partial<TicketLayout> }[] = [
    { id: 'title', label: layout.titleLabel, shown: layout.showTitle, restore: { showTitle: true } },
    { id: 'summary', label: layout.summaryLabel, shown: layout.showSummary, restore: { showSummary: true } },
    { id: 'customer', label: layout.customerLabel, shown: layout.showCustomer, restore: { showCustomer: true } },
    { id: 'phone', label: layout.phoneLabel, shown: layout.showCustomer && layout.showCustomerPhone, restore: { showCustomer: true, showCustomerPhone: true } },
    { id: 'email', label: layout.emailLabel, shown: layout.showCustomer && layout.showCustomerEmail, restore: { showCustomer: true, showCustomerEmail: true } },
    { id: 'for', label: `${layout.forLabel} (their business or someone else)`, shown: layout.showCustomer && forVisible, restore: { showCustomer: true, showFor: true } },
    { id: 'received', label: layout.receivedLabel, shown: layout.showReceived, restore: { showReceived: true } },
    { id: 'price', label: `${layout.priceLabel} & payments`, shown: layout.showPrice, restore: { showPrice: true } },
    { id: 'status', label: 'Status', shown: layout.showStatus, restore: { showStatus: true } }
  ]

  const resetLayout = async (): Promise<void> => {
    setOwnState({})
    saver.queue({ layout: null })
    await saver.flush()
    const fresh = await api.tickets.get(ticket.id)
    if (fresh) setBaseLayout(fresh.layout)
  }
  /** What's showing and its names, as a template layout (for "use for new tickets" and "save as a preset") */
  const layoutForTemplate = (): Partial<TicketLayout> => ({
    ...layout,
    showPickup: false,
    showPhotos: false,
    showLines: false,
    showEmails: false,
    showWarranty: false,
    parts: (Object.keys(show) as TicketPart[]).filter((p) => show[p])
  })
  const [templateName, setTemplateName] = useState('')
  useEffect(() => {
    if (ticket.templateId) void api.templates.get(ticket.templateId).then((t) => setTemplateName(t?.name ?? ''))
  }, [ticket.templateId])
  const useForTemplate = async (): Promise<void> => {
    if (!ticket.templateId) return
    // The sections in the body go with the boxes at the top (before 1.2 only the boxes and parts did)
    const body = isCanvas(ticket.content) ? undefined : (editorRef.current?.getJSON() as DocJSON | undefined)
    const current = body ? await api.templates.get(ticket.templateId) : null // its own lines of text (e.g. terms) stay
    await api.templates.update(ticket.templateId, { layout: layoutForTemplate(), ...(body ? { content: templateBody(body, current?.content) } : {}) })
    await resetLayout()
    showToast(`New “${templateName}” tickets will look like this one`)
  }
  const [presetName, setPresetName] = useState<string | null>(null)
  const saveAsPreset = async (): Promise<void> => {
    const name = (presetName ?? '').trim()
    if (!name) return
    const body = editorRef.current?.getJSON() as DocJSON | undefined
    const content = templateBody(body)
    await api.templates.create({ name, kind: 'ticket', content, layout: layoutForTemplate() })
    setPresetName(null)
    showToast(`Saved “${name}”. It’s in + Add and the New ticket menu.`)
  }

  /** Puts a section at the end of the ticket and moves to its first box */
  const insertSection = (s: SectionPreset, focusIt = true): void => {
    const editor = editorRef.current
    if (!editor) return
    const { doc } = editor.state
    const last = doc.lastChild
    const at = last && last.type.name === 'paragraph' && last.content.size === 0 ? doc.content.size - last.nodeSize : doc.content.size
    editor.chain().insertContentAt(at, sectionNode(s)).run()
    if (!focusIt) return
    requestAnimationFrame(() => {
      const all = document.querySelectorAll<HTMLElement>(`.ticket-body .ticket-section[data-preset="${s.id}"]`)
      const el = all[all.length - 1]
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const box = el?.querySelector<HTMLElement>('.ticket-section-body input, .ticket-section-body textarea, .ticket-section-body select')
      if (box) box.focus()
      else editor.commands.focus(at + 3)
    })
  }

  const addSection = (s: SectionPreset): void => {
    if (s.part) {
      const part = s.part
      if (present.has(s.id)) return removePart(part)
      setParts([...parts, part])
      setOwn({ [PART_KEY[part]]: true })
      return
    }
    if (inDoc.has(s.id)) {
      document.querySelector<HTMLElement>(`.ticket-body .ticket-section[data-preset="${s.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    insertSection(s)
  }

  /** A preset is any ticket template: its sections that aren't here yet, and its parts */
  const addTemplate = async (t: TemplateSummary): Promise<void> => {
    const full = await api.templates.get(t.id)
    const editor = editorRef.current
    if (!full || !editor) return
    const blocks = (full.content?.content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length))
    const titles = new Set<string>()
    editor.state.doc.forEach((n) => n.type.name === 'ticketSection' && titles.add(String(n.attrs.title).toLowerCase()))
    const sectionsOfIt = blocks.filter((b) => b.type === 'ticketSection')
    // Sections not here yet (by kind, or by name for your own); a template without sections adds all it has
    const toAdd = sectionsOfIt.length
      ? sectionsOfIt.filter((b) => !inDoc.has(String(b.attrs?.preset ?? '')) && !titles.has(String(b.attrs?.title ?? '').toLowerCase()))
      : blocks
    for (const b of toAdd) {
      const { doc } = editor.state
      const last = doc.lastChild
      const at = last && last.type.name === 'paragraph' && last.content.size === 0 ? doc.content.size - last.nodeSize : doc.content.size
      editor.chain().insertContentAt(at, b).run()
    }
    const newParts = ticketLayout(full.layout).parts.filter((p) => !show[p])
    if (newParts.length) {
      setParts([...new Set([...parts, ...newParts])])
      setOwn(Object.fromEntries(newParts.map((p) => [PART_KEY[p], true])))
    }
    const count = toAdd.length + newParts.length
    showToast(count ? `Added ${count} from “${t.name}”` : `This ticket already has everything in “${t.name}”`)
  }

  /** A blank section to name and fill in; ⋯ on it saves it to your sections */
  const addNewSection = (): void => {
    const editor = editorRef.current
    if (!editor) return
    const { doc } = editor.state
    const last = doc.lastChild
    const at = last && last.type.name === 'paragraph' && last.content.size === 0 ? doc.content.size - last.nodeSize : doc.content.size
    editor.chain().insertContentAt(at, { type: 'ticketSection', attrs: { preset: newSectionId(), title: 'New section' }, content: [{ type: 'paragraph' }] }).run()
    requestAnimationFrame(() => {
      const all = document.querySelectorAll<HTMLInputElement>('.ticket-body .ticket-section .ticket-section-title')
      const title = all[all.length - 1]
      title?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      title?.focus()
      title?.select()
    })
  }

  const openAdd = async (anchor: HTMLElement): Promise<void> => {
    const templates = await api.templates.list('ticket')
    openPanel(anchor, 'Add to this ticket', () => (
      <AddToTicketPanel
        present={present}
        textSections={!isCanvas(ticket.content)}
        templates={templates}
        onSection={addSection}
        onTemplate={(t) => void addTemplate(t)}
        onNewSection={addNewSection}
        hiddenBoxes={boxes.filter((b) => !b.shown)}
        onBox={(id) => {
          const box = boxes.find((b) => b.id === id)
          if (box) setOwn(box.restore)
        }}
      />
    ))
  }

  // What linked fill-in fields in the ticket's body show, and where their edits go.
  const setLinked = (link: FieldLink, value: string): void => {
    if (link === 'customer.name') setLinkedCustomer({ name: value })
    else if (link === 'customer.phone') setLinkedCustomer({ phone: value })
    else if (link === 'customer.email') setLinkedCustomer({ email: value })
    else if (link === 'customer.address') setLinkedCustomer({ address: value })
    else if (link === 'ticket.device') set({ device: value })
    else if (link === 'ticket.issue') set({ issue: value })
    else if (link === 'ticket.receivedOn') set({ receivedOn: value || null }, true)
    else if (link === 'ticket.pickupOn') set({ pickupOn: value || null }, true)
  }
  const setLinkedRef = useRef(setLinked)
  setLinkedRef.current = setLinked
  const pickExistingRef = useRef(pickExisting)
  pickExistingRef.current = pickExisting
  const commitRef = useRef(createDraftCustomer)
  commitRef.current = createDraftCustomer
  useEffect(() => {
    useFormLinks.setState({
      active: !trashed,
      set: (link, value) => setLinkedRef.current(link, value),
      hasCustomer: Boolean(customer?.id),
      pickCustomer: (id) => pickExistingRef.current(id),
      commit: () => commitRef.current(),
      values: {
        'customer.name': customer?.name ?? '',
        'customer.phone': customer?.phone ?? '',
        'customer.email': customer?.email ?? '',
        'customer.address': customer?.address ?? '',
        'ticket.device': fields.device,
        'ticket.issue': fields.issue,
        'ticket.receivedOn': fields.receivedOn ?? '',
        'ticket.pickupOn': fields.pickupOn ?? '',
        'ticket.number': formatTicketNumber(ticket.number),
        'ticket.price': fields.priceCents === null ? '' : formatCurrency(fields.priceCents)
      }
    })
  }, [customer, fields, trashed, ticket.number])
  useEffect(() => () => useFormLinks.setState({ active: false, values: {} }), [])

  // Canvas templates can place the ticket's photos, quote lines and payments anywhere on the page.
  useEffect(() => {
    useTicketParts.setState({
      parts: {
        photos: () => <PhotoGallery ticketId={ticket.id} />,
        lines: () => (
          <TicketLines
            ticketId={ticket.id}
            taxExempt={taxExempt}
            readOnly={trashed}
            onTotal={onLinesTotal}
            onTaxExempt={(exempt) => {
              setTaxExempt(exempt)
              void api.tickets.update(ticket.id, { taxExempt: exempt })
            }}
          />
        ),
        payments: () => (trashed ? null : <TicketPayments key={fields.priceCents ?? 0} ticketId={ticket.id} number={ticket.number} priceCents={fields.priceCents} />)
      }
    })
  }, [ticket.id, ticket.number, taxExempt, trashed, onLinesTotal, fields.priceCents])
  useEffect(() => () => useTicketParts.setState({ parts: {} }), [])

  const restore = async (): Promise<void> => {
    await api.tickets.restore(ticket.id)
    void useData.getState().refreshCounts()
    await reload()
  }

  const trash = async (): Promise<void> => {
    await saver.flush()
    await api.tickets.trash(ticket.id)
    void useData.getState().refreshCounts()
    go({ view: 'tickets' })
    undoToast(`${formatTicketNumber(ticket.number)} moved to trash`, async () => {
      await api.tickets.restore(ticket.id)
      void useData.getState().refreshCounts()
      go({ view: 'ticket', id: ticket.id })
    })
  }

  return (
    <div className="page ticket-page">
      <div className="page-toolbar">
        <div className="crumbs">
          <button type="button" className="crumb" onClick={() => go({ view: 'tickets' })}>
            {ticketsName}
          </button>
          <span className="crumb-sep">/</span>
          <span className="ticket-no">{formatTicketNumber(ticket.number)}</span>
        </div>
        <div className="toolbar-right">
          <SaveIndicator status={saver.status} updatedAt={updatedAt} />
          {!trashed && (
            <>
              {layout.showStatus && (
                <span className={customizing ? 'customize-box' : undefined}>
                  <StatusSelect value={fields.status} onChange={(status) => set({ status }, true)} />
                  {customizing && <RemoveBox label="Status" onRemove={() => setOwn({ showStatus: false })} />}
                </span>
              )}
              <button type="button" className={`btn sm ${customizing ? 'active' : ''}`} aria-pressed={customizing} title="Rename or remove anything on this ticket" onClick={() => setCustomizing((c) => !c)}>
                <SlidersHorizontal /> Customize
              </button>
              <button type="button" className="btn sm" title="Add sections, photos, dates and more" onClick={(e) => void openAdd(e.currentTarget)}>
                <Plus /> Add
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={async (e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const templates = await loadTemplates()
                  openMenu(
                    { clientX: r.left, clientY: r.bottom + 4 },
                    templates.map((t) => ({ label: t.name, icon: <MessageSquare />, onSelect: () => openMessage(t) }))
                  )
                }}
              >
                <MessageSquare /> Message
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  const print = async (kind: PrintKind): Promise<void> => {
                    await saver.flush()
                    await openPrint({ title: `${formatTicketNumber(ticket.number)} ${PRINT_NAME[kind]}`, ticket: { id: ticket.id, kind }, fixedSize: kind === 'label' }).catch((err: Error) =>
                      showToast(err.message)
                    )
                  }
                  openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
                    { label: 'Form (everything, as designed)', icon: <LayoutTemplate />, onSelect: () => print('form') },
                    { label: 'Customer slip (their copy)', icon: <ClipboardList />, onSelect: () => print('intake') },
                    { label: 'Quote', icon: <FileTextIcon />, onSelect: () => print('quote') },
                    { label: 'Invoice', icon: <FileCheck />, onSelect: () => print('invoice') },
                    { label: 'Receipt', icon: <Receipt />, onSelect: () => print('receipt') },
                    { label: 'Label', icon: <Tag />, onSelect: () => print('label') }
                  ])
                }}
              >
                <Printer /> Print
              </button>
              <ConfirmButton title="Move ticket to trash" onConfirm={trash} />
            </>
          )}
        </div>
      </div>

      {trashed && (
        <div className="banner">
          This ticket is in the trash.
          <button type="button" className="btn sm" onClick={() => void restore()}>
            <RotateCcw /> Restore
          </button>
        </div>
      )}

      <div className="doc">
        {customizing && (
          <div className="customize-banner">
            <div>
              <b>Customizing this ticket.</b> Type over a name to rename it, × to remove it. Removed boxes come back from + Add.
            </div>
            <div className="customize-actions">
              {ticket.templateId && templateName && (
                <button type="button" className="btn sm" onClick={() => void useForTemplate()}>
                  Use for new “{templateName}” tickets
                </button>
              )}
              {presetName === null ? (
                <button type="button" className="btn sm" onClick={() => setPresetName('')}>
                  Save as a new preset…
                </button>
              ) : (
                <span className="preset-name">
                  <input
                    autoFocus
                    className="prop-input"
                    value={presetName}
                    placeholder="Preset name"
                    aria-label="Preset name"
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveAsPreset()
                      if (e.key === 'Escape') setPresetName(null)
                    }}
                  />
                  <button type="button" className="btn sm primary" disabled={!presetName.trim()} onClick={() => void saveAsPreset()}>
                    Save
                  </button>
                </span>
              )}
              {Object.keys(own).length > 0 && (
                <button type="button" className="btn sm" onClick={() => void resetLayout()}>
                  Reset
                </button>
              )}
              <button type="button" className="btn sm primary" onClick={() => setCustomizing(false)}>
                Done
              </button>
            </div>
          </div>
        )}
        {customizing && layout.showTitle && (
          <BoxName label={layout.titleLabel} hint={layout.titlePlaceholder} onRename={(v) => setOwn({ titleLabel: v })} onHint={(v) => setOwn({ titlePlaceholder: v })} onRemove={() => setOwn({ showTitle: false })} />
        )}
        {layout.showTitle && (
        <input
          className="doc-title"
          value={fields.device}
          placeholder={layout.titlePlaceholder}
          readOnly={trashed}
          autoFocus={!ticket.device && !trashed}
          onChange={(e) => set({ device: e.target.value })}
          aria-label={layout.titleLabel}
        />
        )}
        {customizing && layout.showSummary && (
          <BoxName label={layout.summaryLabel} hint={layout.summaryPlaceholder} onRename={(v) => setOwn({ summaryLabel: v })} onHint={(v) => setOwn({ summaryPlaceholder: v })} onRemove={() => setOwn({ showSummary: false })} />
        )}
        {layout.showSummary && (
          <input
            className="doc-subtitle"
            value={fields.issue}
            placeholder={layout.summaryPlaceholder}
            readOnly={trashed}
            onChange={(e) => set({ issue: e.target.value })}
            aria-label={layout.summaryLabel}
          />
        )}

        {(layout.showCustomer || layout.showReceived || show.pickup || show.warranty || layout.showPrice) && (
          <div className="props">
            {layout.showCustomer && (
              <div className="prop">
                <PropLabel icon={<User />} label={layout.customerLabel} editing={customizing} onRename={(v) => setOwn({ customerLabel: v })} onRemove={() => setOwn({ showCustomer: false })} />
                {customer ? (
                  <span className="prop-value">
                    <input
                      className="prop-input"
                      value={customer.name}
                      placeholder="Name"
                      readOnly={trashed}
                      onChange={(e) => setCustomerField({ name: e.target.value })}
                      aria-label="Customer name"
                    />
                    <button
                      type="button"
                      className="icon-btn sm"
                      title="Open customer"
                      aria-label="Open customer"
                      disabled={!customer.id}
                      onClick={() => go({ view: 'customer', id: customer.id })}
                    >
                      <ExternalLink />
                    </button>
                    {!trashed && <ClearButton label="Change customer" onClick={() => void pickCustomer(null)} />}
                  </span>
                ) : trashed ? (
                  <span className="prop-value muted">—</span>
                ) : (
                  <CustomerPicker onPick={(id) => void pickCustomer(id)} />
                )}
              </div>
            )}
            {layout.showReceived && (
              <div className="prop">
                <PropLabel icon={<CalendarDays />} label={layout.receivedLabel} editing={customizing} onRename={(v) => setOwn({ receivedLabel: v })} onRemove={() => setOwn({ showReceived: false })} />
                <input
                  type="date"
                  className="prop-input"
                  value={fields.receivedOn ?? ''}
                  readOnly={trashed}
                  onChange={(e) => set({ receivedOn: e.target.value || null }, true)}
                  aria-label={dateLabel(layout.receivedLabel)}
                />
              </div>
            )}
            {layout.showCustomer && layout.showCustomerPhone && (
              <div className="prop">
                <PropLabel icon={<Phone />} label={layout.phoneLabel} editing={customizing} onRename={(v) => setOwn({ phoneLabel: v })} onRemove={() => setOwn({ showCustomerPhone: false })} />
                <input
                  className="prop-input"
                  value={customer?.phone ?? ''}
                  placeholder={customer ? 'Add phone' : 'Pick a customer first'}
                  disabled={!customer || trashed}
                  onChange={(e) => setCustomerField({ phone: e.target.value })}
                  aria-label="Customer phone"
                />
              </div>
            )}
            {show.pickup && (
              <div className="prop">
                <PropLabel icon={<CalendarCheck />} label={layout.pickupLabel} editing={customizing} onRename={(v) => setOwn({ pickupLabel: v })} onRemove={() => removePart('pickup')} />
                <input
                  type="date"
                  className="prop-input"
                  value={fields.pickupOn ?? ''}
                  readOnly={trashed}
                  onChange={(e) => set({ pickupOn: e.target.value || null }, true)}
                  aria-label={dateLabel(layout.pickupLabel)}
                  title={fields.pickupOn && fields.receivedOn && fields.pickupOn < fields.receivedOn ? `Before ${layout.receivedLabel.toLowerCase()}` : undefined}
                  data-warn={fields.pickupOn && fields.receivedOn && fields.pickupOn < fields.receivedOn ? 'true' : undefined}
                />
                {fields.pickupOn && fields.receivedOn && fields.pickupOn < fields.receivedOn && (
                  <span className="date-warning" role="note">
                    Before {layout.receivedLabel.toLowerCase()}
                  </span>
                )}
              </div>
            )}
            {show.warranty && (
              <div className="prop">
                <PropLabel icon={<ShieldCheck />} label={layout.warrantyLabel} editing={customizing} onRename={(v) => setOwn({ warrantyLabel: v })} onRemove={() => removePart('warranty')} />
                <span className="prop-warranty">
                  <select
                    className="prop-input"
                    value=""
                    disabled={trashed}
                    aria-label="Warranty length"
                    onChange={(e) => {
                      const days = Number(e.target.value)
                      if (!e.target.value) return
                      const from = fields.pickupOn ?? todayISO()
                      set({ warrantyUntil: days ? addDays(from, days) : null }, true)
                    }}
                  >
                    <option value="">{fields.warrantyUntil ? (fields.warrantyUntil >= todayISO() ? 'Covered until' : 'Ended') : 'None'}</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="180">6 months</option>
                    <option value="365">1 year</option>
                    <option value="0">No warranty</option>
                  </select>
                  {fields.warrantyUntil && (
                    <input type="date" className="prop-input" value={fields.warrantyUntil} readOnly={trashed} aria-label="Warranty until" onChange={(e) => set({ warrantyUntil: e.target.value || null }, true)} />
                  )}
                </span>
              </div>
            )}
            {layout.showCustomer && layout.showCustomerEmail && (
              <div className="prop">
                <PropLabel icon={<Mail />} label={layout.emailLabel} editing={customizing} onRename={(v) => setOwn({ emailLabel: v })} onRemove={() => setOwn({ showCustomerEmail: false })} />
                <input
                  className="prop-input"
                  value={customer?.email ?? ''}
                  placeholder={customer ? 'Add email' : 'Pick a customer first'}
                  disabled={!customer || trashed}
                  onChange={(e) => setCustomerField({ email: e.target.value })}
                  aria-label="Customer email"
                />
              </div>
            )}
            {layout.showPrice && (
              <div className="prop">
                <PropLabel icon={<DollarSign />} label={layout.priceLabel} editing={customizing} onRename={(v) => setOwn({ priceLabel: v })} onRemove={() => setOwn({ showPrice: false })} />
                <input
                  className="prop-input"
                  value={priceText}
                  placeholder="$0.00"
                  inputMode="decimal"
                  readOnly={trashed || fromLines}
                  title={fromLines ? 'Worked out from the line items below' : undefined}
                  onChange={(e) => setPriceText(e.target.value)}
                  onBlur={() => {
                    const cents = parseMoney(priceText)
                    setPriceText(formatMoney(cents))
                    if (cents !== fields.priceCents) set({ priceCents: cents }, true)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  aria-label="Price"
                />
              </div>
            )}
            {layout.showCustomer && forVisible && customer?.id && (
              <div className="prop">
                <PropLabel icon={<Users />} label={layout.forLabel} editing={customizing} onRename={(v) => setOwn({ forLabel: v })} onRemove={() => setOwn({ showFor: false })} />
                <ForPicker
                  customer={customer}
                  forId={fields.forId}
                  business={fields.business}
                  disabled={trashed}
                  onChange={(patch) => {
                    set(patch, true)
                    if (patch.forId && !customer.related.some((l) => l.id === patch.forId)) void api.customers.get(customer.id).then((c) => c && setCustomer(c))
                  }}
                />
              </div>
            )}
          </div>
        )}

        {show.lines && customizing && <RemoveBox label="Quote lines" wide onRemove={() => removePart('lines')} />}
        {show.lines && (
          <TicketLines
            ticketId={ticket.id}
            taxExempt={taxExempt}
            readOnly={trashed}
            onTotal={onLinesTotal}
            onTaxExempt={(exempt) => {
              setTaxExempt(exempt)
              void api.tickets.update(ticket.id, { taxExempt: exempt })
            }}
          />
        )}

        {!trashed && layout.showPrice && <TicketPayments key={fields.priceCents ?? 0} ticketId={ticket.id} number={ticket.number} priceCents={fields.priceCents} />}

        {show.photos && customizing && <RemoveBox label="Photos" wide onRemove={() => removePart('photos')} />}
        {show.photos && <PhotoGallery ticketId={ticket.id} />}

        <div className="ticket-body">
          {isCanvas(ticket.content) ? (
            <CanvasView doc={ticket.content!} editable={!trashed} onChange={onContent} />
          ) : (
            <NoteEditor docId={ticket.id} content={ticket.content} editable={!trashed} onChange={onContent} onReady={onEditorReady} options={TICKET_EDITOR} />
          )}
        </div>
        {!trashed && (
          <div className="ticket-add-row">
            <button type="button" className="btn sm" onClick={(e) => void openAdd(e.currentTarget)}>
              <Plus /> Add a section
            </button>
          </div>
        )}

        {show.emails && customer?.email && <CustomerEmails email={customer.email} name={customer.name} />}
        <MoreTickets ticketId={ticket.id} customerId={fields.customerId} customerName={customer?.name ?? ''} forId={fields.forId} />
        <LinkedEvents id={ticket.id} refreshKey={fields.pickupOn} />
        <Backlinks id={ticket.id} />
      </div>
    </div>
  )
}

/** A box's name at the top of a ticket; in Customize, its name can be typed over and it can be removed */
function PropLabel({ icon, label, editing, onRename, onRemove }: { icon: ReactNode; label: string; editing: boolean; onRename: (v: string) => void; onRemove: () => void }) {
  const [text, setText] = useState(label)
  useEffect(() => setText(label), [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!editing)
    return (
      <span className="prop-label">
        {icon} {label}
      </span>
    )
  return (
    <span className="prop-label customizing">
      {icon}
      <input
        className="prop-label-input"
        value={text}
        aria-label={`Name for ${label}`}
        onChange={(e) => {
          setText(e.target.value)
          onRename(e.target.value)
        }}
      />
      <RemoveBox label={label} onRemove={onRemove} />
    </span>
  )
}

/** The title's or summary's name and hint, in Customize */
function BoxName({ label, hint, onRename, onHint, onRemove }: { label: string; hint: string; onRename: (v: string) => void; onHint: (v: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(label)
  const [help, setHelp] = useState(hint)
  return (
    <div className="box-name">
      <input
        className="prop-label-input"
        value={name}
        aria-label={`Name for ${label}`}
        onChange={(e) => {
          setName(e.target.value)
          onRename(e.target.value)
        }}
      />
      <input
        className="prop-label-input hint"
        value={help}
        placeholder="Hint shown when empty"
        aria-label={`Hint for ${label}`}
        onChange={(e) => {
          setHelp(e.target.value)
          onHint(e.target.value)
        }}
      />
      <RemoveBox label={label} onRemove={onRemove} />
    </div>
  )
}

function RemoveBox({ label, onRemove, wide }: { label: string; onRemove: () => void; wide?: boolean }) {
  return (
    <button type="button" className={`icon-btn sm remove-box ${wide ? 'wide' : ''}`} aria-label={`Remove ${label}`} title={`Remove ${label} from this ticket`} onClick={onRemove}>
      <X />
      {wide && <span>Remove {label}</span>}
    </button>
  )
}
