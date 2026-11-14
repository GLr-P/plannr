import { api } from '../api'
import { useUi } from '../store/ui'
import { saveDisplay } from '../store/display'
import { useSections } from '../store/sections'
import { useCustomerLayout } from '../store/customerLayout'
import { DEFAULT_STATUSES, displayPrefs } from '../../../shared/api'
import { presetDoc, presetLayout, TAGGED_SECTIONS, ticketPreset, TICKET_PRESETS, untouched10, type TicketPreset } from '../../../shared/ticket-sections'
import { planFor } from '../../../shared/use-cases'

/**
 * Tailors Plannr to what it's used for (the setup walkthrough): the menu, names for tickets and customers, statuses,
 * which sections + Add shows, the presets and note templates for that work (made once, never twice), where new tickets
 * start, and customer fields. Running it again with other choices updates the same things; nothing you made is removed.
 */
export async function applyUseCases(ids: string[]): Promise<void> {
  const plan = planFor(ids)
  await api.settings.set('useCases', ids)
  useUi.getState().setPref('navHidden', plan.menuHidden.join(','))

  const p = plan.primary
  const names = displayPrefs().navNames ?? {}
  await saveDisplay({
    navNames: { ...names, tickets: p?.names?.tickets && p.names.tickets !== 'Tickets' ? p.names.tickets : '', customers: p?.names?.customers && p.names.customers !== 'Customers' ? p.names.customers : '' },
    statuses: p?.statuses ?? DEFAULT_STATUSES
  })

  // Sections that don't fit are hidden from + Add (a previous choice's are decided again; ones you hid stay hidden)
  const sections = useSections.getState()
  await sections.load()
  const lib = useSections.getState().lib
  await sections.save({ ...lib, hidden: [...new Set([...lib.hidden.filter((h) => !TAGGED_SECTIONS.has(h)), ...plan.hideSections])] })

  // Presets for this work, made once; the general ones lose 1.0's repair wording if you never changed them
  const templates = await api.templates.list('ticket')
  const byName = new Map(templates.map((t) => [t.name, t.id]))
  for (const preset of plan.presets) if (!byName.has(preset.name)) byName.set(preset.name, (await makePreset(preset)).id)
  if (!ids.includes('repair')) {
    for (const preset of TICKET_PRESETS.filter((x) => !x.uses)) {
      const id = byName.get(preset.name)
      const t = id ? await api.templates.get(id) : null
      if (t && untouched10(t.layout)) await api.templates.update(t.id, { layout: { ...t.layout, ...presetLayout(preset) } })
    }
  }
  const start = ticketPreset(p?.startPreset ?? 'quick') ?? ticketPreset('quick')!
  const startId = byName.get(start.name) ?? byName.get('Quick ticket')
  if (startId) await api.settings.set('defaultTemplateId', startId)

  // Note templates for this work, made once
  const notes = new Set((await api.templates.list('note')).map((t) => t.name))
  for (const t of plan.noteTemplates) if (!notes.has(t.name)) await api.templates.create({ name: t.name, kind: 'note', icon: t.icon, content: t.content })

  // Customer fields this work tends to need
  if (plan.customerFields.length) {
    const cl = useCustomerLayout.getState()
    await cl.load()
    const have = new Set(useCustomerLayout.getState().layout.fields.map((f) => f.id))
    const add = plan.customerFields.filter((f) => !have.has(f.id))
    if (add.length) await cl.save({ fields: [...useCustomerLayout.getState().layout.fields, ...add] })
  }
}

/** A preset as a ticket template */
export const makePreset = (preset: TicketPreset): Promise<{ id: string }> =>
  api.templates.create({ name: preset.name, kind: 'ticket', icon: preset.icon, content: presetDoc(preset), layout: presetLayout(preset) })
