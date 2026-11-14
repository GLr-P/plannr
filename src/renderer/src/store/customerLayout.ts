import { create } from 'zustand'
import { api } from '../api'
import { customerLayout, type CustomerLayout } from '../../../shared/api'

/**
 * How customer pages look, for every customer: your names for the built-in parts, the ones you hid and your own
 * fields. Changed from Customize on any customer page; kept in the synced setting 'customers.layout'.
 */
export const CUSTOMER_LAYOUT_KEY = 'customers.layout'

export const useCustomerLayout = create<{
  layout: CustomerLayout
  load: () => Promise<void>
  save: (patch: Partial<CustomerLayout>) => Promise<void>
}>((set, get) => ({
  layout: customerLayout(null),
  load: async () => set({ layout: customerLayout(await api.settings.get(CUSTOMER_LAYOUT_KEY)) }),
  save: async (patch) => {
    const layout = customerLayout({ ...get().layout, ...patch })
    set({ layout })
    await api.settings.set(CUSTOMER_LAYOUT_KEY, layout)
  }
}))
