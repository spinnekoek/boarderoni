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
    borderColor: withOpacity(borderColor, state.borderOpacity ?? 1)
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
