import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from './store'
import { resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { EncoderWidget } from '@shared/types'
import { useMultiPressArbiter } from './useMultiPressArbiter'

const DEFAULT_STEP_DEGREES = 15

// How close the widget's own resolved rest angle (widget.valueExpr) has to
// land to what we last dragged to before we treat it as "the server has
// caught up" and hand control back to it — same idea as useAdjusterDrag.ts's
// own RECONCILE_EPSILON, just in degrees.
const RECONCILE_EPSILON = 0.5

// Angle (degrees) of the pointer around the widget's center, 0 = up,
// increasing clockwise — same convention as AdjusterWidget's own knob drag
// math (see useAdjusterDrag.ts's fractionFromEvent), just unbounded here
// instead of clamped into a fixed start/end sweep, since an encoder has no
// absolute range to clamp into.
function angleFromEvent(e: React.PointerEvent, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
}

// Rotary drag for an EncoderWidget on the deployed view client — accumulates
// angular delta since the last fired step and fires 'increment'/'decrement'
// once per widget.stepDegrees crossed, carrying over the remainder so a fast
// spin can fire several steps off one pointermove and a slow one still
// eventually crosses the threshold. press/release fire unconditionally on
// pointerdown/up (same as AdjusterWidget's own), independent of whether the
// gesture also turned — so a push-only or spin-only wiring both work without
// any extra configuration. press itself resolves through the same
// doublePress/triplePress arbiter AdjusterWidget/ButtonWidget use (see
// useMultiPressArbiter) — opt-in by either being non-empty, otherwise press
// fires the instant the grip is touched, same as always.
//
// dragSpinDegrees tracks the grip's live visual angle starting from
// widget.valueExpr's resolved rest position (not from 0) so a widget with a
// bound value doesn't visually snap to "up" the moment you grab it — and is
// kept set after the drag ends (not reset immediately) until the
// reconciliation effect below sees the server's own valueExpr catch up to
// where this drag left off, same handoff AdjusterWidget's own drag uses.
export function useEncoderDrag(widget: EncoderWidget, variables: VariableMap): {
  dragSpinDegrees: number | undefined
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  // ?? [] guards a dashboard saved before these existed — see
  // ButtonWidget.events' own comment in shared/types.ts for the convention.
  const hasDoublePress = (widget.events.doublePress ?? []).length > 0
  const hasTriplePress = (widget.events.triplePress ?? []).length > 0
  const multiPressEnabled = hasDoublePress || hasTriplePress
  const { registerTap } = useMultiPressArbiter(widget.id, hasDoublePress, hasTriplePress)
  const [dragSpinDegrees, setDragSpinDegrees] = useState<number | undefined>(undefined)
  const lastAngleRef = useRef<number | null>(null)
  // Remainder toward the next increment/decrement step — separate from the
  // visual spin angle below, since a widget with no valueExpr at all still
  // needs to accumulate steps even though nothing visually tracks it.
  const stepAccumulatorRef = useRef(0)
  // The angle we last told the server this widget's grip should be at —
  // null once a gesture isn't in flight and its final angle has already
  // been reconciled (or there's no valueExpr to reconcile against).
  const spinValueRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  // Hands control back to the live variable once it reflects this drag's own
  // final angle — same reasoning as useAdjusterDrag.ts's own reconciliation
  // effect.
  useEffect(() => {
    if (draggingRef.current) return
    if (spinValueRef.current === null) return
    if (!widget.valueExpr) return
    const restValue = resolveNumericExpr(widget.valueExpr, variables)
    if (restValue === undefined) return
    if (Math.abs(restValue - spinValueRef.current) <= RECONCILE_EPSILON) {
      spinValueRef.current = null
      setDragSpinDegrees(undefined)
    }
  }, [variables, widget.valueExpr])

  function handlePointerDown(e: React.PointerEvent): void {
    draggingRef.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    // Snaps the grip to point at wherever was actually pressed, same feel as
    // AdjusterWidget's own knob — even though an encoder has no absolute
    // value for that click position to actually MEAN anything (see
    // valueExpr's own comment), the visual snap is what makes pressing feel
    // like it did something instead of the grip staying wherever it was
    // until you start dragging. Purely cosmetic: increment/decrement still
    // only fire off the DELTA from here as the drag continues, same as
    // before — this doesn't give the click position itself any meaning.
    const clickAngle = angleFromEvent(e, rect)
    lastAngleRef.current = clickAngle
    stepAccumulatorRef.current = 0
    spinValueRef.current = clickAngle
    setDragSpinDegrees(clickAngle)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handleResizePointerDown
    }
    if (multiPressEnabled) registerTap()
    else triggerWidget(widget.id, 'press')
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!draggingRef.current || lastAngleRef.current === null || spinValueRef.current === null) return
    const rect = e.currentTarget.getBoundingClientRect()
    const angle = angleFromEvent(e, rect)
    let delta = angle - lastAngleRef.current
    // Shortest-path wrap — a pointer crossing the 0/360 seam shouldn't
    // register as a near-360° jump the wrong way.
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    lastAngleRef.current = angle
    stepAccumulatorRef.current += delta
    spinValueRef.current += delta
    setDragSpinDegrees(spinValueRef.current)

    const step = widget.stepDegrees ?? DEFAULT_STEP_DEGREES
    while (stepAccumulatorRef.current >= step) {
      stepAccumulatorRef.current -= step
      triggerWidget(widget.id, 'increment')
    }
    while (stepAccumulatorRef.current <= -step) {
      stepAccumulatorRef.current += step
      triggerWidget(widget.id, 'decrement')
    }
  }

  function handlePointerUp(e: React.PointerEvent): void {
    draggingRef.current = false
    lastAngleRef.current = null
    stepAccumulatorRef.current = 0
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // best-effort
    }
    triggerWidget(widget.id, 'release')
  }

  return { dragSpinDegrees, handlePointerDown, handlePointerMove, handlePointerUp }
}
