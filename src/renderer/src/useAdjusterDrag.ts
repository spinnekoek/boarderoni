import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from './store'
import { resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { AdjusterKnobWidget, AdjusterSliderWidget } from '@shared/types'

type AdjusterWidget = AdjusterSliderWidget | AdjusterKnobWidget
import { useMultiPressArbiter } from './useMultiPressArbiter'

// How close the widget's own resolved rest value (see valueExpr below) has
// to land to what we last commanded before we treat it as "the server has
// caught up" and hand control back to it — not exact equality, since an
// update-state action's code is free to transform the raw value (round it,
// clamp it, etc.) before storing it back to a variable.
const RECONCILE_EPSILON = 0.01

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405

// Caps how far a single pointermove sample can move a knob's fraction —
// guards against the pointer passing near the widget's own center, where a
// tiny physical movement swings the angle wildly (atan2 is numerically
// unstable right at the origin). Applied to the per-event angular DELTA in
// knobDeltaFraction below, not to an absolute jump — see that function's own
// comment for why deltas, not absolute angle, drive dragging once a knob
// gesture is under way.
const MAX_KNOB_FRACTION_STEP = 0.4

// How far (screen pixels) a pointer has to move from its touch-down point
// before a gesture counts as an actual drag rather than a stationary tap —
// see downPointRef's own comment in useAdjusterDrag for why this matters.
// Standard click-vs-drag tolerance, same ballpark browsers themselves use.
const DRAG_THRESHOLD_PX = 4

// Inverse of arcPath.ts's polarToCartesian: 0deg = up, increasing clockwise,
// matching startAngle/endAngle's "clock position" reading — then
// counter-rotated back into the widget's own unrotated frame, since
// startAngle/endAngle are themselves defined in that frame. `rotateAngle` is
// the widget's own resolved rotateAngle/rotateAngleExpr (see
// AdjusterWidget.tsx) — the CSS transform that spins the whole widget (see
// this hook's own bug report: without this, the drag math kept measuring the
// pointer against true screen-up while the knob's own "up" had visually
// rotated away from it, so the handle tracked the mouse at an offset instead
// of following it directly). getBoundingClientRect() still correctly centers
// on the widget's true center even when rotated (rotation is around the
// element's own center by default, so the enlarged rotated bounding box
// stays centered on the same point) — only the ANGLE needs correcting, not
// cx/cy.
function knobAngleFromEvent(e: React.PointerEvent, rect: DOMRect, rotateAngle: number): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90 - rotateAngle
}

