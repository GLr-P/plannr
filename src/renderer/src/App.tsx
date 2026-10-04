import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { HomeView } from './views/HomeView'
import { NotesView } from './views/NotesView'
import { NoteView } from './views/NoteView'
import { SettingsView } from './views/SettingsView'
import { TicketsView } from './views/TicketsView'
import { TicketView } from './views/TicketView'
import { CustomersView } from './views/CustomersView'
import { CustomerView } from './views/CustomerView'
import { TemplatesView, TemplateView } from './views/TemplatesView'
import { CalendarView } from './views/CalendarView'
import { useData } from './store/data'
import { useNav } from './store/nav'
import { newNote, openEntity } from './actions'

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
    case 'tickets':
      return <TicketsView />
    case 'ticket':
      return <TicketView id={route.id} />
    case 'customers':
      return <CustomersView />
    case 'customer':
      return <CustomerView id={route.id} />
    case 'templates':
      return <TemplatesView />
    case 'template':
      return <TemplateView id={route.id} />
    case 'calendar':
      return <CalendarView date={route.date} eventId={route.eventId} />
    case 'settings':
      return <SettingsView />
  }
}

export function App() {
  const loaded = useData((s) => s.loaded)
  useGlobalShortcuts()
  useEffect(() => {
    void useData.getState().refresh()
    // A clicked reminder notification asks to show its ticket/customer/note (or calendar day).
    return window.plannrEvents.onNavigate((target) => {
      if ('calendarDate' in target) useNav.getState().go({ view: 'calendar', date: target.calendarDate })
      else openEntity(target.type, target.id)
    })
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <Sidebar />
      <main className="main">{loaded && <MainView />}</main>
    </div>
  )
}
