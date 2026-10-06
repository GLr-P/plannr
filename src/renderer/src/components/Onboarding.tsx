import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import {
  AtSign,
  CalendarDays,
  Command,
  FileText,
  GripVertical,
  LayoutTemplate,
  Lock,
  Mail,
  Package,
  MousePointerClick,
  Printer,
  Receipt,
  Search,
  Slash,
  Sparkles,
  Users,
  Wallet,
  Wrench
} from 'lucide-react'
import { suggestPrefix } from '../../../shared/api'
import { api } from '../api'
import { useUi } from '../store/ui'
import { go } from '../store/nav'
import { saveDisplay, useDisplay } from '../store/display'

/** The welcome tour: shown once on a fresh install, and again from Settings → General. */
export const useOnboarding = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))

/** Opens the tour on first run (not in automated tests, and not for people who already have data). */
export async function maybeStartOnboarding(): Promise<void> {
  const [info, done] = await Promise.all([api.app.info(), api.settings.get('onboarded')])
  if (!info.tests && !done) useOnboarding.getState().set(true)
}

const FEATURES: { id: string; icon: ReactNode; title: string; text: string }[] = [
  { id: 'tickets', icon: <Wrench />, title: 'Tickets', text: 'Jobs, repairs, orders or requests from start to finish: status, photos, fill-in forms, printing.' },
  { id: 'customers', icon: <Users />, title: 'Customers', text: 'The people and companies you work with, and everything you’ve done for them.' },
  { id: 'calendar', icon: <CalendarDays />, title: 'Calendar', text: 'Appointments, due dates and reminders. Drag notes and tickets onto a day.' },
  { id: 'inventory', icon: <Package />, title: 'Inventory', text: 'Parts in stock, their cost and price. Parts used on tickets come off stock.' },
  { id: 'money', icon: <Wallet />, title: 'Money', text: 'Income, expenses, bills and subscriptions, and who still owes you.' },
  { id: 'vault', icon: <Lock />, title: 'Vault', text: 'Passwords, cards and documents, locked with your own passcode.' },
  { id: 'notes', icon: <FileText />, title: 'Notes', text: 'Notes with checklists, tables, toggles and photos, in folders and sections.' },
  { id: 'templates', icon: <LayoutTemplate />, title: 'Templates', text: 'Starting points for tickets and notes. Make your own anytime.' }
]

const CONNECTIONS: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <CalendarDays />, title: 'Google Calendar', text: 'Your Plannr events on your phone, and your Google calendars inside Plannr.' },
  { icon: <Mail />, title: 'Zoho Mail', text: 'Every email with a customer, right on their page.' },
  { icon: <Receipt />, title: 'QuickBooks Online', text: 'Customers, payments and expenses go to your books automatically.' }
]

