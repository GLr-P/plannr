import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import {
  AtSign,
  CalendarDays,
  Check,
  Command,
  FileText,
  GripVertical,
  LayoutTemplate,
  Lock,
  Mail,
  Monitor,
  Moon,
  Package,
  CheckSquare,
  MousePointerClick,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  Slash,
  Sparkles,
  Sun,
  Users,
  Wallet,
  Wrench,
  Newspaper,
  Tv,
  ListChecks,
  Package2
} from 'lucide-react'
import { suggestPrefix, type AppInfo, type ThemePref } from '../../../shared/api'
import { planFor, USE_CASES } from '../../../shared/use-cases'
import { applyUseCases } from '../lib/applyUseCases'
import { ICONS } from '../lib/icons'
import { StatusEditor } from './StatusEditor'
import { HomeLayoutSettings, LookSettings, MoneyDisplaySettings, TimeZoneSetting, WeekStartSetting } from './CustomizeSettings'
import { CustomerPageSettings } from './MakeItYoursSettings'
import { HolidaySettings } from './HolidaySettings'
import { NotificationSettings } from './NotificationSettings'
import { BusinessSettings } from './BusinessSettings'
import { EntertainmentStep, NewsStep, NotesStep, PresetsStep, SectionsStep, TicketPageStep, VaultStep } from './SetupSteps'
import { api } from '../api'
import { useTheme } from '../theme'
import { useUi } from '../store/ui'
import { go } from '../store/nav'
import { saveDisplay, useDisplay } from '../store/display'

/**
 * The setup walkthrough: shown once on a fresh install, and again from Settings → General. A full setup (2026-11-14:
 * "by the time you finish the walkthrough, the entire app should be fit to your exact need"): what it's for, then a
 * step for every part you use, each changing the real settings as you go. Every step can be skipped.
 */
export const useOnboarding = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))

/** Opens the tour on first run (not in automated tests, and not for people who already have data). */
export async function maybeStartOnboarding(): Promise<void> {
  const [info, done] = await Promise.all([api.app.info(), api.settings.get('onboarded')])
  if (!info.tests && !done) useOnboarding.getState().set(true)
}

const FEATURES: { id: string; icon: ReactNode; title: string; text: string }[] = [
  { id: 'tasks', icon: <CheckSquare />, title: 'Tasks', text: 'To-dos with due dates and reminders, plus every checkbox in your notes.' },
  { id: 'tickets', icon: <Wrench />, title: 'Tickets', text: 'Anything you track from start to finish: projects, jobs, orders, assignments, bookings. Statuses, sections, printing.' },
  { id: 'customers', icon: <Users />, title: 'Customers', text: 'The people and companies you work with, and everything you’ve done for them.' },
  { id: 'calendar', icon: <CalendarDays />, title: 'Calendar', text: 'Appointments, due dates and reminders. Drag notes and tickets onto a day.' },
  { id: 'inventory', icon: <Package />, title: 'Inventory', text: 'What you keep in stock, its cost and price. Items used on tickets come off stock.' },
  { id: 'money', icon: <Wallet />, title: 'Money', text: 'Income, expenses, bills and subscriptions, and who still owes you.' },
  { id: 'vault', icon: <Lock />, title: 'Vault', text: 'Passwords, cards and documents, locked with your own passcode.' },
  { id: 'news', icon: <Newspaper />, title: 'News', text: 'Local news, events, closures and the weather where you live, plus pages for anything else.' },
  { id: 'entertainment', icon: <Tv />, title: 'Entertainment', text: 'YouTube, Twitch, Reddit and podcasts, plus your movies, shows, books and games.' },
  { id: 'lists', icon: <ListChecks />, title: 'Lists & habits', text: 'Shopping and other check-off lists, and daily habits with streaks.' },
  { id: 'packages', icon: <Package2 />, title: 'Packages', text: 'Tracking numbers in one place, on your calendar on the day they arrive.' },
  { id: 'mail', icon: <Mail />, title: 'Mail', text: 'Your Zoho Mail inbox; turn an email into a ticket or a task.' },
  { id: 'assistant', icon: <Sparkles />, title: 'Assistant', text: 'Ask about anything in Plannr, or have it add tasks, events and notes (your own Claude API key).' },
  { id: 'notes', icon: <FileText />, title: 'Notes', text: 'Notes with checklists, tables, toggles and photos, in folders and sections.' },
  { id: 'templates', icon: <LayoutTemplate />, title: 'Templates', text: 'Starting points for tickets and notes. Make your own anytime.' }
]

