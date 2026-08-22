import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { ButtonWidget, WidgetState } from '@shared/types'
import { actionTitle } from '@shared/actionTitle'
import { renderWidgetLabels } from './labels'
import { boxStyle } from './boxStyle'

export function ButtonWidgetContent({
  widget,
  state,
  interactive,
  error,
  variables,
  onKeyboardActivate
}: {
  widget: ButtonWidget
  state: WidgetState
  interactive: boolean
  error?: string
  variables: VariableMap
  // The real trigger fires on pointerdown/pointerup (see ViewCanvas.tsx's
  // press()/release()), not this onClick — this only covers keyboard/
  // assistive-tech activation, which dispatches a synthetic click with no
  // pointer events at all. Guarded by e.detail === 0 (see the onClick
  // handler below) so a real pointer/touch click doesn't also fire this and
  // double-trigger.
  onKeyboardActivate?: () => void
}): React.JSX.Element {
  const resolvedColor = resolveColor(state, variables)
  const backgroundColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
  const resolvedBorderColor = resolveBorderColor(state, variables)
  const borderColor = resolvedBorderColor.color ?? pickAutoBorderColor(backgroundColor)
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle

  const buttonStyle: React.CSSProperties = {
    ...boxStyle(state),
    backgroundColor: withOpacity(backgroundColor, resolvedColor.opacity ?? state.backgroundOpacity ?? 1),
    borderColor: withOpacity(borderColor, resolvedBorderColor.opacity ?? state.borderOpacity ?? 1),
    // Left unset, this stays 'auto' (CSS default) and the widget falls back
    // to plain paint order (see bringToFront/sendToBack in store.ts) —
    // explicit z-index here overrides that per-state, e.g. to pop a
    // "Clicked" state above whatever it's overlapping while held.
    ...(state.zIndex !== undefined && { zIndex: state.zIndex }),
    transform: rotateAngle ? `rotate(${rotateAngle}deg)` : undefined
  }

  const labelElements = renderWidgetLabels(state.labels, backgroundColor, variables)

  if (interactive) {
    return (
      <button
        className="deck-button"
        style={buttonStyle}
        onClick={(e) => {
          if (e.detail === 0) onKeyboardActivate?.()
        }}
        title={actionTitle(widget)}
      >
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
