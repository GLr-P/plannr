import type { NavigateTarget, PlannrApi, UpdateStatus } from '../../shared/api'

export type { NavigateTarget }

declare global {
  interface Window {
    plannr: PlannrApi
    plannrEvents: {
      onNavigate: (callback: (target: NavigateTarget) => void) => () => void
      onVaultLocked: (callback: () => void) => () => void
      onCalendarChanged: (callback: () => void) => () => void
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
      onCaptureOpen: (callback: () => void) => () => void
      onDataChanged: (callback: () => void) => () => void
    }
  }
}

export const api: PlannrApi = window.plannr
