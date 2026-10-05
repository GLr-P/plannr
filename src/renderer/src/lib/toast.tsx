import { useEffect } from 'react'
import { create } from 'zustand'

/** A short message at the bottom of the window, optionally with an action (e.g. "Undo" after a delete). */
interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void | Promise<void> }
}

const useToast = create<{ toast: Toast | null; set: (t: Toast | null) => void }>((set) => ({ toast: null, set: (toast) => set({ toast }) }))

let seq = 0
export function showToast(text: string, action?: Toast['action']): void {
  useToast.getState().set({ id: ++seq, text, action })
}

/** Shows "<what> deleted · Undo" for a few seconds. */
export const undoToast = (text: string, undo: () => void | Promise<void>): void => showToast(text, { label: 'Undo', run: undo })

export function ToastHost() {
  const { toast, set } = useToast()
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => set(null), toast.action ? 6000 : 2500)
    return () => clearTimeout(t)
  }, [toast, set])
  if (!toast) return null
  return (
    <div className="toast app-toast" role="status" key={toast.id}>
      {toast.text}
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            set(null)
            void toast.action!.run()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
