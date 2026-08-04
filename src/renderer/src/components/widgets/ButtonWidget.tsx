import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, withOpacity } from '@shared/color'
import type { ButtonWidget, WidgetState } from '@shared/types'
import { renderWidgetLabels } from './labels'

export function ButtonWidgetContent({
  widget,
  state,
  interactive,
  error,
  onTrigger
}: {
  widget: ButtonWidget
  state: WidgetState
  interactive: boolean
  error?: string
  onTrigger?: () => void
}): React.JSX.Element {
  const backgroundColor = state.color ?? DEFAULT_WIDGET_COLOR
  const borderColor = state.borderColor ?? pickAutoBorderColor(backgroundColor)

  const buttonStyle: React.CSSProperties = {
    backgroundColor: withOpacity(backgroundColor, state.backgroundOpacity ?? 1),
    borderColor: withOpacity(borderColor, state.borderOpacity ?? 1),
    // Inset (not margin) — the button is absolutely positioned within its
    // widget box (see .deck-button), so this is what actually lets a
    // negative value expand it past that box instead of just overflowing.
    top: state.spacingTop ?? 0,
    right: state.spacingRight ?? 0,
    bottom: state.spacingBottom ?? 0,
    left: state.spacingLeft ?? 0,
    // Unset corners default to 4 — an explicit 0 is a deliberate sharp
    // corner, not "unconfigured", so it must stay distinct from undefined.
    borderRadius: `${state.radiusTopLeft ?? 4}px ${state.radiusTopRight ?? 4}px ${state.radiusBottomRight ?? 4}px ${state.radiusBottomLeft ?? 4}px`,
    // Left unset, this stays 'auto' (CSS default) and the widget falls back
    // to plain paint order (see bringToFront/sendToBack in store.ts) —
    // explicit z-index here overrides that per-state, e.g. to pop a
    // "Clicked" state above whatever it's overlapping while held.
    ...(state.zIndex !== undefined && { zIndex: state.zIndex })
  }

  const labelElements = renderWidgetLabels(state.labels, backgroundColor)

  if (interactive) {
    return (
      <button className="deck-button" style={buttonStyle} onClick={onTrigger} title={widget.action.keys.join(' + ')}>
        {labelElements}
        {error && <span className="deck-button__error">{error}</span>}
      </button>
    )
  }

  return (
    <div className="deck-button deck-button--static" style={buttonStyle}>
      {labelElements}
    </div>
  )
}
