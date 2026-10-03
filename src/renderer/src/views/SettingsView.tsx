import { useEffect, useState } from 'react'
import { FolderOpen, Monitor, Moon, Sun } from 'lucide-react'
import type { AppInfo, ThemePref } from '../../../shared/api'
import { api } from '../api'
import { useTheme } from '../theme'

export function SettingsView() {
  const { pref, setPref } = useTheme()
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void api.app.info().then(setInfo)
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
