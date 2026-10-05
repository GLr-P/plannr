import { create } from 'zustand'
import type { UpdateStatus } from '../../../shared/api'
import { api } from '../api'

/** Latest update status from the main process (checks run there; progress arrives as events). */
export const useUpdate = create<{ status: UpdateStatus | null }>(() => ({ status: null }))

export function initUpdates(): () => void {
  void api.updates.status().then((status) => useUpdate.setState({ status }))
  return window.plannrEvents.onUpdateStatus((status) => useUpdate.setState({ status }))
}

export const checkForUpdates = async (): Promise<void> => useUpdate.setState({ status: await api.updates.check() })
export const installUpdate = async (): Promise<void> => useUpdate.setState({ status: await api.updates.install() })
