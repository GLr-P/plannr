import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useNav } from '../store/nav'
import { SearchBox } from './SearchBox'

export function TitleBar() {
  const canBack = useNav((s) => s.past.length > 0)
  const canForward = useNav((s) => s.future.length > 0)
  const { back, forward } = useNav.getState()

  return (
    <header className="titlebar">
      <div className="titlebar-left">
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
      <div className="titlebar-right" />
    </header>
  )
}
