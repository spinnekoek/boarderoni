import { useRef, useState } from 'react'
import { angleForPosition } from './components/widgets/DialSwitchWidget'
import { resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { DialSwitchWidget } from '@shared/types'

// Angle (degrees) of the pointer around the widget's center, 0 = up,
// increasing clockwise — same convention (and unbounded, since a drag can go
// past the widget's own bounds) as EncoderWidget's own drag math, see
// useEncoderDrag.ts's own comment. Counter-rotated by the widget's own
// resolved rotateAngle (see DialSwitchWidget.tsx) so the raw screen-space
// pointer angle gets mapped back into the widget's own unrotated frame —
// angleForPosition's own angles (which nearestPositionIndex below compares
// this against) are defined in that unrotated frame, so without this a
// rotated dial's needle would track the pointer at an offset instead of
// following it directly (same bug, same fix, as AdjusterWidget's own
// rotateAngle got — see useAdjusterDrag.ts's fractionFromEvent).
function angleFromEvent(e: React.PointerEvent, rect: DOMRect, rotateAngle: number): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90 - rotateAngle
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
// useSwitchPosition's own — reused as-is so a drag-commit (or a live fire,
// see fireWhileDragging below) updates this device's local remembered
// position exactly the same way a tap does.
export function useDialSwitchDrag(
  widget: DialSwitchWidget,
  select: (index: number) => void,
  variables: VariableMap
): {
  dragIndex: number | undefined
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const draggingRef = useRef(false)
  // Same resolution DialSwitchWidgetContent itself uses to build the CSS
  // transform — kept in sync here so the drag math counter-rotates by
  // exactly what the widget is actually visually rotated by right now.
  const rotateAngle = (widget.rotateAngleExpr ? resolveNumericExpr(widget.rotateAngleExpr, variables) : undefined) ?? widget.rotateAngle ?? 0
  // Whichever index select() was most recently called for mid-drag, when
  // widget.fireWhileDragging is on — same "avoid firing the same position's
  // onSelect/positionChange twice on release" bookkeeping as
  // useToggleSwitchDrag.ts's own lastFiredIndexRef (see its comment); reset
  // to null at the start of every gesture.
  const lastFiredIndexRef = useRef<number | null>(null)

  function fireSelect(index: number): void {
    select(index)
    lastFiredIndexRef.current = index
  }

  function updateFromEvent(e: React.PointerEvent): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const angle = angleFromEvent(e, rect, rotateAngle)
    const index = nearestPositionIndex(widget, angle)
    // waitForStateConfirm skips this local preview entirely — the needle is
    // only supposed to move once activePositionExpr's own live value does,
    // not the instant the drag passes a position (see its own comment in
    // shared/types.ts). Firing below still happens exactly the same either
    // way.
    if (!widget.waitForStateConfirm) setDragIndex(index)
    // Defaults on — see fireWhileDragging's own comment in shared/types.ts.
    if ((widget.fireWhileDragging ?? true) && lastFiredIndexRef.current !== index) fireSelect(index)
    return index
  }

  function handlePointerDown(e: React.PointerEvent): void {
    draggingRef.current = true
    lastFiredIndexRef.current = null
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
    // With fireWhileDragging on, updateFromEvent below always leaves
    // lastFiredIndexRef pointing at this final index — either it already
    // did (nothing changed since the last live fire) or it just fired it —
    // so the check below only ever actually calls select() again here when
    // fireWhileDragging is off, same release-only commit as before this
    // feature existed.
    const index = updateFromEvent(e)
    setDragIndex(undefined)
    if (!((widget.fireWhileDragging ?? true) && lastFiredIndexRef.current === index)) select(index)
  }

  return { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp }
}
