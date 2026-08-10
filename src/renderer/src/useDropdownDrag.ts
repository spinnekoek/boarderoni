import { useRef, useState } from 'react'
import { dropdownAxis, dropdownSign } from '@shared/dropdownLayout'
import type { DropdownWidget } from '@shared/types'

// Which slot a raw pixel delta resolves to — same "always resolves to the
// nearest discrete option, never an in-between value" idea as
// useDialSwitchDrag's angle-to-detent snapping, just linear (delta / one
// item's own size) instead of angular, with the axis/sign flip from
// widget.orientation undone first (see shared/dropdownLayout.ts) so this is
// the exact inverse of DropdownWidgetContent's `listSlot * sign * itemSize`
// offset math. That slot maps to a position index per expandMode, mirroring
// DropdownWidgetContent's layout exactly so whatever's under the pointer
// while dragging is whatever gets selected: 'anchored' counts slots away
// from activeIndex (slot 0 = the active position, wherever the fan
// currently has it); 'unanchored' IS the index (slot 0 = position 0, which
// always sits at the widget's own footprint). Returns null once the delta
// pushes past the first/last position — a real "drag off the end to cancel"
// dead zone, not clamped to the nearest edge, so releasing there fires the
// widget's 'release' event but not 'selected' (see the widget's own comment
// in shared/types.ts).
function resolveIndex(widget: DropdownWidget, activeIndex: number, deltaX: number, deltaY: number): number | null {
  const orientation = widget.orientation ?? 'top-to-bottom'
  const axis = dropdownAxis(orientation)
  const sign = dropdownSign(orientation)
  const itemSize = axis === 'horizontal' ? widget.w : widget.h
  const delta = axis === 'horizontal' ? deltaX : deltaY
  const slot = Math.round((delta * sign) / itemSize)
  const index = (widget.expandMode ?? 'anchored') === 'unanchored' ? slot : activeIndex + slot
  return index >= 0 && index < widget.positions.length ? index : null
}

// Press-hold-drag-release interaction for a DropdownWidget on the deployed
// view client. Unlike Adjuster/Encoder's drag hooks (a continuous value) or
// DialSwitchDrag (angular snapping around a fixed ring), this widget's
// collapsed state IS the drag's anchor — positions only exist fanned out
// while held (see DropdownWidgetContent). `onPress`/`onRelease` fire
// unconditionally every hold, wherever it ends; `select` only fires when the
// release resolves to a real position, not a drag-off-the-end miss.
export function useDropdownDrag(
  widget: DropdownWidget,
  activeIndex: number,
  onPress: () => void,
  onRelease: () => void,
  select: (index: number) => void
): {
  held: boolean
  dragIndex: number | null
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const [held, setHeld] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // The collapsed widget's own center at press time — deltas are measured
  // from here, not the raw press point within it, so pressing near the top
  // vs. bottom edge of that one cell doesn't shift the effective baseline.
  const anchorRef = useRef({ x: 0, y: 0 })
  const holdingRef = useRef(false)

  function handlePointerDown(e: React.PointerEvent): void {
    const rect = e.currentTarget.getBoundingClientRect()
    anchorRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    holdingRef.current = true
    setHeld(true)
    setDragIndex(activeIndex)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
    onPress()
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!holdingRef.current) return
    const { x, y } = anchorRef.current
    setDragIndex(resolveIndex(widget, activeIndex, e.clientX - x, e.clientY - y))
  }

  function handlePointerUp(e: React.PointerEvent): void {
    if (!holdingRef.current) return
    holdingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // best-effort
    }
    const { x, y } = anchorRef.current
    const index = resolveIndex(widget, activeIndex, e.clientX - x, e.clientY - y)
    setHeld(false)
    setDragIndex(null)
    onRelease()
    if (index !== null) select(index)
  }

  return { held, dragIndex, handlePointerDown, handlePointerMove, handlePointerUp }
}
