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

// Messages from the main process (e.g. a clicked reminder asks to open a ticket).
contextBridge.exposeInMainWorld('plannrEvents', {
  onNavigate: (callback: (target: unknown) => void): (() => void) => {
    const listener = (_event: unknown, target: unknown): void => callback(target)
    ipcRenderer.on('navigate', listener)
    return () => ipcRenderer.removeListener('navigate', listener)
  },
  onCalendarChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('calendar-changed', listener)
    return () => ipcRenderer.removeListener('calendar-changed', listener)
  },
  onVaultLocked: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault-locked', listener)
    return () => ipcRenderer.removeListener('vault-locked', listener)
  }
})
