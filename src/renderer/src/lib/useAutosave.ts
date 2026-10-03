import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'saved' | 'pending' | 'saving'

/**
 * Batches edits (merged patch objects) and saves them shortly after typing stops.
 * Flushes when the component unmounts (navigating away) or the window closes.
 */
export function useAutosave<P extends object>(save: (patch: P) => Promise<void>, delay = 350) {
  const saveRef = useRef(save)
  saveRef.current = save
  const pending = useRef<Partial<P>>({})
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [status, setStatus] = useState<SaveStatus>('saved')

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    if (Object.keys(patch).length === 0) return
    pending.current = {}
    setStatus('saving')
    await saveRef.current(patch as P)
    setStatus(Object.keys(pending.current).length ? 'pending' : 'saved')
  }, [])

  const queue = useCallback(
    (patch: Partial<P>) => {
      Object.assign(pending.current, patch)
      setStatus('pending')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [flush, delay]
  )

  useEffect(() => {
    const onUnload = (): void => void flush()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      void flush()
    }
  }, [flush])

  return { queue, flush, status }
}
