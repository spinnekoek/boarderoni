import { DEFAULT_WIDGET_COLOR, lighten } from './color'
import { AUTO_CLICKED_LIGHTEN } from './constants'
import type { Widget, WidgetState } from './types'

export function deriveClickedState(base: WidgetState, id: string): WidgetState {
  return {
    ...base,
    id,
    name: 'Clicked',
    color: lighten(base.color ?? DEFAULT_WIDGET_COLOR, AUTO_CLICKED_LIGHTEN),
    isClicked: true
  }
}

// Resolves the [default, clicked] pair actually used at render time. With
// states disabled, "clicked" is always derived fresh from whatever "default"
// currently looks like — never read from storage — so anything saved past
// index 0 is preserved untouched but ignored until states are re-enabled.
//
// With states enabled, "clicked" is whichever stored state (if any) has
// isClicked set — not a positional guess — so deleting it means nothing
// plays on tap rather than some other state activating in its place.
export function getEffectiveStates(widget: Widget): [WidgetState, WidgetState | null] {
  const base = widget.states[0]
  if (widget.statesEnabled) {
    return [base, widget.states.find((s) => s.isClicked) ?? null]
  }
  return [base, deriveClickedState(base, `${base.id}__auto-clicked`)]
}
