import { tryEvaluateExpression, type VariableMap } from './expr'
import type { SwitchPosition } from './types'

// Resolves which position a switch widget's activePositionExpr names, by
// exact `name` match — same convention as ButtonWidget.activeStateExpr (see
// resolveBaseState in shared/states.ts). Returns undefined for every failure
// mode (expr unset, throws, returns a non-string, or names a position that
// doesn't exist) — the caller falls back to its own local per-client
// selection rather than a shared error state, since a switch's position is
// deliberately NOT persisted/broadcast dashboard state on its own (see
// SwitchWidgetBase's own comment in shared/types.ts).
export function resolveActivePositionIndex(
  positions: SwitchPosition[],
  activePositionExpr: string | undefined,
  variables: VariableMap
): number | undefined {
  if (!activePositionExpr) return undefined
  const result = tryEvaluateExpression(activePositionExpr, variables)
  if (!result.ok || typeof result.value !== 'string') return undefined
  const index = positions.findIndex((p) => p.name === result.value)
  return index === -1 ? undefined : index
}
