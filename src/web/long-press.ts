/*
 * Touch screens: holding a finger on something opens Plannr's menu for it, like right-clicking on the PC. Safari on
 * iPhone doesn't send a "contextmenu" event for a long press, so one is made here.
 */
export function enableLongPress(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number; target: EventTarget | null } | null = null
  let native = false
  let fired = false
  const cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  document.addEventListener('contextmenu', () => (native = true), true)
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return cancel()
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY, target: e.target }
      native = false
      fired = false
      cancel()
      timer = setTimeout(() => {
        timer = null
        if (native || !start?.target) return // the browser already opened one
        const el = start.target as Element
        if (el.closest('input, textarea, [contenteditable="true"]')) return // text: keep the system's select/copy
        fired = true
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, button: 2 }))
        navigator.vibrate?.(10)
      }, 550)
    },
    { passive: true }
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0]
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel()
    },
    { passive: true }
  )
  document.addEventListener('touchend', cancel, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })
  // The finger lifting after a long press shouldn't also "click" what's under it.
  document.addEventListener(
    'click',
    (e) => {
      if (fired) {
        fired = false
        e.preventDefault()
        e.stopPropagation()
      }
    },
    true
  )
}
