import { api } from '../api'
import { useUi } from '../store/ui'
import { saveDisplay } from '../store/display'
import { useSections } from '../store/sections'
import { useCustomerLayout } from '../store/customerLayout'
import { displayPrefs, type DocJSON } from '../../../shared/api'
import { sectionPreset } from '../../../shared/ticket-sections'
import { planFor } from '../../../shared/use-cases'

/**
 * Tailors Plannr to what it's used for (first-launch setup): the menu, names for tickets and customers, statuses,
 * sections and a starting preset (made the default), customer fields. Running it again with other choices updates
 * the same things; presets already made aren't made twice.
 */
export async function applyUseCases(ids: string[]): Promise<void> {
  const plan = planFor(ids)
  await api.settings.set('useCases', ids)
  useUi.getState().setPref('navHidden', plan.menuHidden.join(','))
  const b = plan.business
  if (!b) return

  const names = displayPrefs().navNames ?? {}
  await saveDisplay({
    navNames: { ...names, tickets: b.names?.tickets ?? '', customers: b.names?.customers ?? '' },
    ...(b.statuses ? { statuses: b.statuses } : {})
  })

  // Sections made for this work, and the built-in ones it doesn't need hidden from + Add
  const sections = useSections.getState()
  await sections.load()
  const lib = useSections.getState().lib
  const ownIds = new Set(plan.sections.map((s) => s.id))
  await sections.save({
    custom: [...lib.custom.filter((c) => !ownIds.has(c.id)), ...plan.sections],
    // Tech sections a previous choice hid come back unless this choice hides them; other hidden ones stay hidden
    hidden: [...new Set([...lib.hidden.filter((h) => !TECHISH.has(h)), ...plan.hideSections])]
  })

  // A starting preset, made the default for new tickets
  if (b.preset) {
    const templates = await api.templates.list('ticket')
    let id = templates.find((t) => t.name === b.preset!.name)?.id
    if (!id) {
      const blocks: DocJSON[] = []
      for (const sid of b.preset.sections) {
        const own = plan.sections.find((s) => s.id === sid)
        const builtIn = sectionPreset(sid)
        if (own) blocks.push({ type: 'ticketSection', attrs: { preset: own.id, title: own.title }, content: own.content })
        else if (builtIn && !builtIn.part) blocks.push({ type: 'ticketSection', attrs: { preset: builtIn.id, title: builtIn.title }, content: builtIn.content?.() ?? [{ type: 'paragraph' }] })
      }
      const created = await api.templates.create({ name: b.preset.name, kind: 'ticket', icon: b.preset.icon, content: { type: 'doc', content: [...blocks, { type: 'paragraph' }] }, layout: b.preset.layout })
      id = created.id
    }
    await api.settings.set('defaultTemplateId', id)
  } else {
    // Repair or "something else": the standard Quick ticket
    const quick = (await api.templates.list('ticket')).find((t) => t.name === 'Quick ticket')
    if (quick) await api.settings.set('defaultTemplateId', quick.id)
  }

  // Customer fields this work tends to need
  if (plan.customerFields.length) {
    const cl = useCustomerLayout.getState()
    await cl.load()
    const have = new Set(useCustomerLayout.getState().layout.fields.map((f) => f.id))
    const add = plan.customerFields.filter((f) => !have.has(f.id))
    if (add.length) await cl.save({ fields: [...useCustomerLayout.getState().layout.fields, ...add] })
  }
}

/** Sections a previous choice may have hidden; a new choice decides again */
const TECHISH = new Set(['passcode', 'device', 'specs', 'condition', 'backup', 'diagnosis', 'parts', 'checklist', 'software', 'accounts', 'network', 'remote', 'housecall'])
