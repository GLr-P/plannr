import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { checkForUpdates, installUpdate, useUpdate } from '../store/update'
import { relativeTime } from '../lib/format'

/** Settings → General: check for a new version, install it, and the automatic-check switch. */
export function UpdateSettings() {
  const status = useUpdate((s) => s.status)
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    void api.settings.get('autoUpdateCheck').then((v) => setAuto(v !== false))
  }, [])
  if (!status) return null

  let text: React.ReactNode
  switch (status.state) {
    case 'checking':
      text = 'Checking for updates…'
      break
    case 'up-to-date':
      text = <>You have the latest version{status.checkedAt ? ` (checked ${relativeTime(status.checkedAt).toLowerCase()})` : ''}.</>
      break
    case 'available':
      text = <>Version {status.latest} is available.</>
      break
    case 'downloading':
      text = `Downloading version ${status.latest}… ${Math.round(status.progress * 100)}%`
      break
    case 'installing':
      text = 'Installing… Plannr will close and open again by itself in a few seconds.'
      break
    case 'error':
      text = <span className="error-text">{status.error}</span>
      break
    default:
      text = 'Plannr checks for new versions on GitHub.'
  }

  return (
    <section className="setting update-setting">
      <div className="integration-main">
        <h3>Updates</h3>
        <p className="muted">
          Plannr {status.current}. {text}
        </p>
        {status.state === 'downloading' && (
          <div className="update-progress" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
          </div>
        )}
        {!status.canInstall && (status.state === 'available' || status.state === 'error') && (
          <p className="small muted">This copy runs from the source code, so it can’t update itself. Download the installer instead.</p>
        )}
        <label className="check-row update-auto">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked)
              void api.settings.set('autoUpdateCheck', e.target.checked)
            }}
          />
          Check automatically (every few hours)
        </label>
      </div>
      <div className="setting-controls">
        {(status.state === 'available' || (status.state === 'error' && status.latest && status.latest !== status.current)) && status.canInstall ? (
          <button type="button" className="btn primary" onClick={() => void installUpdate()}>
            <Download /> Install and restart
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={status.state === 'checking' || status.state === 'downloading' || status.state === 'installing'}
            onClick={() => void checkForUpdates()}
          >
            <RefreshCw /> Check for updates
          </button>
        )}
        {status.notesUrl && status.latest && (
          <a className="link-btn small" href={status.notesUrl} target="_blank" rel="noreferrer">
            What’s new in {status.latest} <ExternalLink className="inline-icon" />
          </a>
        )}
      </div>
    </section>
  )
}