// Maps a pointer event to a 0..1 fraction along the widget's drag axis
// (slider: position along the track; knob: angle around the center),
// clamped to the configured range. For a knob, this ABSOLUTE mapping is only
// ever used for the touch-down sample (tap directly on the arc to jump the
// handle there) — see knobDeltaFraction below for every sample after that.
function fractionFromEvent(widget: AdjusterWidget, e: React.PointerEvent, rect: DOMRect, rotateAngle: number): number {
  if (widget.type === 'adjuster-knob') {
    const angleDeg = knobAngleFromEvent(e, rect, rotateAngle)
    const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
    const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
    // Bisect the dead zone (the gap NOT covered by the sweep, between
    // endAngle and startAngle+360) at its own midpoint, rather than
    // wrapping the raw angle up from startAngle directly. That old approach
    // dumped the ENTIRE dead zone onto the max end — any angle just short of
    // startAngle (on the wrong side of it) got pushed a full 360° past
    // endAngle instead of clamping to the min end it's actually closest to,
    // so dragging slightly past the min stop popped the handle to max
    // instead of clamping at min (see this fix's own bug report). Centering
    // the wraparound seam on the dead zone's own midpoint instead makes
    // "which side of the gap this angle is on" fall out of the same
    // modular-arithmetic trick for free, since the whole sweep then sits
    // comfortably in the middle of the normalized window with room to spare
    // on both sides.
    const deadZoneMid = endAngle + (360 - (endAngle - startAngle)) / 2
    let normalized = angleDeg
    while (normalized < deadZoneMid - 360) normalized += 360
    while (normalized >= deadZoneMid) normalized -= 360
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

// Next fraction for a knob mid-drag, from the ANGULAR DELTA since the last
// sample rather than fractionFromEvent's absolute angle — so the dead zone
// (the unused gap between endAngle and startAngle+360) can never be crossed
// in one motion: once the displayed fraction is already pinned at 0 or 1,
// continuing to rotate the same way just keeps adding delta that gets
// clamped away, and the ONLY way off that end is a delta in the other
// direction, i.e. actually reversing the drag. That's the point — a real
// knob can't be spun straight through its own end stop, and this makes the
// on-screen one behave the same way, rather than the old absolute-angle
// mapping's habit of popping straight to the other end the moment a drag
// continued past a stop into the gap.
//
// Returns BOTH the clamped, displayable fraction AND the unclamped
// `virtualFraction` the caller should feed back in as `previousVirtual` next
// time — tracking the unclamped value (rather than just re-clamping the
// previous displayed 1/0 every time) is what makes reversing off an end
// stop require winding back through the exact overshoot first: if you kept
// dragging 30° past the stop, `virtualFraction` sits at (say) 1.15 the whole
// time the display reads a pinned 1, and the first 30°-worth of reversal
// only brings virtualFraction back down to 1 — the display doesn't actually
// start moving (and your finger doesn't fall out of sync with it) until
// after that, exactly matching how far you overshot. Losing the overshoot
// (clamping the accumulator itself, not just the display) is what used to
// make the dial immediately follow the very first reversal sample even
// though the finger was still well past the stop.
// `previousAngle` null (nothing sampled yet, e.g. this is pointerdown itself)
// treats delta as 0 — the caller is expected to seed lastAngleRef from this
// same sample instead of calling this before there's a previous one.
function knobDeltaFraction(
  widget: AdjusterKnobWidget,
  angle: number,
  previousAngle: number | null,
  previousVirtual: number
): { fraction: number; virtualFraction: number } {
  let delta = previousAngle === null ? 0 : angle - previousAngle
  // Shortest-path wrap — two consecutive samples landing on opposite sides
  // of the ±180° seam shouldn't register as a near-360° swing the wrong way
  // (same correction useEncoderDrag.ts's own angle delta uses).
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
  const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
  const fractionDelta = delta / (endAngle - startAngle)
  const capped = Math.max(-MAX_KNOB_FRACTION_STEP, Math.min(MAX_KNOB_FRACTION_STEP, fractionDelta))
  const virtualFraction = previousVirtual + capped
  return { fraction: Math.min(1, Math.max(0, virtualFraction)), virtualFraction }
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
  // ?? [] guards a dashboard saved before these existed — see
  // ButtonWidget.events' own comment in shared/types.ts for the convention.
  const hasDoublePress = (widget.events.doublePress ?? []).length > 0
  const hasTriplePress = (widget.events.triplePress ?? []).length > 0
  const multiPressEnabled = hasDoublePress || hasTriplePress
  const { registerTap } = useMultiPressArbiter(widget.id, hasDoublePress, hasTriplePress)
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
  // True once handlePointerMove has actually seen movement this gesture —
  // distinguishes a real drag from a tap that's only down long enough for
  // the doublePress/triplePress arbiter to be deciding what it is. Only
  // matters when multiPressEnabled: a tap-then-release with no movement in
  // between shouldn't also commit a 'move' to wherever it happened to land
  // (see handlePointerDown/handlePointerUp below) — that's what used to make
  // configuring doublePress on this widget also nudge its position on every
  // tap, single or multi.
  const draggedRef = useRef(false)
  // Screen position at touch-down — draggedRef only actually flips to true
  // once a pointermove sample lands more than DRAG_THRESHOLD_PX away from
  // this (see handlePointerMove below), not on the first pointermove event
  // no matter how small. A mouse "double-click" routinely reports a pixel or
  // two of movement between/during the two clicks even though the user's
  // intent was two stationary taps — without this threshold, that jitter
  // alone was enough to mark the gesture as dragged, which committed a
  // phantom 'move' to wherever that jitter happened to land (see
  // draggedRef's own comment) and immediately overwrote whatever the
  // doublePress/triplePress action that same gesture fired had just set.
  const downPointRef = useRef<{ x: number; y: number } | null>(null)
  // Unclamped running fraction for a knob mid-drag — knobDeltaFraction's
  // delta gets added onto this every sample, and only the CLAMPED result is
  // ever shown/sent (see its own comment for why the accumulator itself has
  // to stay unclamped, tracking overshoot past an end stop rather than
  // discarding it). Only meaningful mid-gesture; reset on every pointerDown,
  // unused for the slider style (see the `widget.style === 'knob'` guards
  // below).
  const virtualFractionRef = useRef(0)
  // Raw angle (degrees) of the previous knob-style sample — knobDeltaFraction
  // measures each new sample against this rather than an absolute position,
  // so a knob can't be dragged straight through its own end stop (see that
  // function's own comment). Seeded at touch-down, null once a gesture isn't
  // in flight; unused for the slider style.
  const lastAngleRef = useRef<number | null>(null)
  // Same resolution AdjusterWidgetContent itself uses to build the CSS
  // transform — kept in sync here so the drag math counter-rotates by
  // exactly what the widget is actually visually rotated by right now.
  const rotateAngle = (widget.rotateAngleExpr ? resolveNumericExpr(widget.rotateAngleExpr, variables) : undefined) ?? widget.rotateAngle ?? 0

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
      triggerWidget(widget.id, 'move', value, false)
    })
  }

  // Shared by handlePointerMove/handlePointerUp — knob style tracks the
  // angular delta since the last sample (see knobDeltaFraction's own
  // comment); slider style has no dead zone to worry about, so it stays on
  // the plain absolute mapping.
  function nextFraction(e: React.PointerEvent, rect: DOMRect): number {
    if (widget.type !== 'adjuster-knob') return fractionFromEvent(widget, e, rect, rotateAngle)
    const angle = knobAngleFromEvent(e, rect, rotateAngle)
    const { fraction, virtualFraction } = knobDeltaFraction(widget, angle, lastAngleRef.current, virtualFractionRef.current)
    lastAngleRef.current = angle
    virtualFractionRef.current = virtualFraction
    return fraction
  }

  function handlePointerDown(e: React.PointerEvent): void {
    draggingRef.current = true
    draggedRef.current = false
    downPointRef.current = { x: e.clientX, y: e.clientY }
    const rect = e.currentTarget.getBoundingClientRect()
    dragRectRef.current = rect
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handleResizePointerDown
    }
    const fraction = fractionFromEvent(widget, e, rect, rotateAngle)
    // No prior sample this drag to jump away from, so the touch-down point
    // itself is always accepted as-is — knobDeltaFraction only takes over
    // from the very next sample (lastAngleRef/virtualFractionRef seeded here
    // are that baseline).
    if (widget.type === 'adjuster-knob') {
      lastAngleRef.current = knobAngleFromEvent(e, rect, rotateAngle)
      virtualFractionRef.current = fraction
    }
    setDragFraction(fraction)
    // Fires once, immediately (unless doublePress/triplePress are actually
    // configured, in which case the arbiter briefly holds it back to see if
    // another touch-down follows — see useMultiPressArbiter's own comment)
    // — a new, explicit press-ish event ahead of the throttled 'move' ticks
    // below. Preserves "fires on first touch" legacy behavior, previously
    // folded into the very first scheduleSend call.
    dragValueRef.current = valueFor(fraction)
    if (multiPressEnabled) registerTap(dragValueRef.current)
    else triggerWidget(widget.id, 'press', dragValueRef.current)
    // Skipped while multiPressEnabled — see draggedRef's own comment. A tap
    // that's still being arbitrated shouldn't snap the value to the
    // touch-down point; handlePointerMove below re-arms this the moment real
    // movement actually happens.
    if (!multiPressEnabled) scheduleSend(fraction)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    const rect = dragRectRef.current
    if (!rect) return
    if (!draggedRef.current) {
      // Not yet past the click-vs-drag tolerance — see downPointRef's own
      // comment. Bail before touching lastAngleRef/scheduleSend at all, so
      // once real movement does arrive its delta is measured against the
      // ORIGINAL touch-down sample, not an intermediate jitter one.
      const down = downPointRef.current
      const movedPx = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : Infinity
      if (movedPx < DRAG_THRESHOLD_PX) return
      draggedRef.current = true
    }
    const fraction = nextFraction(e, rect)
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
    const fraction = nextFraction(e, rect)
    lastAngleRef.current = null
    const value = valueFor(fraction)
    pendingFractionRef.current = null
    // Gesture's over — lets the reconciliation effect above act on the next
    // variables update instead of ignoring it as a stale mid-drag echo.
    draggingRef.current = false
    if (multiPressEnabled && !draggedRef.current) {
      // Never actually dragged — this gesture was just a tap the arbiter is
      // (or was) deciding between press/doublePress/triplePress (see
      // draggedRef's own comment). Don't commit a phantom position for a
      // gesture that never moved the widget; fall the visual back to
      // whatever valueExpr already resolves to instead of getting stuck
      // showing wherever this tap happened to land.
      dragValueRef.current = null
      setDragFraction(undefined)
    } else {
      setDragFraction(fraction)
      // Final, unthrottled 'move' send — guarantees the last position
      // commits even if a scheduled rAF tick from scheduleSend was still
      // pending. Also final in the triggerWidget/runUpdateState sense (the
      // default when omitted) — the settled value gets a synchronous save,
      // same as a plain press/release, rather than the debounced save every
      // in-flight tick above uses.
      dragValueRef.current = value
      triggerWidget(widget.id, 'move', value)
    }
    // A new, separate 'release' event — same value, its own (possibly
    // empty) sequence. Fires regardless of whether this gesture ever
    // actually dragged the widget (see the branch above) — same as
    // press/doublePress/triplePress, arbitrating what a tap means doesn't
    // affect this at all.
    triggerWidget(widget.id, 'release', value)
  }

  return { dragFraction, handlePointerDown, handlePointerMove, handlePointerUp }
}
