import { useEffect, useRef, useState } from 'react'

/**
 * Text fields shown for a saved record. When the record reloads (e.g. after another field saved), only fields you
 * haven't changed take the new value, so moving quickly from field to field never loses what you're typing.
 */
export function useSyncedFields<T extends Record<string, string>>(saved: T): [T, (patch: Partial<T>) => void] {
  const [local, setLocal] = useState(saved)
  const last = useRef(saved)
  const key = JSON.stringify(saved)
  useEffect(() => {
    const prev = last.current
    last.current = saved
    setLocal((cur) => {
      const next = { ...cur }
      for (const k of Object.keys(saved) as (keyof T)[]) if (cur[k] === prev[k]) next[k] = saved[k]
      return next
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [local, (patch) => setLocal((c) => ({ ...c, ...patch }))]
}
