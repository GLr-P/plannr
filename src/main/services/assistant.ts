import type { Db } from '../db'
import type { AssistantMessage, DocJSON } from '../../shared/api'
import { formatTicketNumber } from '../../shared/api'
import { extractText, localDate } from './doc'
import { search } from './search'
import { listEvents, createEvent } from './calendar'
import { listTasks, createTask } from './tasks'
import { listTickets, getTicket } from './tickets'
import { getNote, createNote, updateNote } from './notes'
import { getCustomer, listCustomers } from './customers'
import * as money from './money'
import { newsFeed } from './news'
import { listPackages } from './packages'
import { listHabits } from './habits'
import { addItem, listItems } from './lists'
import { entFeed } from './entertainment'

/**
 * The assistant: Claude, with tools that read and change Plannr (search, what's coming up, tickets, tasks, money,
 * news, packages…). The user's own Anthropic API key; nothing is sent until they ask something. `post` sends one
 * Messages API request (the platform supplies it, with the key).
 */

export type PostMessages = (body: unknown) => Promise<{ content?: ContentBlock[]; stop_reason?: string; error?: { message?: string } }>
type ContentBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

const day = (offset = 0): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return localDate(d)
}
const cents = (c: number): string => `$${(c / 100).toFixed(2)}`
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')

const TOOLS = [
  { name: 'search', description: 'Search notes, customers and tickets by words. Returns titles, ids and snippets.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  {
    name: 'coming_up',
    description: 'Calendar events, tasks due, bills due and packages expected in the next N days (default 7).',
    input_schema: { type: 'object', properties: { days: { type: 'number' } } }
  },
  { name: 'open_tickets', description: 'Open tickets (jobs/orders) with customer, what it is, status and pickup date.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_item', description: 'The full text of a note, ticket or customer by id (from search or other tools).', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['note', 'ticket', 'customer'] }, id: { type: 'string' } }, required: ['type', 'id'] } },
  { name: 'money_summary', description: 'Income, expenses, subscriptions and who owes money for a month (YYYY-MM, default this month).', input_schema: { type: 'object', properties: { month: { type: 'string' } } } },
  { name: 'news', description: 'Top stories from the News pages (local, games, PC parts…): the important ones and the latest.', input_schema: { type: 'object', properties: { page: { type: 'string', description: 'Page name, e.g. Local, Games' } } } },
  { name: 'personal', description: 'Habits for today, shopping/check-off lists, packages and new videos / live streamers.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'create_task',
    description: 'Add a task (to-do), optionally with a due date.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' } }, required: ['title'] }
  },
  {
    name: 'create_event',
    description: 'Put an event on the calendar.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, start_time: { type: 'string', description: 'HH:MM, 24-hour; omit for all day' }, end_time: { type: 'string' }, notes: { type: 'string' } },
      required: ['title', 'date']
    }
  },
  { name: 'add_to_list', description: 'Add items to a check-off list (e.g. Shopping).', input_schema: { type: 'object', properties: { list: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['list', 'items'] } },
  { name: 'create_note', description: 'Write a new note (for drafts, summaries, plans).', input_schema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } }
]

