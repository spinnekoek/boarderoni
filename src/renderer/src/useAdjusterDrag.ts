import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from './store'
import { resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { AdjusterWidget } from '@shared/types'

// How close the widget's own resolved rest value (see valueExpr below) has
// to land to what we last commanded before we treat it as "the server has
// caught up" and hand control back to it — not exact equality, since an
// update-state action's code is free to transform the raw value (round it,
// clamp it, etc.) before storing it back to a variable.
const RECONCILE_EPSILON = 0.01

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405

// Maps a pointer event to a 0..1 fraction along the widget's drag axis
// (slider: position along the track; knob: angle around the center),
// clamped to the configured range.
function fractionFromEvent(widget: AdjusterWidget, e: React.PointerEvent, rect: DOMRect): number {
  if (widget.style === 'knob') {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    // Inverse of arcPath.ts's polarToCartesian: 0deg = up, increasing
    // clockwise, matching startAngle/endAngle's "clock position" reading.
    const angleDeg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
    const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
    const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
    let normalized = angleDeg
    while (normalized < startAngle) normalized += 360
    while (normalized > startAngle + 360) normalized -= 360
    const raw = (normalized - startAngle) / (endAngle - startAngle)
    return Math.min(1, Math.max(0, raw))
  }

  const orientation = widget.orientation ?? 'vertical'
  if (orientation === 'horizontal') {
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  }
  // Vertical: top of the track is max, bottom is min.
  return Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height))
}

// Drag-to-value interaction for an AdjusterWidget on the deployed view
// client — pointer capture + rAF-throttled `triggerWidget` calls, mirroring
// the setPointerCapture pattern already used by CanvasWidget's resize handle
// and useWidgetDrag.ts. Fires the widget's own `action` (any WidgetAction
// kind, same editor as a button) with the live value exposed as
// `variables.$value` server-side — see triggerAction/runUpdateState/
// runSendDcsCommand in main/index.ts.
export function useAdjusterDrag(
  widget: AdjusterWidget,
  variables: VariableMap
): {
  dragFraction: number | undefined
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  // Kept set after the drag ends rather than snapping back to the resolved
  // rest position immediately — that would visually jump before the
  // server's own broadcast (of this same drag's final value) catches up.
  // Cleared once the reconciliation effect below sees that broadcast arrive
  // — not before — so on a dashboard shared across multiple devices, one
  // screen's drag doesn't stay stuck ignoring every other screen's update to
  // this same widget forever after (see valueExpr/dragValueRef below).
  const [dragFraction, setDragFraction] = useState<number | undefined>(undefined)
  const dragRectRef = useRef<DOMRect | null>(null)
  const pendingFractionRef = useRef<number | null>(null)
  const rafScheduledRef = useRef(false)
  // The value we last told the server (via triggerWidget) this widget
  // should settle at — null once a gesture isn't in flight and its final
  // value has already been reconciled (or there was never a valueExpr to
  // reconcile against in the first place).
  const dragValueRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  function valueFor(fraction: number): number {
    return widget.min + fraction * (widget.max - widget.min)
  }

  // Hands control back to the live variable once it reflects this drag's
  // own final value — i.e. once triggerWidget's round trip (broadcast as
  // variables:sync, see store.ts) has come back around. Skipped entirely
  // while still mid-gesture (a stale echo of an earlier tick shouldn't
  // fight the pointer that's still moving) and when there's no valueExpr at
  // all (nothing to reconcile against — the widget has no live rest
  // position to hand back to, so staying at the last-dragged spot is
  // already correct).
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

  // Caps outbound triggers to ~once per frame regardless of pointermove
  // event rate — pointermove can fire far faster than the WS round trip
  // (and downstream action, e.g. a UDP send) can keep up with. final: false
  // marks these as in-flight ticks (see triggerWidget/runUpdateState) so an
  // update-state action's dashboard save is debounced rather than a
  // synchronous disk write on every single tick — without that, a fast drag
  // visibly stutters under the write load.
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
      triggerWidget(widget.id, value, false)
    })
  }

  function handlePointerDown(e: React.PointerEvent): void {
    draggingRef.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    dragRectRef.current = rect
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handleResizePointerDown
    }
    const fraction = fractionFromEvent(widget, e, rect)
    setDragFraction(fraction)
    scheduleSend(fraction)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    const rect = dragRectRef.current
    if (!rect) return
    const fraction = fractionFromEvent(widget, e, rect)
    setDragFraction(fraction)
    scheduleSend(fraction)
  }

  function handlePointerUp(e: React.PointerEvent): void {
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
    // Final, unthrottled send — guarantees the last position commits even
    // if a scheduled rAF tick from scheduleSend was still pending. Also
    // final in the triggerWidget/runUpdateState sense (the default when
    // omitted) — the settled value gets a synchronous save, same as a plain
    // click, rather than the debounced save every in-flight tick above uses.
    pendingFractionRef.current = null
    const value = valueFor(fraction)
    dragValueRef.current = value
    // Gesture's over — lets the reconciliation effect above act on the next
    // variables update instead of ignoring it as a stale mid-drag echo.
    draggingRef.current = false
    triggerWidget(widget.id, value)
  }

  return { dragFraction, handlePointerDown, handlePointerMove, handlePointerUp }
}
