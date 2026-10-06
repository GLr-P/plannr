import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Capture } from './Capture'
import { initTheme } from './theme'
import './styles/global.css'
import './styles/editor.css'
import './styles/business.css'
import './styles/calendar.css'
import './styles/vault.css'
import './styles/money.css'

// The main process passes the starting theme so the first paint has the right colors.
const initial = new URLSearchParams(location.search).get('theme')
document.documentElement.dataset.theme = initial === 'dark' ? 'dark' : 'light'
void initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('capture') ? <Capture /> : <App />}
  </StrictMode>
)