/** Runs one tool; returns its result as text and (for changes) a line saying what was done */
export function runTool(db: Db, name: string, input: Record<string, unknown>): { result: string; action?: string } {
  switch (name) {
    case 'search':
      return { result: JSON.stringify(search(db, str(input.query, 200), { limit: 12 }).map((r) => ({ type: r.type, id: r.id, title: r.title, snippet: r.snippet.replace(/[\u0001\u0002]/g, '') }))) }
    case 'coming_up': {
      const to = day(Math.min(60, Math.max(1, Number(input.days) || 7)))
      return {
        result: JSON.stringify({
          today: day(),
          events: listEvents(db, day(), to).map((e) => ({ date: e.date, time: e.startTime, title: e.title, about: e.linkTitle })),
          tasks: listTasks(db).filter((t) => t.dueDate && t.dueDate <= to).map((t) => ({ due: t.dueDate, title: t.title })),
          bills: money.occurrences(db, day(), to).map((b) => ({ date: b.date, name: b.name, amount: cents(b.amountCents) })),
          packages: listPackages(db).filter((p) => p.status !== 'delivered').map((p) => ({ label: p.label || p.number, expected: p.expected, status: p.statusText || p.status }))
        })
      }
    }
    case 'open_tickets':
      return {
        result: JSON.stringify(
          listTickets(db, { status: 'open' }).map((t) => ({ id: t.id, number: formatTicketNumber(t.number), customer: t.customerName, what: t.device, issue: t.issue, status: t.status, pickup: t.pickupOn, price: t.priceCents === null ? null : cents(t.priceCents), paid: cents(t.paidCents) }))
        )
      }
    case 'get_item': {
      const id = str(input.id, 80)
      if (input.type === 'note') {
        const n = getNote(db, id)
        return { result: n ? JSON.stringify({ title: n.title, text: extractText(n.content) }).slice(0, 12000) : 'Not found' }
      }
      if (input.type === 'ticket') {
        const t = getTicket(db, id)
        return { result: t ? JSON.stringify({ number: formatTicketNumber(t.number), customer: t.customerName, what: t.device, issue: t.issue, status: t.status, received: t.receivedOn, pickup: t.pickupOn, warrantyUntil: t.warrantyUntil, form: extractText(t.content) }).slice(0, 12000) : 'Not found' }
      }
      const c = getCustomer(db, id)
      return { result: c ? JSON.stringify(c).slice(0, 6000) : 'Not found' }
    }
    case 'money_summary': {
      const month = /^\d{4}-\d{2}$/.test(str(input.month)) ? str(input.month) : day().slice(0, 7)
      const s = money.summary(db, month)
      return {
        result: JSON.stringify({
          month,
          income: cents(s.incomeCents),
          expenses: cents(s.expenseCents),
          subscriptionsPerMonth: cents(s.subscriptionsMonthlyCents),
          upcomingBills: s.upcoming.map((b) => ({ date: b.date, name: b.name, amount: cents(b.amountCents), overdue: b.overdue })),
          owedByCustomers: s.unpaidTickets.map((u) => ({ customer: u.customerName, what: u.device, owing: cents(u.priceCents - u.paidCents) }))
        })
      }
    }
    case 'news': {
      const feed = newsFeed(db)
      const want = str(input.page).toLowerCase()
      const page = want ? (feed.pages.find((p) => p.name.toLowerCase().includes(want))?.id ?? (want.startsWith('loc') ? 'local' : null)) : null
      const items = feed.items.filter((i) => !i.filtered && (page === null || i.page === page))
      return { result: JSON.stringify(items.sort((a, b) => Number(b.important) - Number(a.important)).slice(0, 25).map((i) => ({ title: i.title, source: i.sourceName, important: i.important, when: i.when?.date, summary: i.summary.slice(0, 200) }))) }
    }
    case 'personal': {
      const ent = entFeed(db)
      return {
        result: JSON.stringify({
          habits: listHabits(db).map((h) => ({ name: h.name, doneToday: h.doneToday, streak: h.streak })),
          lists: listItems(db).filter((i) => !i.done).map((i) => `${i.list}: ${i.title}`),
          live: ent.live.filter((l) => l.live).map((l) => `${l.name}: ${l.title}`),
          newVideos: ent.videos.filter((v) => !v.watched).slice(0, 10).map((v) => `${v.channelName}: ${v.title}`)
        })
      }
    }
    case 'create_task': {
      const due = /^\d{4}-\d{2}-\d{2}$/.test(str(input.due_date)) ? str(input.due_date) : null
      const t = createTask(db, { title: str(input.title, 200), notes: str(input.notes, 4000), dueDate: due })
      return { result: `Task added (id ${t.id})`, action: `Added the task “${t.title}”${due ? ` due ${due}` : ''}` }
    }
    case 'create_event': {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : day()
      const time = (v: unknown): string | null => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : null)
      const e = createEvent(db, { title: str(input.title, 200), date, startTime: time(input.start_time), endTime: time(input.start_time) ? time(input.end_time) : null, notes: str(input.notes, 4000) })
      return { result: `Event added (id ${e.id})`, action: `Put “${e.title}” on the calendar for ${date}${e.startTime ? ` at ${e.startTime}` : ''}` }
    }
    case 'add_to_list': {
      const list = str(input.list, 60) || 'Shopping'
      const items = (Array.isArray(input.items) ? input.items : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 50)
      for (const it of items) addItem(db, list, it)
      return { result: `Added ${items.length} items`, action: `Added ${items.join(', ')} to ${list}` }
    }
    case 'create_note': {
      const n = createNote(db, { title: str(input.title, 200) })
      const content: DocJSON = { type: 'doc', content: str(input.text, 20000).split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p.trim() ? [{ type: 'text', text: p.trim() }] : [] })) }
      updateNote(db, n.id, { content })
      return { result: `Note created (id ${n.id})`, action: `Wrote the note “${str(input.title, 200)}”` }
    }
  }
  return { result: `Unknown tool ${name}` }
}

export function systemPrompt(db: Db, businessName: string): string {
  const customers = listCustomers(db, { limit: 1 }).length
  return [
    `You are the assistant inside Plannr, the user's all-in-one organizer${businessName ? ` (their business: ${businessName})` : ''}.`,
    `Today is ${new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${day()}).`,
    'Use the tools to look things up instead of guessing, and to make tasks, events, notes or list items when asked. Say briefly what you did.',
    'Answer in plain, friendly language, short and to the point. Use simple lists when helpful. Money is in their currency.',
    customers ? '' : 'They have no customers recorded yet.'
  ]
    .filter(Boolean)
    .join('\n')
}

/** Asks Claude, letting it use the tools (up to 8 rounds), and returns its answer plus what it changed */
export async function ask(db: Db, model: string, messages: AssistantMessage[], post: PostMessages, businessName = ''): Promise<{ reply: string; actions: string[] }> {
  const convo: { role: 'user' | 'assistant'; content: unknown }[] = messages.slice(-20).map((m) => ({ role: m.role, content: m.text }))
  const actions: string[] = []
  for (let round = 0; round < 8; round++) {
    const res = await post({ model, max_tokens: 2048, system: systemPrompt(db, businessName), tools: TOOLS, messages: convo })
    if (res.error) throw new Error(res.error.message ?? 'The assistant couldn’t answer')
    const content = res.content ?? []
    if (res.stop_reason !== 'tool_use') return { reply: content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text).join('\n').trim(), actions }
    convo.push({ role: 'assistant', content })
    const results = content
      .filter((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use')
      .map((c) => {
        let out: { result: string; action?: string }
        try {
          out = runTool(db, c.name, c.input ?? {})
        } catch (e) {
          out = { result: `Error: ${e instanceof Error ? e.message : String(e)}` }
        }
        if (out.action) actions.push(out.action)
        return { type: 'tool_result', tool_use_id: c.id, content: out.result.slice(0, 20000) }
      })
    convo.push({ role: 'user', content: results })
  }
  return { reply: 'That took too many steps. Try asking in a simpler way.', actions }
}