const TIPS: { icon: ReactNode; keys?: string; text: string }[] = [
  { icon: <Search />, keys: 'Ctrl+K', text: 'Search everything: notes, customers, tickets, phone numbers.' },
  { icon: <Slash />, keys: '/', text: 'In a note or ticket: headings, checklists, tables, callouts, photos.' },
  { icon: <AtSign />, keys: '@', text: 'Link a note, customer or ticket. The other side shows the link back.' },
  { icon: <MousePointerClick />, keys: 'Right-click', text: 'Rename, recolour or move notes and folders.' },
  { icon: <GripVertical />, keys: 'Drag', text: 'Reorder the sidebar, or drop things into folders and sections.' },
  { icon: <Printer />, text: 'Print intake slips, receipts and device labels from any ticket.' },
  { icon: <Command />, keys: 'Ctrl+/', text: 'See every keyboard shortcut.' },
  { icon: <Sparkles />, text: 'Settings lets you change colours, the menu, Home, ticket numbers and more.' }
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
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixEdited, setPrefixEdited] = useState(false)
  const currency = useDisplay((s) => s.prefs.currency)
  const hiddenPref = useUi((s) => s.prefs.navHidden)
  const setPref = useUi((s) => s.setPref)
  const hidden = (hiddenPref ?? '').split(',').filter(Boolean)

  useEffect(() => {
    if (!open) return
    setStep(0)
    void Promise.all([api.business.get(), api.display.get()]).then(([b, d]) => {
      setName(b.name)
      setPrefix(d.ticketPrefix)
      setPrefixEdited(Boolean(b.name)) // already set up: keep the current prefix unless they change it
    })
  }, [open])
  if (!open) return null

  const finish = async (then?: () => void): Promise<void> => {
    await api.settings.set('onboarded', true)
    set(false)
    then?.()
  }
  const saveBusiness = async (): Promise<void> => {
    await api.business.set({ name: name.trim() })
    await saveDisplay({ ticketPrefix: prefix || suggestPrefix(name), currency })
  }
  const steps = ['welcome', 'business', 'features', 'connect', 'tips'] as const
  const last = step === steps.length - 1
  const next = async (): Promise<void> => {
    if (steps[step] === 'business') await saveBusiness()
    if (last) return finish(() => go({ view: 'home' }))
    setStep(step + 1)
  }

  return (
    <div className="dialog-backdrop onboard-backdrop">
      <div className="dialog onboard" role="dialog" aria-label="Welcome to Plannr">
        <div className="onboard-body">
          {steps[step] === 'welcome' && (
            <div className="onboard-welcome">
              <div className="onboard-logo">P</div>
              <h2>Welcome to Plannr</h2>
              <p>
                One place for everything you keep track of: notes, your calendar, customers and tickets, money, and a locked vault. Everything stays on
                this computer.
              </p>
              <p className="muted">This takes about a minute. You can change everything later in Settings.</p>
            </div>
          )}

          {steps[step] === 'business' && (
            <>
              <h2>About you</h2>
              <p className="muted">Your business or your own name. It goes on printed slips and receipts, and sets your ticket numbers. Leave it blank if you like.</p>
              <div className="onboard-fields">
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
                <label className="mfield">
                  Ticket numbers start with
                  <input
                    value={prefix}
                    maxLength={8}
                    aria-label="Ticket number prefix"
                    onChange={(e) => {
                      setPrefix(e.target.value)
                      setPrefixEdited(true)
                    }}
                  />
                  <span className="small muted">Your tickets will look like {(prefix || 'T-').replace(/\s+/g, '')}0001</span>
                </label>
                <label className="mfield">
                  Currency
                  <select value={currency} aria-label="Currency" onChange={(e) => void saveDisplay({ currency: e.target.value })}>
                    {['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'INR', 'JPY', 'CHF'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}

          {steps[step] === 'features' && (
            <>
              <h2>What do you want to use?</h2>
              <p className="muted">Untick anything you don’t need; it leaves the menu. You can turn it back on in Settings → Layout.</p>
              <div className="onboard-features">
                {FEATURES.map((f) => {
                  const on = !hidden.includes(f.id)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={f.title}
                      className={`feature-card ${on ? 'on' : ''}`}
                      onClick={() => setPref('navHidden', (on ? [...hidden, f.id] : hidden.filter((h) => h !== f.id)).join(','))}
                    >
                      <span className="feature-icon">{f.icon}</span>
                      <span className="feature-text">
                        <strong>{f.title}</strong>
                        <span>{f.text}</span>
                      </span>
                      <span className="feature-check" aria-hidden />
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {steps[step] === 'connect' && (
            <>
              <h2>Connect your accounts (optional)</h2>
              <p className="muted">
                Plannr works fine on its own. If you use these services, you can link them in Settings → Connected accounts. Each has step-by-step
                instructions.
              </p>
              <div className="onboard-connect">
                {CONNECTIONS.map((c) => (
                  <div key={c.title} className="connect-card">
                    <span className="feature-icon">{c.icon}</span>
                    <span className="feature-text">
                      <strong>{c.title}</strong>
                      <span>{c.text}</span>
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  void finish(() => {
                    useUi.getState().setPref('settingsTab', 'accounts')
                    go({ view: 'settings' })
                  })
                }
              >
                Set one up now →
              </button>
            </>
          )}

          {steps[step] === 'tips' && (
            <>
              <h2>A few things worth knowing</h2>
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

        <div className="onboard-foot">
          <div className="onboard-dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <span key={s} className={i === step ? 'on' : ''} />
            ))}
          </div>
          <div className="onboard-actions">
            {step === 0 ? (
              <button type="button" className="btn" onClick={() => void finish()}>
                Skip
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
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
