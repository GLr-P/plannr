import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The strict CSP in index.html blocks Vite's inline dev scripts (React refresh); drop it only for `npm run dev`.
const devCsp: Plugin = {
  name: 'plannr-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
}

// Defaults: src/main/index.ts, src/preload/index.ts, src/renderer/index.html
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), devCsp]
  }
})
