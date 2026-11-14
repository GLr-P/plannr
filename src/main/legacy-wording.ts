import type { Db } from './db'
import { pinLegacyStatuses } from './display'
import { getSetting, setSetting } from './services/settings'
import { pinLegacyTemplateWording } from './services/templates'

/** The customer messages every install had before 1.1 (repair wording); the standard ones are general now */
export const LEGACY_MESSAGES = [
  { id: 'ready', name: 'Ready for pickup', subject: 'Your {device} is ready ({ticket})', body: 'Hi {first_name},\n\nGood news: your {device} is ready for pickup. The total is {total}{owing_line}.\n\nThanks,\n{business}\n{phone}' },
  { id: 'quote', name: 'Quote ready', subject: 'Quote for your {device} ({ticket})', body: 'Hi {first_name},\n\nWe’ve looked at your {device}. The repair will be {total}. Let us know if you’d like us to go ahead.\n\nThanks,\n{business}\n{phone}' },
  { id: 'parts', name: 'Waiting on parts', subject: 'Update on your {device} ({ticket})', body: 'Hi {first_name},\n\nQuick update: we’re waiting on a part for your {device}. We’ll let you know as soon as it arrives.\n\nThanks,\n{business}' },
  { id: 'thanks', name: 'Thanks', subject: 'Thanks for choosing {business}', body: 'Hi {first_name},\n\nThanks for trusting us with your {device}. If anything isn’t right, just reply to this message.\n\n{business}\n{phone}' }
]

/**
 * Once, when the standard wording became general (1.1, "the program should assume you could be anything"): installs
 * from before keep what they see. Statuses and customer messages are kept as they were unless the setup was done for
 * something other than repair; templates keep their box names (see pinLegacyTemplateWording). Fresh installs get the
 * general wording. Runs before the starter templates (whose flag tells an earlier install from a new one).
 */
export function pinLegacyWording(db: Db): void {
  if (getSetting(db, 'wordingPinned')) return
  const existing = Boolean(getSetting(db, 'starterTemplateCreated'))
  const raw = getSetting(db, 'useCases')
  const uses = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : null
  const repairish = uses === null || uses.length === 0 || uses.includes('repair')
  if (existing && repairish) {
    pinLegacyStatuses(db, true)
    if (getSetting(db, 'messageTemplates') === null) setSetting(db, 'messageTemplates', LEGACY_MESSAGES)
  }
  pinLegacyTemplateWording(db, existing, uses)
  setSetting(db, 'wordingPinned', true)
}
