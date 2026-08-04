import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, withOpacity } from '@shared/color'
import { resolveColor, type VariableMap } from '@shared/expr'
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
  onTrigger
}: {
  widget: ButtonWidget
  state: WidgetState
  interactive: boolean
  error?: string
  variables: VariableMap
  onTrigger?: () => void
}): React.JSX.Element {
  const backgroundColor = resolveColor(state, variables) ?? DEFAULT_WIDGET_COLOR
  const borderColor = state.borderColor ?? pickAutoBorderColor(backgroundColor)

  const buttonStyle: React.CSSProperties = {
    ...boxStyle(state),
    backgroundColor: withOpacity(backgroundColor, state.backgroundOpacity ?? 1),
    borderColor: withOpacity(borderColor, state.borderOpacity ?? 1),
    // Left unset, this stays 'auto' (CSS default) and the widget falls back
    // to plain paint order (see bringToFront/sendToBack in store.ts) —
    // explicit z-index here overrides that per-state, e.g. to pop a
    // "Clicked" state above whatever it's overlapping while held.
    ...(state.zIndex !== undefined && { zIndex: state.zIndex })
  }

  const labelElements = renderWidgetLabels(state.labels, backgroundColor, variables)

  if (interactive) {
    return (
      <button className="deck-button" style={buttonStyle} onClick={onTrigger} title={actionTitle(widget.action)}>
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
