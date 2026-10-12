import { describe, expect, it, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, type Db } from '../../src/main/db'
import * as habits from '../../src/main/services/habits'
import * as lists from '../../src/main/services/lists'
import * as packages from '../../src/main/services/packages'
import * as weather from '../../src/main/services/weather'
import * as ent from '../../src/main/services/entertainment'
import * as assistant from '../../src/main/services/assistant'
import * as money from '../../src/main/services/money'
import { createTicket, getTicket, updateTicket } from '../../src/main/services/tickets'
import { dueOtherReminders } from '../../src/main/services/reminders'
import { configureNews } from '../../src/main/services/news'
import { parseInbox } from '../../src/main/services/zoho'
import { listTasks } from '../../src/main/services/tasks'

// Habits, lists, packages, weather, entertainment, the assistant's tools, warranties and free trials.
const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures/news', name), 'utf8')
const fakeFetch = async (url: string): Promise<string> => {
  if (url.includes('youtube.com/feeds')) return fixture('yt-feed.xml')
  if (url.includes('youtube.com')) return fixture('yt-channel.html')
  if (url.includes('twitch.tv/shroud')) return fixture('twitch-live.html')
  if (url.includes('twitch.tv')) return fixture('twitch-offline.html')
  if (url.includes('open-meteo')) return fixture('forecast.json')
  throw new Error(`offline: ${url}`)
}

let db: Db
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
})

describe('habits', () => {
  it('ticks, streaks over scheduled days only, and the week', () => {
    const gym = habits.createHabit(db, { name: 'Gym', days: [1, 3, 5] }, '2026-10-12') // Mon, Wed, Fri
    const water = habits.createHabit(db, { name: 'Water' }, '2026-10-12')
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-09']) habits.toggleHabit(db, gym.id, d, true) // last Mon, Wed, Fri
    let list = habits.listHabits(db, '2026-10-12')
    expect(list.find((h) => h.id === gym.id)).toMatchObject({ doneToday: false, streak: 3 }) // weekend days don't break it
    habits.toggleHabit(db, gym.id, '2026-10-12', true)
    habits.toggleHabit(db, water.id, '2026-10-11', true)
    list = habits.listHabits(db, '2026-10-12')
    expect(list.find((h) => h.id === gym.id)).toMatchObject({ doneToday: true, streak: 4 })
    expect(list.find((h) => h.id === water.id)).toMatchObject({ doneToday: false, streak: 1 })
    expect(list.find((h) => h.id === gym.id)!.week.map((d) => d.scheduled)).toEqual([false, true, false, true, false, false, true]) // Tue … Mon
    expect(list.find((h) => h.id === gym.id)).toMatchObject({ best: 4, rate30: expect.any(Number) })
    habits.toggleHabit(db, gym.id, '2026-10-12', false)
    expect(habits.listHabits(db, '2026-10-12').find((h) => h.id === gym.id)!.doneToday).toBe(false)
  })
})

describe('lists', () => {
  it('adds, ticks, clears ticked, renames', () => {
    const milk = lists.addItem(db, 'Shopping', 'Milk')
    lists.addItem(db, 'Shopping', 'Eggs')
    lists.addItem(db, 'Hardware', 'Screws')
    lists.updateItem(db, milk.id, { done: true })
    expect(lists.listItems(db).filter((i) => i.list === 'Shopping').map((i) => [i.title, i.done])).toEqual([
      ['Eggs', false],
      ['Milk', true]
    ])
    lists.clearDone(db, 'Shopping')
    lists.renameList(db, 'Hardware', 'Home Depot')
    expect(lists.listItems(db).map((i) => `${i.list}: ${i.title}`)).toEqual(['Home Depot: Screws', 'Shopping: Eggs'])
  })
})

