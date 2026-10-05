import type { EntityType, PlannrApi } from '../../shared/api'

export type NavigateTarget = { type: EntityType; id: string } | { calendarDate: string } | { money: string }

declare global {
  interface Window {
    plannr: PlannrApi
    plannrEvents: {
      onNavigate: (callback: (target: NavigateTarget) => void) => () => void
      onVaultLocked: (callback: () => void) => () => void
    }
  }
}

export const api: PlannrApi = window.plannr
