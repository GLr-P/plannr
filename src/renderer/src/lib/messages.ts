import { formatCurrency, formatTicketNumber, statusLabel, type BusinessInfo, type Customer, type TicketSummary } from '../../../shared/api'
import { api } from '../api'
import { formatDay } from './format'

/** A message you send customers about a ticket. {placeholders} are filled in from the ticket. */
export interface MessageTemplate {
  id: string
  name: string
  subject: string
  body: string
}

export const PLACEHOLDERS: [string, string][] = [
  ['{first_name}', 'Customer’s first name'],
  ['{customer}', 'Customer’s full name'],
  ['{device}', 'Ticket title'],
  ['{ticket}', 'Ticket number'],
  ['{status}', 'Status'],
  ['{total}', 'Ticket total'],
  ['{owing}', 'Amount still owing'],
  ['{pickup}', 'Pickup date'],
  ['{business}', 'Your business name'],
  ['{phone}', 'Your phone number']
]

export const DEFAULT_MESSAGES: MessageTemplate[] = [
  {
    id: 'ready',
    name: 'Ready for pickup',
    subject: 'Your {device} is ready ({ticket})',
    body: 'Hi {first_name},\n\nGood news: your {device} is ready for pickup. The total is {total}{owing_line}.\n\nThanks,\n{business}\n{phone}'
  },
  {
    id: 'quote',
    name: 'Quote ready',
    subject: 'Quote for your {device} ({ticket})',
    body: 'Hi {first_name},\n\nWe’ve looked at your {device}. The repair will be {total}. Let us know if you’d like us to go ahead.\n\nThanks,\n{business}\n{phone}'
  },
  {
    id: 'parts',
    name: 'Waiting on parts',
    subject: 'Update on your {device} ({ticket})',
    body: 'Hi {first_name},\n\nQuick update: we’re waiting on a part for your {device}. We’ll let you know as soon as it arrives.\n\nThanks,\n{business}'
  },
  {
    id: 'thanks',
    name: 'Thanks',
    subject: 'Thanks for choosing {business}',
    body: 'Hi {first_name},\n\nThanks for trusting us with your {device}. If anything isn’t right, just reply to this message.\n\n{business}\n{phone}'
  }
]

export async function loadTemplates(): Promise<MessageTemplate[]> {
  const saved = (await api.settings.get('messageTemplates')) as MessageTemplate[] | null
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_MESSAGES
}

export const saveTemplates = (list: MessageTemplate[]): Promise<void> => api.settings.set('messageTemplates', list)

/** Fills a template's {placeholders} from a ticket. Unknown placeholders are left as typed. */
export function fillMessage(text: string, ctx: { ticket: TicketSummary; customer: Customer | null; business: BusinessInfo }): string {
  const { ticket, customer, business } = ctx
  const name = customer?.name || ticket.customerName || ''
  const owing = Math.max(0, (ticket.priceCents ?? 0) - ticket.paidCents)
  const vars: Record<string, string> = {
    first_name: name.split(/\s+/)[0] || 'there',
    customer: name || 'there',
    device: ticket.device || 'order',
    ticket: formatTicketNumber(ticket.number),
    status: statusLabel(ticket.status),
    total: ticket.priceCents ? formatCurrency(ticket.priceCents) : '(to be confirmed)',
    owing: formatCurrency(owing),
    owing_line: ticket.paidCents > 0 && owing > 0 ? ` (${formatCurrency(owing)} still owing)` : ticket.paidCents > 0 && owing === 0 ? ', already paid' : '',
    pickup: ticket.pickupOn ? formatDay(ticket.pickupOn) : '',
    business: business.name || 'us',
    phone: business.phone || ''
  }
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? vars[key] : m)).replace(/\n{3,}/g, '\n\n').trim()
}
