import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from './store'
import { resolveActivePositionIndex } from '@shared/switchPosition'
import type { VariableMap } from '@shared/expr'
import type { DropdownWidget, SwitchWidget } from '@shared/types'

// How long a manual selection holds the picked position against a stale
// exprIndex before giving up and trusting the live value regardless (see
// `pending` below) — generous relative to a normal DCS-BIOS round trip
// (command out, sim state changes, next export tick, variables:sync back),
// which is usually well under a few hundred ms, but short enough that a
// genuinely-unconfirmable mapping (activePositionExpr pointing at the wrong
// variable, DCS-BIOS disabled, ...) doesn't leave the switch looking "stuck"
// on the tapped position indefinitely.
const PENDING_CONFIRM_TIMEOUT_MS = 1500

// Which position a switch (or dropdown — same positions/activePositionExpr
// shape, see DropdownWidget's own comment) widget shows on THIS client, for
// the deployed view client only (see CanvasWidget's own simpler inline
// resolve for the editor's static preview, which has no tap/hold gesture to
// track). widget.activePositionExpr (when set and resolvable) always wins
// once `pending` (below) isn't overriding it; with no expr, this remembers
// whichever position was last tapped/selected locally on this device,
// defaulting to positions[0] — deliberately not synced with any other
// client, see SwitchWidgetBase's own comment in shared/types.ts.
//
// RockerSwitchWidget.settleToInactive (see its own comment in shared/
// types.ts) is the one exception to that positions[0] default — with it on,
// `localIndex` starts at, and always reverts to, null instead: nothing's
// active on load, and a tap's own highlight doesn't stick. `activeIndex`
// being `null` is only ever actually reachable that way — every other
// widget type (and a rocker with the setting off) always resolves to a real
// index, but the return type stays nullable across the board since this one
// hook serves all of them.
export function useSwitchPosition(
  widget: SwitchWidget | DropdownWidget,
  variables: VariableMap
): { activeIndex: number | null; select: (index: number) => void; settleInactive: () => void } {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const settleToInactive = widget.type === 'switch-rocker' && (widget.settleToInactive ?? false)
  const [localIndex, setLocalIndex] = useState<number | null>(() => (settleToInactive ? null : 0))
  const exprIndex = resolveActivePositionIndex(widget.positions, widget.activePositionExpr, variables)

  // A just-picked position, held against exprIndex until either exprIndex
  // itself confirms it (the real DCS-BIOS round trip caught up) or the
  // timeout above gives up. Without this, exprIndex re-evaluates against
  // this render's (still-stale, pre-round-trip) `variables` the instant a
  // selection lands, briefly overriding the tap with the OLD position before
  // the real update arrives and flips it forward again — a visible
  // flip-back-then-forward on every selection of an expr-bound switch.
  const [pending, setPending] = useState<number | null>(null)
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (pending !== null && exprIndex === pending) {
      clearTimeout(pendingTimeoutRef.current)
      setPending(null)
    }
  }, [exprIndex, pending])

  // Only the pending timeout needs cleanup on unmount — clearing `pending`
  // itself would be a no-op on an unmounted component.
  useEffect(() => () => clearTimeout(pendingTimeoutRef.current), [])

  const activeIndex = pending ?? exprIndex ?? (localIndex === null ? null : Math.min(localIndex, widget.positions.length - 1))

  // DialSwitchWidget-only (see its own comment in shared/types.ts) — skips
  // the optimistic `pending` hold below entirely, so a select() never makes
  // activeIndex jump ahead of exprIndex; the needle only moves once the
  // live expression itself catches up.
  const waitForStateConfirm = widget.type === 'switch-dial' && (widget.waitForStateConfirm ?? false)

  function select(index: number): void {
    const previousIndex = activeIndex
    setLocalIndex(settleToInactive ? null : index)
    // Only meaningful when this switch actually has a live-bound expr — a
    // plain manually-driven switch has no stale readback to race against,
    // so localIndex above already takes effect immediately with nothing to
    // hold against.
    if (widget.activePositionExpr && !waitForStateConfirm) {
      clearTimeout(pendingTimeoutRef.current)
      setPending(index)
      pendingTimeoutRef.current = setTimeout(() => setPending(null), PENDING_CONFIRM_TIMEOUT_MS)
    }
    triggerWidget(widget.id, 'select', index)
    // DialSwitchWidget only — see its own events.increment/decrement doc
    // comment in shared/types.ts. Landing on a higher/lower index than
    // whichever was active before fires the matching 'Turn CW'/'Turn CCW'
    // trigger too, alongside (not instead of) 'select' above.
    if (widget.type === 'switch-dial' && previousIndex !== null && index !== previousIndex) {
      triggerWidget(widget.id, index > previousIndex ? 'increment' : 'decrement', index)
    }
  }

  // RockerSwitchWidget.settleToInactive only (see its own comment in
  // shared/types.ts) — called separately from select() above, on release
  // rather than press (see RockerSwitchWidgetContent's onRelease), so a
  // press-and-hold shows the tapped position active for as long as it's
  // held instead of instantly flashing back to nothing. -1 is the sentinel
  // triggerAction (main/index.ts) reads as "run onInactive, not a real
  // positions[] entry." A no-op for every other widget type/setting, so
  // callers don't need to gate on settleToInactive themselves.
  function settleInactive(): void {
    if (settleToInactive) triggerWidget(widget.id, 'select', -1)
  }

  return { activeIndex, select, settleInactive }
}
