import { useRef, useState } from 'react'
import { angleForPosition } from './components/widgets/DialSwitchWidget'
import type { DialSwitchWidget } from '@shared/types'

// Angle (degrees) of the pointer around the widget's center, 0 = up,
// increasing clockwise — same convention (and unbounded, since a drag can go
// past the widget's own bounds) as EncoderWidget's own drag math, see
// useEncoderDrag.ts's own comment.
function angleFromEvent(e: React.PointerEvent, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// Which position's own angle (see angleForPosition) is closest to a raw
// drag angle — this is what makes the needle "snap" between positions
// instead of free-following the pointer, and what a release commits. Nearest
// by shortest angular distance (not a range lookup), so a pointer aimed into
// the gap between startAngle/endAngle on a sub-360° sweep still resolves to
// whichever real position is nearest, rather than nothing.
function nearestPositionIndex(widget: DialSwitchWidget, pointerAngle: number): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < widget.positions.length; i++) {
    const distance = angularDistance(pointerAngle, angleForPosition(widget, i))
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

// Drag interaction for a DialSwitchWidget in 'drag' mode (see
// widget.interactionMode) — press anywhere on the widget and drag in the
// direction of the position you want, releasing commits it. Unlike
// AdjusterWidget/EncoderWidget's own drag hooks, this isn't measuring a
// continuous value: every pointer position just resolves to whichever
// position is angularly nearest (see nearestPositionIndex), which is also
// what dragIndex previews live so the needle visibly snaps between real
// positions as you drag, never sitting at some in-between angle. `select` is
// useSwitchPosition's own — reused as-is so a drag-commit updates this
// device's local remembered position exactly the same way a tap does.
export function useDialSwitchDrag(
  widget: DialSwitchWidget,
  select: (index: number) => void
): {
  dragIndex: number | undefined
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const draggingRef = useRef(false)

  function updateFromEvent(e: React.PointerEvent): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const angle = angleFromEvent(e, rect)
    const index = nearestPositionIndex(widget, angle)
    setDragIndex(index)
    return index
  }

  function handlePointerDown(e: React.PointerEvent): void {
    draggingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handleResizePointerDown
    }
    updateFromEvent(e)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!draggingRef.current) return
    updateFromEvent(e)
  }

  function handlePointerUp(e: React.PointerEvent): void {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // best-effort
    }
    const index = updateFromEvent(e)
    setDragIndex(undefined)
    select(index)
  }

  return { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp }
}