const TIPS: { icon: ReactNode; keys?: string; text: string }[] = [
  { icon: <Search />, keys: 'Ctrl+K', text: 'Search everything: notes, people, tickets, phone numbers.' },
  { icon: <Slash />, keys: '/', text: 'In a note or ticket: headings, checklists, tables, callouts, photos.' },
  { icon: <AtSign />, keys: '@', text: 'Link a note, person or ticket. The other side shows the link back.' },
  { icon: <MousePointerClick />, keys: 'Right-click', text: 'Rename, recolour or move notes and folders.' },
  { icon: <GripVertical />, keys: 'Drag', text: 'Reorder the sidebar, or drop things into folders and sections.' },
  { icon: <Printer />, text: 'Print slips, quotes, invoices and labels from any ticket.' },
  { icon: <Sparkles />, text: 'Customize (on tickets and customer pages) renames or removes anything right where it is.' },
  { icon: <Command />, keys: 'Ctrl+/', text: 'See every keyboard shortcut.' }
]

const Keys = ({ k }: { k: string }) => (
  <span className="keys">
    {k.split('+').map((part) => (
      <kbd key={part}>{part}</kbd>
    ))}
  </span>
)

export function Onboarding() {
  const { open, set } = useOnboarding()
  const [stepId, setStepId] = useState('welcome')
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixEdited, setPrefixEdited] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const hiddenPref = useUi((s) => s.prefs.navHidden)
  const setPref = useUi((s) => s.setPref)
  const hidden = (hiddenPref ?? '').split(',').filter(Boolean)
  const [uses, setUses] = useState<string[]>([])
  const navNames = useDisplay((s) => s.prefs.navNames)
  const { pref: theme, setPref: setTheme } = useTheme()
  const plan = planFor(uses)
  const biz = plan.business
  const many = navNames.tickets || 'Tickets'
  const one = many.toLowerCase().replace(/s$/, '')
  const people = navNames.customers || 'Customers'

  useEffect(() => {
    if (!open) return
    setStepId('welcome')
    void api.app.info().then(setInfo)
    void api.settings.get('useCases').then((u) => {
      const ids = Array.isArray(u) ? (u as string[]) : []
      setUses(ids)
      setFolders(planFor(ids).folders)
    })
    void Promise.all([api.business.get(), api.display.get()]).then(([b, d]) => {
      setName(b.name)
      setPrefix(d.ticketPrefix)
      setPrefixEdited(Boolean(b.name)) // already set up: keep the current prefix unless they change it
    })
  }, [open])
  if (!open) return null

  const on = (id: string): boolean => !hidden.includes(id)
  const pc = info !== null && !info.web
  const steps: { id: string; title: string }[] = [
    { id: 'welcome', title: 'Welcome' },
    { id: 'uses', title: 'What it’s for' },
    { id: 'about', title: biz ? 'Your business' : 'About you' },
    { id: 'menu', title: 'Menu' },
    { id: 'look', title: 'Look' },
    { id: 'home', title: 'Home page' },
    ...(on('tickets')
      ? [
          { id: 'tickets', title: many },
          { id: 'ticketpage', title: `The ${one} page` },
          { id: 'presets', title: 'Presets' },
          { id: 'sections', title: 'Sections' }
        ]
      : []),
    ...(on('customers') ? [{ id: 'customers', title: people }] : []),
    ...(on('notes') ? [{ id: 'notes', title: 'Notes' }] : []),
    ...(on('calendar') || on('tasks') ? [{ id: 'calendar', title: 'Calendar & reminders' }] : []),
    ...(on('money') || biz ? [{ id: 'money', title: biz ? 'Money & printouts' : 'Money' }] : []),
    ...(on('news') ? [{ id: 'news', title: 'News' }] : []),
    ...(on('entertainment') ? [{ id: 'entertainment', title: 'Entertainment' }] : []),
    ...(on('vault') ? [{ id: 'vault', title: 'Vault' }] : []),
    { id: 'connect', title: 'Sync & accounts' },
    { id: 'tips', title: 'Done' }
  ]
  const step = Math.max(0, steps.findIndex((s) => s.id === stepId))
  const current = steps[step].id
  const last = step === steps.length - 1

  const finish = async (then?: () => void): Promise<void> => {
    await api.settings.set('onboarded', true)
    set(false)
    then?.()
  }
  const leave = async (): Promise<void> => {
    if (current === 'uses') {
      await applyUseCases(uses)
      setFolders(planFor(uses).folders)
    }
    if (current === 'about' && biz) {
      await api.business.set({ name: name.trim() })
      await saveDisplay({ ticketPrefix: prefix || suggestPrefix(name) })
    }
    if (current === 'about' && !biz && on('tickets') && prefix) await saveDisplay({ ticketPrefix: prefix })
    if (current === 'notes' && folders.length) {
      const have = new Set((await api.folders.list()).map((f) => f.name))
      for (const f of folders) if (!have.has(f)) await api.folders.create(f)
    }
  }
  const goTo = async (i: number): Promise<void> => {
    await leave()
    setStepId(steps[Math.max(0, Math.min(steps.length - 1, i))].id)
  }
  const next = async (): Promise<void> => {
    if (last) {
      await leave()
      return finish(() => go({ view: 'home' }))
    }
    await goTo(step + 1)
  }
  const openSettings = (tab: string): void =>
    void finish(() => {
      useUi.getState().setPref('settingsTab', tab)
      go({ view: 'settings' })
    })

  const themes: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'system', label: 'System', icon: <Monitor /> },
    { value: 'light', label: 'Light', icon: <Sun /> },
    { value: 'dark', label: 'Dark', icon: <Moon /> }
  ]

  return (
    <div className="dialog-backdrop onboard-backdrop">
      <div className={`dialog onboard ${step > 0 ? 'wide' : ''}`} role="dialog" aria-label="Welcome to Plannr">
        <div className="onboard-main">
          {step > 0 && (
            <nav className="onboard-steps" aria-label="Setup steps">
              {steps.map((s, i) => (
                <button key={s.id} type="button" className={`${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => void goTo(i)}>
                  <span className="onboard-step-dot">{i < step ? <Check /> : i + 1}</span>
                  {s.title}
                </button>
              ))}
            </nav>
          )}
          <div className="onboard-body">
            {current === 'welcome' && (
              <div className="onboard-welcome">
                <div className="onboard-logo">P</div>
                <h2>Welcome to Plannr</h2>
                <p>One place for everything you keep track of: tasks, your calendar, notes, projects and jobs, the people you work with, money, and a locked vault. Everything stays on this computer.</p>
                <p className="muted">Next, Plannr asks what you’ll use it for and walks you through setting up every part to fit, step by step. Skip any step; everything can be changed later.</p>
              </div>
            )}

            {current === 'uses' && (
              <>
                <h2>What will you use Plannr for?</h2>
                <p className="muted">Pick everything that fits. Plannr sets itself up for it: the menu, what things are called, statuses, presets and more. You’ll see and change all of it in the next steps.</p>
                <div className="onboard-features">
                  {USE_CASES.map((u) => {
                    const sel = uses.includes(u.id)
                    const Icon = ICONS[u.icon] ?? Sparkles
                    return (
                      <button key={u.id} type="button" role="checkbox" aria-checked={sel} aria-label={u.title} className={`feature-card ${sel ? 'on' : ''}`} onClick={() => setUses(sel ? uses.filter((x) => x !== u.id) : [...uses, u.id])}>
                        <span className="feature-icon">
                          <Icon />
                        </span>
                        <span className="feature-text">
                          <strong>{u.title}</strong>
                          <span>{u.blurb}</span>
                        </span>
                        <span className="feature-check" aria-hidden />
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {current === 'about' && (
              <>
                <h2>{biz ? 'Your business' : 'About you'}</h2>
                {biz && <p className="muted">Your business or your own name. It goes on printed slips, quotes and invoices, and sets your {one} numbers. Leave it blank if you like.</p>}
                <div className="onboard-fields">
                  {biz && (
                    <label className="mfield">
                      Name
                      <input
                        autoFocus
                        value={name}
                        placeholder="e.g. Acme Studio"
                        aria-label="Business name"
                        onChange={(e) => {
                          setName(e.target.value)
                          if (!prefixEdited) setPrefix(suggestPrefix(e.target.value))
                        }}
                      />
                    </label>
                  )}
                  {on('tickets') && (
                    <label className="mfield">
                      {many} numbers start with
                      <input
                        value={prefix}
                        maxLength={8}
                        aria-label="Ticket number prefix"
                        onChange={(e) => {
                          setPrefix(e.target.value)
                          setPrefixEdited(true)
                        }}
                      />
                      <span className="small muted">
                        Your {many.toLowerCase()} will look like {(prefix || 'T-').replace(/\s+/g, '')}0001
                      </span>
                    </label>
                  )}
                </div>
                <div className="onboard-settings">
                  {pc && <TimeZoneSetting />}
                  <WeekStartSetting />
                </div>
              </>
            )}

            {current === 'menu' && (
              <>
                <h2>Your menu</h2>
                <p className="muted">Set for what you picked. Untick anything you don’t need; it leaves the menu, and its setup steps go too. Turn it back on in Settings → Layout.</p>
                <div className="onboard-features">
                  {FEATURES.map((f) => {
                    const shown = on(f.id)
                    return (
                      <button key={f.id} type="button" role="checkbox" aria-checked={shown} aria-label={f.title} className={`feature-card ${shown ? 'on' : ''}`} onClick={() => setPref('navHidden', (shown ? [...hidden, f.id] : hidden.filter((h) => h !== f.id)).join(','))}>
                        <span className="feature-icon">{f.icon}</span>
                        <span className="feature-text">
                          <strong>{f.id === 'tickets' ? many : f.id === 'customers' ? people : f.title}</strong>
                          <span>{f.text}</span>
                        </span>
                        <span className="feature-check" aria-hidden />
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {current === 'look' && (
              <>
                <h2>How it looks</h2>
                <div className="onboard-settings">
                  <section className="setting">
                    <div>
                      <h3>Light or dark</h3>
                      <p className="muted">Follow Windows, or always use one.</p>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Theme">
                      {themes.map((o) => (
                        <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} className={theme === o.value ? 'active' : ''} onClick={() => setTheme(o.value)}>
                          {o.icon} {o.label}
                        </button>
                      ))}
                    </div>
                  </section>
                  <LookSettings />
                </div>
              </>
            )}

            {current === 'home' && (
              <>
                <h2>Your Home page</h2>
                <p className="muted">Home is the first thing you see: what’s due, what’s coming up, recent notes. Choose what it shows and in what order.</p>
                <div className="onboard-settings">
                  <HomeLayoutSettings />
                </div>
              </>
            )}

            {current === 'tickets' && (
              <>
                <h2>{many}</h2>
                <p className="muted">
                  {many} are the things you track from start to finish. Call them what you call them (Tickets, Orders, Jobs, Projects, Assignments…), and set the statuses they move through.
                </p>
                <div className="onboard-fields two">
                  <label className="mfield">
                    They’re called
                    <NameField value={many} label="What tickets are called" onSave={(v) => void saveDisplay({ navNames: { ...navNames, tickets: v === 'Tickets' ? '' : v } })} />
                  </label>
                  {on('customers') && (
                    <label className="mfield">
                      The people you do them for
                      <NameField value={people} label="What customers are called" onSave={(v) => void saveDisplay({ navNames: { ...navNames, customers: v === 'Customers' ? '' : v } })} />
                    </label>
                  )}
                </div>
                <h3 className="onboard-sub">Statuses</h3>
                <p className="small muted">The first one is where new {many.toLowerCase()} start. “Finished” ones close it; “ready” ones are waiting on someone.</p>
                <StatusEditor />
              </>
            )}

            {current === 'ticketpage' && <TicketPageStep one={one} />}
            {current === 'presets' && <PresetsStep plan={plan} many={many} />}
            {current === 'sections' && <SectionsStep one={one} />}

            {current === 'customers' && (
              <>
                <h2>{people}</h2>
                <p className="muted">Each one gets a page with their details, everything you’ve done for them, and notes. Add your own fields and choose what the page shows.</p>
                <label className="mfield onboard-fields">
                  They’re called
                  <NameField value={people} label="What customers are called" onSave={(v) => void saveDisplay({ navNames: { ...navNames, customers: v === 'Customers' ? '' : v } })} />
                </label>
                <div className="onboard-settings">
                  <CustomerPageSettings />
                </div>
              </>
            )}

            {current === 'notes' && <NotesStep plan={plan} folders={folders} setFolders={setFolders} />}

            {current === 'calendar' && (
              <>
                <h2>Calendar & reminders</h2>
                <p className="muted">Due dates, appointments and reminders all land on the calendar.</p>
                <div className="onboard-settings">
                  <WeekStartSetting />
                  {info && <NotificationSettings pc={pc} />}
                  <HolidaySettings />
                </div>
              </>
            )}

            {current === 'money' && (
              <>
                <h2>{biz ? 'Money & printouts' : 'Money'}</h2>
                <p className="muted">{biz ? 'Your currency, how people pay you, and the details printed on slips, quotes and invoices.' : 'Your currency and how you pay for things.'}</p>
                <div className="onboard-settings">
                  <MoneyDisplaySettings />
                  {biz && <BusinessSettings />}
                </div>
              </>
            )}

            {current === 'news' && <NewsStep />}
            {current === 'entertainment' && <EntertainmentStep />}
            {current === 'vault' && <VaultStep />}

            {current === 'connect' && (
              <>
                <h2>Sync & accounts (optional)</h2>
                <p className="muted">Plannr works fine on its own. These can be set up now or anytime in Settings.</p>
                <div className="onboard-connect">
                  <button type="button" className="connect-card" onClick={() => openSettings('sync')}>
                    <span className="feature-icon">
                      <RefreshCw />
                    </span>
                    <span className="feature-text">
                      <strong>Your other devices</strong>
                      <span>Sync with your other PCs and your phone, end-to-end encrypted. Your settings, keys and connections follow you.</span>
                    </span>
                  </button>
                  <button type="button" className="connect-card" onClick={() => openSettings('accounts')}>
                    <span className="feature-icon">
                      <Receipt />
                    </span>
                    <span className="feature-text">
                      <strong>Google Calendar, Zoho Mail, QuickBooks</strong>
                      <span>Your events on your phone, emails on {people.toLowerCase()} pages, payments in your books. Each has step-by-step instructions.</span>
                    </span>
                  </button>
                  {on('assistant') && (
                    <button type="button" className="connect-card" onClick={() => void finish(() => go({ view: 'assistant' }))}>
                      <span className="feature-icon">
                        <Sparkles />
                      </span>
                      <span className="feature-text">
                        <strong>Assistant</strong>
                        <span>Add your own Claude API key on the Assistant page to ask questions and have it add things for you.</span>
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}

            {current === 'tips' && (
              <>
                <h2>You’re all set</h2>
                <p className="muted">A few things worth knowing:</p>
                <ul className="onboard-tips">
                  {TIPS.map((t) => (
                    <li key={t.text}>
                      <span className="tip-icon">{t.icon}</span>
                      <span>{t.text}</span>
                      {t.keys && <Keys k={t.keys} />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="onboard-foot">
          <span className="small muted" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {step > 0 ? `Step ${step + 1} of ${steps.length}` : ''}
          </span>
          <div className="onboard-actions">
            {step === 0 ? (
              <button type="button" className="btn" onClick={() => void finish()}>
                Skip
              </button>
            ) : (
              <>
                {!last && (
                  <button type="button" className="btn ghost" onClick={() => void leave().then(() => finish(() => go({ view: 'home' })))}>
                    Finish later
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void goTo(step - 1)}>
                  Back
                </button>
              </>
            )}
            <button type="button" className="btn primary" onClick={() => void next()}>
              {step === 0 ? 'Get started' : last ? 'Start using Plannr' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A name that saves when you leave the box */
function NameField({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text.trim() !== value && onSave(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
