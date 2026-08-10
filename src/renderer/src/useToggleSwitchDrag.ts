import { useRef, useState } from 'react'
import { angleForIndex, isMiddlePosition } from './components/widgets/ToggleSwitchWidget'
import type { ToggleSwitchWidget } from '@shared/types'

// Angle (degrees) of the pointer around the widget's center, 0 = up,
// increasing clockwise — same convention (and unbounded, since a drag can go
// past the widget's own bounds) as useDialSwitchDrag's own angleFromEvent.
function angleFromEvent(e: React.PointerEvent, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// Which position's own angle (see angleForIndex) is closest to a raw drag
// angle — same "snap to the nearest real position" idea as
// useDialSwitchDrag's nearestPositionIndex.
function nearestPositionIndex(widget: ToggleSwitchWidget, pointerAngle: number): number {
  const orientation = widget.orientation ?? 'vertical'
  const count = widget.positions.length
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < count; i++) {
    const distance = angularDistance(pointerAngle, angleForIndex(i, count, orientation))
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

// The middle position a momentary throw springs back to — only exists with
// exactly 3 positions (see SwitchPosition.momentary's own comment); -1 means
// "no such position" (a 2-position toggle never has momentary positions in
// the first place, since the properties panel only offers that config with
// a middle to spring back to).
function middlePositionIndex(count: number): number {
  return count % 2 === 1 ? (count - 1) / 2 : -1
}

// Drag interaction for a ToggleSwitchWidget in 'drag' mode (see
// widget.interactionMode) — press anywhere on the widget and drag toward
// the position you want, releasing commits it, same gesture as
// useDialSwitchDrag. The one thing this adds beyond Dial's own version:
// reaching a momentary position (see SwitchPosition.momentary) fires its
// onSelect live, the instant the drag resolves onto it, rather than waiting
// for release — a momentary throw has nothing meaningful to "commit" later,
// it's only ever active while you're actually pressing/dragging on it.
// Dragging back off it (still held) or releasing on it both spring back to
// the middle position immediately.
export function useToggleSwitchDrag(
  widget: ToggleSwitchWidget,
  select: (index: number) => void
): {
  dragIndex: number | undefined
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const draggingRef = useRef(false)
  // Which position (if any) is the currently-held momentary one — tracked
  // separately from dragIndex so a drag that passes over a momentary
  // position and back off it can tell "was that momentary throw already
  // fired" apart from "is this index just being previewed."
  const heldMomentaryIndexRef = useRef<number | null>(null)
  const middleIndex = middlePositionIndex(widget.positions.length)

  function isMomentary(index: number): boolean {
    return !isMiddlePosition(index, widget.positions.length) && (widget.positions[index]?.momentary ?? false)
  }

  function springBackFromMomentary(): void {
    heldMomentaryIndexRef.current = null
    if (middleIndex >= 0) select(middleIndex)
  }

  function updateFromEvent(e: React.PointerEvent): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const angle = angleFromEvent(e, rect)
    const index = nearestPositionIndex(widget, angle)
    setDragIndex(index)
    if (isMomentary(index)) {
      if (heldMomentaryIndexRef.current !== index) {
        heldMomentaryIndexRef.current = index
        select(index)
      }
    } else if (heldMomentaryIndexRef.current !== null) {
      springBackFromMomentary()
    }
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
    // A momentary position never "commits" as the new resting position —
    // releasing on one always springs back to the middle, same as tap
    // mode's own onZonePointerUp.
    if (heldMomentaryIndexRef.current !== null) {
      springBackFromMomentary()
    } else {
      select(index)
    }
  }

  return { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp }
}
