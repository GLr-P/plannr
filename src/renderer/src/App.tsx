import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ContextMenuHost } from './components/ContextMenu'
import { ToastHost } from './lib/toast'
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
import { VaultView } from './views/VaultView'
import { MoneyView } from './views/MoneyView'
import { InventoryView } from './views/InventoryView'
import { useData } from './store/data'
import { useNav } from './store/nav'
import { newNote, newTicket, openEntity } from './actions'
import { ShortcutsDialog, useShortcutsOpen } from './components/Shortcuts'
import { NAV_ROUTES, visibleNav } from './lib/navOrder'
import { useUi } from './store/ui'
import { loadDisplay, useDisplay } from './store/display'
import { useAppearance } from './lib/appearance'
import { maybeStartOnboarding, Onboarding } from './components/Onboarding'
import { initUpdates } from './store/update'
import { MessageDialog } from './components/MessageDialog'

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { back, forward } = useNav.getState()
      const key = e.key.toLowerCase()
      const plainCtrl = e.ctrlKey && !e.shiftKey && !e.altKey
      if (plainCtrl && key === 'n') {
        e.preventDefault()
        void newNote()
      } else if (plainCtrl && key === 't') {
        e.preventDefault()
        void newTicket()
      } else if (plainCtrl && key === ',') {
        e.preventDefault()
        useNav.getState().go({ view: 'settings' })
      } else if (plainCtrl && key === '/') {
        e.preventDefault()
        useShortcutsOpen.getState().set(!useShortcutsOpen.getState().open)
      } else if (plainCtrl && /^[1-9]$/.test(key)) {
        const { prefs } = useUi.getState()
        const id = visibleNav(prefs.navOrder, prefs.navHidden)[Number(key) - 1]
        if (id) {
          e.preventDefault()
          useNav.getState().go(NAV_ROUTES[id])
        }
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
    case 'vault':
      return <VaultView />
    case 'money':
      return <MoneyView itemId={route.itemId} />
    case 'inventory':
      return <InventoryView />
    case 'settings':
      return <SettingsView />
  }
}

export function App() {
  const loaded = useData((s) => s.loaded)
  const displayVersion = useDisplay((s) => s.version) // re-render pages when ticket prefix/currency/status names change
  const view = useNav((s) => s.route.view)
  useGlobalShortcuts()
  useAppearance()
  useEffect(() => {
    const stopUpdates = initUpdates()
    void loadDisplay()
      .then(() => useData.getState().refresh())
      .then(() => maybeStartOnboarding())
    // A clicked reminder notification asks to show its ticket/customer/note (or calendar day).
    const stopNavigate = window.plannrEvents.onNavigate((target) => {
      if ('calendarDate' in target) useNav.getState().go({ view: 'calendar', date: target.calendarDate })
      else if ('money' in target) useNav.getState().go({ view: 'money', itemId: target.money })
      else openEntity(target.type, target.id)
    })
    return () => {
      stopNavigate()
      stopUpdates()
    }
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <Sidebar />
      {/* Settings isn't redrawn while you edit it; every other page picks up new names/prefix/currency right away. */}
      <main className="main">{loaded && <MainView key={view === 'settings' ? 'settings' : displayVersion} />}</main>
      <ContextMenuHost />
      <ToastHost />
      <ShortcutsDialog />
      <Onboarding />
      <MessageDialog />
    </div>
  )
}
