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

export function SettingsView() {
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

      <section className="setting">
        <div>
          <h3>Appearance</h3>
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

      <section className="setting">
        <div>
          <h3>Recent notes in the sidebar</h3>
          <p className="muted">Show your 5 most recently edited notes under the main menu. Home always shows them.</p>
        </div>
        <Switch label="Recent notes in the sidebar" checked={showRecent} onChange={(v) => setUiPref('sidebarRecent', v ? '1' : '0')} />
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

      <HolidaySettings />

      <h2 className="settings-group">Connected accounts</h2>
      <GoogleSettings />
      <ZohoSettings />
      <QuickBooksSettings />

      <h2 className="settings-group">Safety</h2>

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

      <p className="muted version">Plannr {info?.version}</p>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  )
}
