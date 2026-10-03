import type { PlannrApi } from '../../shared/api'

declare global {
  interface Window {
    plannr: PlannrApi
  }
}

export const api: PlannrApi = window.plannr
