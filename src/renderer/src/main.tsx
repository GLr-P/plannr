import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initTheme } from './theme'
import './styles/global.css'
import './styles/editor.css'

// The main process passes the starting theme so the first paint has the right colors.
const initial = new URLSearchParams(location.search).get('theme')
document.documentElement.dataset.theme = initial === 'dark' ? 'dark' : 'light'
void initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
