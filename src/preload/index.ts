import { contextBridge, ipcRenderer } from 'electron'
import { API_SHAPE } from '../shared/api'

// Builds window.plannr from API_SHAPE: plannr.notes.get(id) → ipc 'notes:get'.
const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {}
for (const [ns, methods] of Object.entries(API_SHAPE)) {
  api[ns] = {}
  for (const method of methods) {
    api[ns][method] = (...args) => ipcRenderer.invoke(`${ns}:${method}`, ...args)
  }
}

contextBridge.exposeInMainWorld('plannr', api)
