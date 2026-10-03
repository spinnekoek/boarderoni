import { useRef } from 'react'

// A new touch is ignored by every widget once this many fingers are already
// down. The 5-finger settings gesture (useSettingsGesture) only recognises
// itself when the last finger lands, so without this its fingers press
// whatever buttons they happen to touch on the way there.
const MAX_FINGERS_BEFORE_IGNORING = 3

// Capture-phase handlers for the client canvas root. A suppressed pointer's
// down, up and cancel are all swallowed so widgets never see half a gesture
// (e.g. a release with no press).
export function useMultiTouchGuard(): {
  onPointerDownCapture: (e: React.PointerEvent) => void
  onPointerUpCapture: (e: React.PointerEvent) => void
  onPointerCancelCapture: (e: React.PointerEvent) => void
  onPointerMoveCapture: (e: React.PointerEvent) => void
} {
  const activeRef = useRef(new Set<number>())
  const suppressedRef = useRef(new Set<number>())

  function onPointerDownCapture(e: React.PointerEvent): void {
    if (e.pointerType !== 'touch') return
    if (activeRef.current.size >= MAX_FINGERS_BEFORE_IGNORING) {
      suppressedRef.current.add(e.pointerId)
      e.stopPropagation()
    }
    activeRef.current.add(e.pointerId)
  }

  function end(e: React.PointerEvent): void {
    if (e.pointerType !== 'touch') return
    activeRef.current.delete(e.pointerId)
    if (suppressedRef.current.delete(e.pointerId)) e.stopPropagation()
  }

  function onPointerMoveCapture(e: React.PointerEvent): void {
    if (suppressedRef.current.has(e.pointerId)) e.stopPropagation()
  }

  return { onPointerDownCapture, onPointerUpCapture: end, onPointerCancelCapture: end, onPointerMoveCapture }
}
