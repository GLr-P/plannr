import { useEffect, useState } from 'react'
import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react'
import type { AppInfo, ThemePref } from '../../../shared/api'
import { api } from '../api'
import { useTheme } from '../theme'
import { useUi } from '../store/ui'
import { HolidaySettings } from '../components/HolidaySettings'
import { BackupSettings } from '../components/BackupSettings'
import { GoogleSettings } from '../components/GoogleSettings'
import { ZohoSettings } from '../components/ZohoSettings'
import { QuickBooksSettings } from '../components/QuickBooksSettings'
import { BusinessSettings } from '../components/BusinessSettings'
import { HomeLayoutSettings, LookSettings, MenuSettings, MoneyDisplaySettings, TicketSettings, WeekStartSetting } from '../components/CustomizeSettings'
import { useShortcutsOpen } from '../components/Shortcuts'
import { useOnboarding } from '../components/Onboarding'
import { UpdateSettings } from '../components/UpdateSettings'
import { Keyboard, Sparkles } from 'lucide-react'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'layout', label: 'Layout' },
  { id: 'business', label: 'Business' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'accounts', label: 'Connected accounts' },
  { id: 'data', label: 'Backups & data' }
] as const
type Tab = (typeof TABS)[number]['id']

export function SettingsView() {
  const tab = (useUi((s) => s.prefs.settingsTab) as Tab | undefined) ?? 'general'
  const { pref, setPref } = useTheme()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [background, setBackground] = useState(true)
  const [atLogin, setAtLogin] = useState(false)
  const showRecent = useUi((s) => s.prefs.sidebarRecent === '1')
  const setUiPref = useUi((s) => s.setPref)
  useEffect(() => {
    void api.app.info().then(setInfo)
    void api.settings.get('runInBackground').then((v) => setBackground(v !== false))
    void api.app.getOpenAtLogin().then(setAtLogin)
  }, [])

  const options: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
    { value: 'system', label: 'System', icon: <Monitor /> },
    { value: 'light', label: 'Light', icon: <Sun /> },
    { value: 'dark', label: 'Dark', icon: <Moon /> }
  ]

  return (
    <div className="page settings">
      <h1>Settings</h1>
      <div className="segmented settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setUiPref('settingsTab', t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <section className="setting">
            <div>
              <h3>Theme</h3>
              <p className="muted">Follow Windows, or always use light or dark.</p>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={pref === o.value}
                  className={pref === o.value ? 'active' : ''}
                  onClick={() => setPref(o.value)}
                >
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          </section>

          <LookSettings />

          <UpdateSettings />

          <section className="setting">
            <div>
              <h3>Welcome tour</h3>
              <p className="muted">The quick introduction from the first time you opened Plannr.</p>
            </div>
            <button type="button" className="btn" onClick={() => useOnboarding.getState().set(true)}>
              <Sparkles /> Show the tour
            </button>
          </section>

          <section className="setting">
            <div>
              <h3>Keyboard shortcuts</h3>
              <p className="muted">
                Press <kbd>Ctrl</kbd> + <kbd>/</kbd> anywhere to see them.
              </p>
            </div>
            <button type="button" className="btn" onClick={() => useShortcutsOpen.getState().set(true)}>
              <Keyboard /> Show shortcuts
            </button>
          </section>

          <section className="setting">
            <div>
              <h3>Keep running in the tray</h3>
              <p className="muted">Closing the window keeps Plannr in the system tray so calendar reminders still pop up.</p>
            </div>
            <Switch
              label="Keep running in the tray"
              checked={background}
              onChange={(v) => {
                setBackground(v)
                void api.settings.set('runInBackground', v)
              }}
            />
          </section>

          <section className="setting">
            <div>
              <h3>Start with Windows</h3>
              <p className="muted">Opens Plannr quietly in the tray when you sign in, so reminders work even if you forget to open it.</p>
            </div>
            <Switch
              label="Start with Windows"
              checked={atLogin}
              onChange={(v) => {
                setAtLogin(v)
                void api.app.setOpenAtLogin(v)
              }}
            />
          </section>

          <WeekStartSetting />
          <HolidaySettings />
        </>
      )}

      {tab === 'layout' && (
        <>
          <MenuSettings />
          <HomeLayoutSettings />
          <section className="setting">
            <div>
              <h3>Recent notes in the sidebar</h3>
              <p className="muted">Show your 5 most recently edited notes under the main menu. Home always shows them.</p>
            </div>
            <Switch label="Recent notes in the sidebar" checked={showRecent} onChange={(v) => setUiPref('sidebarRecent', v ? '1' : '0')} />
          </section>
        </>
      )}

      {tab === 'business' && (
        <>
          <BusinessSettings />
          <MoneyDisplaySettings />
        </>
      )}

      {tab === 'tickets' && <TicketSettings />}

      {tab === 'accounts' && (
        <>
          <GoogleSettings />
          <ZohoSettings />
          <QuickBooksSettings />
        </>
      )}

      {tab === 'data' && (
        <>
          <BackupSettings />

          <section className="setting">
            <div>
              <h3>Your data</h3>
              <p className="muted">Everything is stored on this computer in:</p>
              <code className="path">{info?.dataDir}</code>
            </div>
            <button type="button" className="btn" onClick={() => void api.app.openDataFolder()}>
              <FolderOpen /> Open folder
            </button>
          </section>
        </>
      )}

      <p className="muted version">Plannr {info?.version}</p>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}
