import { useState } from 'react'
import { resolveBooleanExpr, type VariableMap } from '@shared/expr'
import type { ToggleSwitchWidget } from '@shared/types'

// Same "local tap state, optional expr override" convention as
// useSwitchPosition.ts's own activeIndex — closed (false) is always the
// starting local state, flipped by tapping either the closed cover or the
// open tab (see ToggleSwitchWidgetContent's own guard/guard-tab render,
// wired to this same onGuardToggle for both — each only ever renders in the
// state where flipping is the right action, so a plain flip works for
// both); widget.guardOpenExpr, once set and resolvable, always wins over it
// instead, same precedence activePositionExpr has over a switch's own local
// tap state.
export function useSwitchGuard(widget: ToggleSwitchWidget, variables: VariableMap): { open: boolean; toggle: () => void } {
  const [localOpen, setLocalOpen] = useState(false)
  const exprOpen = widget.guardOpenExpr ? resolveBooleanExpr(widget.guardOpenExpr, variables) : undefined
  const open = exprOpen ?? localOpen

  function toggle(): void {
    setLocalOpen((o) => !o)
  }

  return { open, toggle }
}
