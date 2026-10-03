import { FileText, Pin, Plus } from 'lucide-react'
import { useData } from '../store/data'
import { go } from '../store/nav'
import { newNote } from '../actions'
import { greeting, noteTitle, relativeTime } from '../lib/format'

export function HomeView() {
  const notes = useData((s) => s.notes)
  const pinned = notes.filter((n) => n.pinned)
  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="page home">
      <header className="home-header">
        <div>
          <h1>{greeting()}</h1>
          <p className="muted">{today}</p>
        </div>
        <button type="button" className="btn primary" onClick={() => void newNote()}>
          <Plus /> New note
        </button>
      </header>

      {pinned.length > 0 && (
        <section>
          <h2 className="section-title">Pinned</h2>
          <div className="card-grid">
            {pinned.map((n) => (
              <button key={n.id} type="button" className="card" onClick={() => go({ view: 'note', id: n.id })}>
                <div className="card-title">
                  <Pin /> {noteTitle(n.title)}
                </div>
                <div className="card-preview">{n.preview || 'Empty note'}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Recent</h2>
        {recent.length === 0 ? (
          <div className="empty-state welcome">
            <p>Welcome to Plannr. Create your first note to get started.</p>
            <p className="muted">
              Tip: press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to search, and type <kbd>/</kbd> inside a note for headings, checklists,
              toggles and images.
            </p>
          </div>
        ) : (
          <ul className="simple-list">
            {recent.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => go({ view: 'note', id: n.id })}>
                  <FileText />
                  <span className="simple-title">{noteTitle(n.title)}</span>
                  <span className="simple-meta">{relativeTime(n.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
