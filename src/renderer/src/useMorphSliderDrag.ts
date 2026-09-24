import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from './store'
import { resolveNumericExpr, type VariableMap } from '@shared/expr'
import { morphSliderPoints, projectOntoMorphSliderPath } from '@shared/morph'
import type { MorphButtonWidget } from '@shared/types'

// Same reasoning/shape as useAdjusterDrag.ts's own constant.
const RECONCILE_EPSILON = 0.01

// Maps a pointer event to a 0..1 fraction along the shape's own slider path
// — the path equivalent of useAdjusterDrag.ts's fractionFromEvent (which
// projects onto a straight track or an arc instead of a polyline). `rect` is
// the containing SVG's own bounding rect — that SVG is rendered at exactly
// the shape's local footprint size (see MorphButtonWidget.tsx), so
// `clientX/Y - rect.left/top` lands in the same local coordinate space
// morphSliderPoints itself is defined in.
function fractionFromEvent(widget: MorphButtonWidget, e: React.PointerEvent, rect: DOMRect): number {
  const points = morphSliderPoints(widget)
  return projectOntoMorphSliderPath(points, e.clientX - rect.left, e.clientY - rect.top)
}

// Drag-to-value interaction for a morph button's slider handle on the
// client — structurally identical to useAdjusterDrag.ts
// (pointer capture, rAF-throttled in-flight triggerWidget ticks, a final
// unthrottled move+release on pointer-up, and the same valueExpr
// reconciliation dance), just with the path projection above standing in
// for Adjuster's rect/angle math, and a fixed 0-100 range (a path
// percentage, not a user-configurable min/max).
export function useMorphSliderDrag(
  widget: MorphButtonWidget,
  variables: VariableMap
): {
  dragFraction: number | undefined
  handlePointerDown: (e: React.PointerEvent<SVGCircleElement>) => void
  handlePointerMove: (e: React.PointerEvent<SVGCircleElement>) => void
  handlePointerUp: (e: React.PointerEvent<SVGCircleElement>) => void
} {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const [dragFraction, setDragFraction] = useState<number | undefined>(undefined)
  const dragRectRef = useRef<DOMRect | null>(null)
  const pendingFractionRef = useRef<number | null>(null)
  const rafScheduledRef = useRef(false)
  const dragValueRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function valueFor(fraction: number): number {
    return fraction * 100
  }

  // See useAdjusterDrag.ts's own identical effect for the full reasoning —
  // hands control back to valueExpr once it reflects this drag's own final
  // value.
  useEffect(() => {
    if (draggingRef.current) return
    if (dragValueRef.current === null) return
    if (!widget.valueExpr) return
    const restValue = resolveNumericExpr(widget.valueExpr, variables)
    if (restValue === undefined) return
    if (Math.abs(restValue - dragValueRef.current) <= RECONCILE_EPSILON) {
      dragValueRef.current = null
      setDragFraction(undefined)
    }
  }, [variables, widget.valueExpr])

  function scheduleSend(fraction: number): void {
    pendingFractionRef.current = fraction
    if (rafScheduledRef.current) return
    rafScheduledRef.current = true
    requestAnimationFrame(() => {
      rafScheduledRef.current = false
      const pending = pendingFractionRef.current
      pendingFractionRef.current = null
      if (pending === null) return
      const value = valueFor(pending)
      dragValueRef.current = value
      triggerWidget(widget.id, 'move', value, false)
    })
  }

  function handlePointerDown(e: React.PointerEvent<SVGCircleElement>): void {
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect) return
    draggingRef.current = true
    dragRectRef.current = rect
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handleResizePointerDown
    }
    const fraction = fractionFromEvent(widget, e, rect)
    setDragFraction(fraction)
    dragValueRef.current = valueFor(fraction)
    triggerWidget(widget.id, 'press', dragValueRef.current)
    scheduleSend(fraction)
  }

  function handlePointerMove(e: React.PointerEvent<SVGCircleElement>): void {
    const rect = dragRectRef.current
    if (!rect) return
    const fraction = fractionFromEvent(widget, e, rect)
    setDragFraction(fraction)
    scheduleSend(fraction)
  }

  function handlePointerUp(e: React.PointerEvent<SVGCircleElement>): void {
    const rect = dragRectRef.current
    if (!rect) return
    dragRectRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // best-effort
    }
    const fraction = fractionFromEvent(widget, e, rect)
    setDragFraction(fraction)
    pendingFractionRef.current = null
    const value = valueFor(fraction)
    dragValueRef.current = value
    draggingRef.current = false
    triggerWidget(widget.id, 'move', value)
    triggerWidget(widget.id, 'release', value)
  }

  return { dragFraction, handlePointerDown, handlePointerMove, handlePointerUp }
}
