import { ArrowLeft, ArrowRight, Download } from 'lucide-react'
import { go, useNav } from '../store/nav'
import { useUpdate } from '../store/update'
import { useUi } from '../store/ui'
import { SearchBox } from './SearchBox'
import { DrawerButton } from './MobileNav'

/** Shows in the title bar when a new version is ready (or downloading); opens Settings → General → Updates. */
function UpdatePill() {
  const status = useUpdate((s) => s.status)
  if (!status || !['available', 'downloading', 'installing'].includes(status.state)) return null
  const label =
    status.state === 'downloading' ? `Updating ${Math.round(status.progress * 100)}%` : status.state === 'installing' ? 'Restarting…' : `Update to ${status.latest}`
  return (
    <button
      type="button"
      className="update-pill"
      title="A new version of Plannr is available"
      onClick={() => {
        useUi.getState().setPref('settingsTab', 'general')
        go({ view: 'settings' })
      }}
    >
      <Download /> {label}
    </button>
  )
}

export function TitleBar() {
  const canBack = useNav((s) => s.past.length > 0)
  const canForward = useNav((s) => s.future.length > 0)
  const { back, forward } = useNav.getState()

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <DrawerButton />
        <span className="brand">
          <span className="brand-mark">P</span>
          Plannr
        </span>
        <div className="history">
          <button type="button" className="icon-btn" disabled={!canBack} onClick={back} title="Back (Alt+←)" aria-label="Back">
            <ArrowLeft />
          </button>
          <button type="button" className="icon-btn" disabled={!canForward} onClick={forward} title="Forward (Alt+→)" aria-label="Forward">
            <ArrowRight />
          </button>
        </div>
      </div>
      <SearchBox />
      <UpdatePill />
      <div className="titlebar-right" />
    </header>
  )
}
