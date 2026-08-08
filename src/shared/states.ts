import { DEFAULT_WIDGET_COLOR, lighten } from './color'
import { AUTO_CLICKED_LIGHTEN } from './constants'
import { tryEvaluateExpression, type VariableMap } from './expr'
import type { StatefulWidget, WidgetState } from './types'

export function deriveClickedState(base: WidgetState, id: string): WidgetState {
  return {
    ...base,
    id,
    name: 'Clicked',
    color: lighten(base.color ?? DEFAULT_WIDGET_COLOR, AUTO_CLICKED_LIGHTEN),
    isClicked: true
  }
}

// Resolves which stored state stands in for "default": activeStateExpr,
// when set, names the state that should be active by exact `name` match —
// evaluated fresh on every call so it tracks live variable values. Any
// failure mode (expression unset, throws, returns a non-string, or names a
// state that doesn't exist) falls back to states[0] rather than surfacing an
// error on the view client — the expression only ever narrows which state is
// active, it never breaks rendering.
function resolveBaseState(widget: StatefulWidget, variables: VariableMap): WidgetState {
  const fallback = widget.states[0]
  if (!widget.statesEnabled || !widget.activeStateExpr) return fallback
  const result = tryEvaluateExpression(widget.activeStateExpr, variables)
  if (!result.ok || typeof result.value !== 'string') return fallback
  return widget.states.find((s) => s.name === result.value) ?? fallback
}

// Resolves the [default, clicked] pair actually used at render time. With
// states disabled, "clicked" is always derived fresh from whatever "default"
// currently looks like — never read from storage — so anything saved past
// index 0 is preserved untouched but ignored until states are re-enabled.
//
// With states enabled, "clicked" is whichever stored state (if any) has
// isClicked set — not a positional guess — so deleting it means nothing
// plays on tap rather than some other state activating in its place.
export function getEffectiveStates(widget: StatefulWidget, variables: VariableMap): [WidgetState, WidgetState | null] {
  const base = resolveBaseState(widget, variables)
  if (widget.statesEnabled) {
    return [base, widget.states.find((s) => s.isClicked) ?? null]
  }
  return [base, deriveClickedState(base, `${base.id}__auto-clicked`)]
}