describe('packages', () => {
  it('knows the carrier from the number', () => {
    expect(packages.detectCarrier('1Z999AA10123456784').carrierName).toBe('UPS')
    expect(packages.detectCarrier('7023 2108 5512 3456').carrierName).toBe('Canada Post')
    expect(packages.detectCarrier('LX123456789CA').carrierName).toBe('Canada Post')
    expect(packages.detectCarrier('TBA123456789000').carrierName).toBe('Amazon')
    expect(packages.detectCarrier('9400111202555842332000').carrierName).toBe('USPS')
    expect(packages.detectCarrier('hello').trackUrl).toContain('parcelsapp')
  })

  it('reads 17TRACK status and updates the package', async () => {
    const p = packages.addPackage(db, { number: '1Z999AA10123456784', label: 'RTX card' })
    const answer = {
      code: 0,
      data: {
        accepted: [
          {
            number: '1Z999AA10123456784',
            track_info: {
              latest_status: { status: 'OutForDelivery' },
              latest_event: { time_iso: '2026-10-12T08:10:00-07:00', description: 'Out for delivery', location: 'Osoyoos, BC' },
              time_metrics: { estimated_delivery_date: { from: '2026-10-12T00:00:00-07:00', to: '2026-10-12T23:59:00-07:00' } },
              tracking: { providers: [{ events: [{ time_iso: '2026-10-12T08:10:00-07:00', description: 'Out for delivery', location: 'Osoyoos, BC' }] }] }
            }
          }
        ]
      }
    }
    const calls: string[] = []
    await packages.refreshTracking(db, 'key', async (url, body, headers) => {
      calls.push(url)
      expect(headers['17token']).toBe('key')
      expect(body).toEqual([{ number: '1Z999AA10123456784' }])
      return url.endsWith('gettrackinfo') ? answer : { code: 0 }
    })
    expect(calls.map((u) => u.split('/').pop())).toEqual(['register', 'gettrackinfo'])
    const [after] = packages.listPackages(db)
    expect(after).toMatchObject({ id: p.id, status: 'out', expected: '2026-10-12', statusText: 'Out for delivery · Osoyoos, BC' })
    expect(after.events).toHaveLength(1)
    expect(packages.packagesExpected(db, '2026-10-01', '2026-10-31').map((x) => x.id)).toEqual([p.id])
  })
})

