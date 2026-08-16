import { useState } from 'react'
import { useDashboardStore } from './store'
import { resolveActivePositionIndex } from '@shared/switchPosition'
import type { VariableMap } from '@shared/expr'
import type { DropdownWidget, SwitchWidget } from '@shared/types'

// Which position a switch (or dropdown — same positions/activePositionExpr
// shape, see DropdownWidget's own comment) widget shows on THIS client, for
// the deployed view client only (see CanvasWidget's own simpler inline
// resolve for the editor's static preview, which has no tap/hold gesture to
// track). widget.activePositionExpr (when set and resolvable) always wins;
// otherwise this remembers whichever position was last tapped/selected
// locally on this device, defaulting to positions[0] — deliberately not
// synced with any other client, see SwitchWidgetBase's own comment in
// shared/types.ts.
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
): { activeIndex: number | null; select: (index: number) => void } {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const settleToInactive = widget.type === 'switch-rocker' && (widget.settleToInactive ?? false)
  const [localIndex, setLocalIndex] = useState<number | null>(() => (settleToInactive ? null : 0))
  const exprIndex = resolveActivePositionIndex(widget.positions, widget.activePositionExpr, variables)
  const activeIndex = exprIndex ?? (localIndex === null ? null : Math.min(localIndex, widget.positions.length - 1))

  function select(index: number): void {
    const previousIndex = activeIndex
    setLocalIndex(settleToInactive ? null : index)
    triggerWidget(widget.id, 'select', index)
    // DialSwitchWidget only — see its own events.increment/decrement doc
    // comment in shared/types.ts. Landing on a higher/lower index than
    // whichever was active before fires the matching 'Turn CW'/'Turn CCW'
    // trigger too, alongside (not instead of) 'select' above.
    if (widget.type === 'switch-dial' && previousIndex !== null && index !== previousIndex) {
      triggerWidget(widget.id, index > previousIndex ? 'increment' : 'decrement', index)
    }
  }

  return { activeIndex, select }
}
