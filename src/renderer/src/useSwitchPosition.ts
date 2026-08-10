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
export function useSwitchPosition(
  widget: SwitchWidget | DropdownWidget,
  variables: VariableMap
): { activeIndex: number; select: (index: number) => void } {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const [localIndex, setLocalIndex] = useState(0)
  const exprIndex = resolveActivePositionIndex(widget.positions, widget.activePositionExpr, variables)
  const activeIndex = exprIndex ?? Math.min(localIndex, widget.positions.length - 1)

  function select(index: number): void {
    setLocalIndex(index)
    triggerWidget(widget.id, 'select', index)
  }

  return { activeIndex, select }
}