describe('weather and entertainment', () => {
  it('reads two weeks of forecast for your place', async () => {
    configureNews(db, { prefs: { place: { name: 'Osoyoos', region: 'British Columbia', country: 'Canada', countryCode: 'CA', lat: 49.03, lon: -119.45 } } })
    const f = await weather.forecast(db, fakeFetch)
    expect(f?.place).toBe('Osoyoos')
    expect(f?.days).toHaveLength(14)
    expect(f?.days[0]).toMatchObject({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), text: expect.any(String) })
    // Cached: no download the second time
    expect(await weather.forecast(db, async () => Promise.reject(new Error('no')))).toEqual(f)
  })

  it('adds YouTube channels and Twitch streamers; new videos and who is live', async () => {
    const yt = await ent.addChannel(db, 'https://www.youtube.com/@LinusTechTips', undefined, fakeFetch)
    expect(yt).toMatchObject({ kind: 'youtube', name: 'Linus Tech Tips', handle: 'UCXuqSBlHAE6Xw-yeJA0Tunw' })
    await expect(ent.addChannel(db, '@LinusTechTips', 'youtube', fakeFetch)).rejects.toThrow(/Already added/)
    await ent.addChannel(db, 'https://www.twitch.tv/shroud', undefined, fakeFetch)
    await ent.addChannel(db, 'xqc', 'twitch', fakeFetch)
    const { feed, wentLive } = await ent.refreshEntertainment(db, fakeFetch)
    expect(feed.errors).toEqual([])
    expect(feed.videos).toHaveLength(4)
    expect(feed.videos[0]).toMatchObject({ channelName: 'Linus Tech Tips', image: expect.stringMatching(/^https:\/\/i\d\.ytimg\.com\//), url: expect.stringMatching(/youtube\.com/) })
    expect(feed.live.map((l) => [l.name.toLowerCase(), l.live])).toEqual([
      ['shroud', true],
      ['xqc', false]
    ])
    expect(feed.live[0].title.length).toBeGreaterThan(0)
    // A rerun isn't live
    const rerun = fixture('twitch-live.html').replace(/"description":"[^"]*"/, '"description":"[RERUN] Yesterday’s stream"')
    expect(ent.parseTwitchPage(rerun, feed.channels.find((c) => c.handle === 'shroud')!).live).toBe(false)
    expect(ent.RERUN.test('Rebroadcast: finals')).toBe(true)
    expect(ent.RERUN.test('Running the Rerun gauntlet live!')).toBe(true)
    expect(ent.RERUN.test('Speedrunning Mario 64')).toBe(false)
    expect(wentLive.map((l) => l.name.toLowerCase())).toEqual(['shroud'])
    // Still live next time: no second notification
    expect((await ent.refreshEntertainment(db, fakeFetch)).wentLive).toEqual([])
  })

  it('reads a channel’s Videos page when its feed is broken', async () => {
    const now = Date.parse('2026-10-11T19:00:00-07:00')
    const videos = ent.parseChannelVideos(fixture('yt-videos-page.html'), now)
    expect(videos.map((v) => v.title)).toEqual([
      'NES Games, but if I die I go to the next game (VOD)',
      'Can Frank drive across GTA 5 with Chaos Mod (VOD)',
      'They’re on the Moon. Time to bring them “home”. (VOD)',
      'holy crap Louis he’s playing mario maker again (VOD)'
    ])
    expect(videos[0]).toMatchObject({ guid: expect.stringMatching(/^yt:video:[\w-]{11}$/), url: expect.stringMatching(/^https:\/\/www\.youtube\.com\/watch\?v=/), image: expect.stringMatching(/hqdefault\.jpg$/), publishedAt: now - 3 * 86_400_000 })
    const broken = async (url: string): Promise<string> => (url.includes('/feeds/') ? Promise.reject(new Error('HTTP 404')) : fixture('yt-videos-page.html'))
    expect((await ent.youtubeVideos('UCzL0SBEypNk4slpzSbxo01g', broken, now, async () => undefined)).length).toBe(4)
  })

  it('tries YouTube again when it answers 404', async () => {
    let n = 0
    const flaky = async (url: string): Promise<string> => (++n < 3 ? Promise.reject(new Error('HTTP 404')) : fakeFetch(url))
    expect(await ent.youtubeFeed('UCXuqSBlHAE6Xw-yeJA0Tunw', flaky, 4, async () => undefined)).toContain('<feed')
    expect(n).toBe(3)
  })
})

describe('warranty, free trials and the assistant', () => {
  it('a warranty end and a free trial end remind you', () => {
    const t = createTicket(db)
    updateTicket(db, t.id, { device: 'Laptop', warrantyUntil: '2026-12-01' })
    expect(getTicket(db, t.id)?.warrantyUntil).toBe('2026-12-01')
    const sub = money.createRecurring(db, 'subscription', '2026-10-01')
    money.updateRecurring(db, sub.id, { name: 'Game Pass', amountCents: 1999, trialEnds: '2026-10-20' }, '2026-10-01')
    money.updateRecurring(db, sub.id, { amountCents: 2299 }, '2026-10-05')
    expect(money.getRecurring(db, sub.id)).toMatchObject({ trialEnds: '2026-10-20', priceHistory: [{ date: '2026-10-05', cents: 1999 }] })
    const titles = (d: Date) => dueOtherReminders(db, d).map((r) => r.title)
    expect(titles(new Date(2026, 9, 17, 9, 30))).toEqual(['Game Pass: trial ends in 3 days'])
    expect(titles(new Date(2026, 11, 1, 8, 5))).toEqual(['Warranty ends today'])
  })

  it('the assistant uses tools and reports what it did', async () => {
    const posts: unknown[] = []
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'create_task', input: { title: 'Call Rosa about the screen', due_date: '2026-10-14' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done: I added the task.' }] }
    ]
    const out = await assistant.ask(db, 'claude-sonnet-5-5', [{ role: 'user', text: 'Remind me to call Rosa on Wednesday' }], async (body) => {
      posts.push(body)
      return replies.shift() as never
    })
    expect(out).toEqual({ reply: 'Done: I added the task.', actions: ['Added the task “Call Rosa about the screen” due 2026-10-14'] })
    expect(listTasks(db).map((t) => t.title)).toContain('Call Rosa about the screen')
    expect((posts[1] as { messages: { role: string }[] }).messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']) // the tool result went back
    expect(assistant.runTool(db, 'add_to_list', { list: 'Shopping', items: ['Milk', 'Eggs'] }).action).toBe('Added Milk, Eggs to Shopping')
    expect(JSON.parse(assistant.runTool(db, 'personal', {}).result).lists).toEqual(['Shopping: Milk', 'Shopping: Eggs'])
  })

  it('ChatGPT uses the same tools (OpenAI function calling)', async () => {
    const replies = [
      { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'add_to_list', arguments: '{"list":"Shopping","items":["Coffee"]}' } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { content: 'Added coffee to your shopping list.' } }] }
    ]
    const posts: { messages: { role: string }[]; tools: unknown[] }[] = []
    const out = await assistant.askOpenAI(db, 'gpt-5-mini', [{ role: 'user', text: 'add coffee to shopping' }], async (body) => {
      posts.push(body as never)
      return replies.shift() as never
    })
    expect(out).toEqual({ reply: 'Added coffee to your shopping list.', actions: ['Added Coffee to Shopping'] })
    expect(posts[0].messages[0].role).toBe('system')
    expect(posts[1].messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(posts[0].tools.length).toBeGreaterThan(5)
  })

  it('reads the mail inbox', () => {
    const inbox = parseInbox(
      [
        { messageId: '1', folderId: 'f', subject: 'Screen repair?', sender: 'Rosa <rosa@example.com>', receivedTime: '1760000000000', summary: 'Hi, can you fix…' },
        { messageId: '2', folderId: 'f', subject: 'Invoice', sender: 'Supplier', receivedTime: '1760100000000' }
      ] as never,
      'https://mail.zoho.com'
    )
    expect(inbox.map((m) => m.subject)).toEqual(['Invoice', 'Screen repair?'])
  })
})
