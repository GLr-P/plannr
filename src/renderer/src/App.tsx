import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { HomeView } from './views/HomeView'
import { NotesView } from './views/NotesView'
import { NoteView } from './views/NoteView'
import { SettingsView } from './views/SettingsView'
import { useData } from './store/data'
import { useNav } from './store/nav'
import { newNote } from './actions'

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { back, forward } = useNav.getState()
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void newNote()
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        forward()
      }
    }
    // Mouse side buttons
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) useNav.getState().back()
      if (e.button === 4) useNav.getState().forward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])
}

function MainView() {
  const route = useNav((s) => s.route)
  switch (route.view) {
    case 'home':
      return <HomeView />
    case 'notes':
      return <NotesView filter={route.filter} />
    case 'note':
      return <NoteView id={route.id} />
    case 'settings':
      return <SettingsView />
  }
}

export function App() {
  const loaded = useData((s) => s.loaded)
  useGlobalShortcuts()
  useEffect(() => {
    void useData.getState().refresh()
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <Sidebar />
      <main className="main">{loaded && <MainView />}</main>
    </div>
  )
}
