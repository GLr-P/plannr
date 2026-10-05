import type { EntityType, PlannrApi, UpdateStatus } from '../../shared/api'

export type NavigateTarget = { type: EntityType; id: string } | { calendarDate: string } | { money: string }

declare global {
  interface Window {
    plannr: PlannrApi
    plannrEvents: {
      onNavigate: (callback: (target: NavigateTarget) => void) => () => void
      onVaultLocked: (callback: () => void) => () => void
      onCalendarChanged: (callback: () => void) => () => void
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
    }
  }
}

export const api: PlannrApi = window.plannr
