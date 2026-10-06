import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

// The phone web app (out/web): the same screens as the PC app, with the services running in a Web Worker on
// SQLite compiled to WebAssembly. Node's built-ins are swapped for small browser stand-ins (src/web/shims).
const shim = (name: string): string => fileURLToPath(new URL(`./src/web/shims/${name}.ts`, import.meta.url))
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version
const alias = { 'node:crypto': shim('crypto'), 'node:fs': shim('fs'), 'node:path': shim('path'), 'node:sqlite': shim('sqlite') }

export default defineConfig({
  root: 'src/web',
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias },
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { outDir: '../../out/web', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 }
})
