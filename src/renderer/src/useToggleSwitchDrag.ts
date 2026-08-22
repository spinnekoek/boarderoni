import { useRef, useState } from 'react'
import { isMiddlePosition } from './components/widgets/ToggleSwitchWidget'
import type { ToggleSwitchWidget } from '@shared/types'

// Which position the drag currently resolves to — relative to wherever the
// switch ALREADY was when the press started (baselineIndex), shifted by how
// far the pointer has moved since (as a fraction of the widget's own
// bounding box along its orientation axis), not by where the pointer
// currently sits in absolute screen space.
//
// Two things this deliberately isn't, both tried first:
// 1. Angle-from-center (the rotary approach useDialSwitchDrag uses) — a
//    toggle's positions sit in a straight line, not around a circle, and
//    angle-from-center gets wildly oversensitive near the pivot, which
//    "start dragging from anywhere" (including near center) hits constantly.
// 2. A plain linear fraction of the widget's own box (0 at the top/left
//    edge, 1 at the bottom/right — what .deck-toggle-switch__zones' tap
//    targets themselves use) — closer, but still absolute: pressing
//    anywhere already inside the top zone's own screen area and dragging up
//    a little instantly resolved to top, even from a switch resting at the
//    bottom, because the very first post-deadzone sample already landed in
//    top's territory. Physically backwards — grabbing a lever wherever your
//    finger lands shouldn't teleport it to match your finger's position; it
//    should move by however far your finger actually travels.
// This version fixes both: baselineIndex's own zone-center is the fraction
// you start from, and only the pointer's MOVEMENT since press (independent
// of where that press physically landed) shifts it from there — so a drag
// from bottom always sweeps through middle on the way to top, wherever on
// the widget you happened to grab it.
function relativePositionIndex(
  widget: ToggleSwitchWidget,
  baselineIndex: number,
  startCoord: number,
  currentCoord: number,
  axisLength: number
): number {
  const count = widget.positions.length
  if (axisLength <= 0) return baselineIndex
  const baselineFraction = (baselineIndex + 0.5) / count
  const fraction = baselineFraction + (currentCoord - startCoord) / axisLength
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)))
}

// The middle position a momentary throw springs back to — only exists with
// exactly 3 positions (see SwitchPosition.momentary's own comment); -1 means
// "no such position" (a 2-position toggle never has momentary positions in
// the first place, since the properties panel only offers that config with
// a middle to spring back to).
function middlePositionIndex(count: number): number {
  return count % 2 === 1 ? (count - 1) / 2 : -1
}

// Below this many pixels of straight-line movement from where the gesture
// started, a press still counts as "hasn't dragged yet" — see
// handlePointerDown/handlePointerMove below for why that distinction exists.
const DRAG_DEADZONE_PX = 6

// Stretches the axis relativePositionIndex measures movement against, so
// crossing into the next position takes more actual finger travel than the
// widget's own bare height/width would give it (1.75x — a full bottom-to-top
// sweep on a 3-position switch now takes ~1.75x the widget's own height of
// drag, same proportional spacing between each step's own threshold, just
// wider throughout).
const DRAG_RANGE_MULTIPLIER = 1.75

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
  activeIndex: number,
  select: (index: number) => void
): {
  dragIndex: number | undefined
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const draggingRef = useRef(false)
  // Set the instant the gesture crosses DRAG_DEADZONE_PX away from its own
  // start point — before that, this is a plain press sitting wherever it
  // landed on the widget (which, unlike a set of separately-tappable tap-mode
  // zones, is nowhere in particular relative to the current lever angle), not
  // yet a drag toward some new position. Gates every position-changing effect
  // below (the live dragIndex preview, a momentary position firing, and the
  // final commit on release) so a press-and-release with no real movement
  // never moves the switch off whatever it already showed — see this hook's
  // own bug report: pressing near the top of a widget currently pointing down
  // used to always snap it toward the top, even with zero actual drag.
  const hasMovedRef = useRef(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  // Captured once, at press-down — see relativePositionIndex's own comment
  // for why this (not wherever the press physically landed) is what the
  // drag's movement gets measured from.
  const baselineIndexRef = useRef(0)
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
    const start = startRef.current!
    const orientation = widget.orientation ?? 'vertical'
    const axisLength = (orientation === 'vertical' ? rect.height : rect.width) * DRAG_RANGE_MULTIPLIER
    const startCoord = orientation === 'vertical' ? start.y : start.x
    const currentCoord = orientation === 'vertical' ? e.clientY : e.clientX
    const index = relativePositionIndex(widget, baselineIndexRef.current, startCoord, currentCoord, axisLength)
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
    hasMovedRef.current = false
    startRef.current = { x: e.clientX, y: e.clientY }
    baselineIndexRef.current = activeIndex
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handleResizePointerDown
    }
    // Deliberately NOT updateFromEvent(e) here — see hasMovedRef's own
    // comment above. dragIndex stays undefined (rendering the widget's
    // actual current position, per ToggleSwitchWidgetContent's own
    // dragIndex ?? activeIndex) until real movement proves this is a drag
    // and not a stationary press.
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!draggingRef.current) return
    if (!hasMovedRef.current) {
      const start = startRef.current!
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (distance < DRAG_DEADZONE_PX) return
      hasMovedRef.current = true
    }
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
    // Never moved past the deadzone — a plain tap, not a drag toward
    // anything. Leave the switch exactly as it was; nothing to commit.
    if (!hasMovedRef.current) return
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
