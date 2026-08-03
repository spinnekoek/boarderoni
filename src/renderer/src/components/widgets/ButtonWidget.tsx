import { resolveFont } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, pickLegibleTextColor, withOpacity } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import type { ButtonWidget, WidgetLabel, WidgetState } from '@shared/types'

const JUSTIFY_CONTENT: Record<NonNullable<WidgetLabel['align']>, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end'
}

const ALIGN_ITEMS: Record<NonNullable<WidgetLabel['verticalAlign']>, string> = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end'
}

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

  // Each label is its own absolutely-positioned overlay covering the full
  // button, individually padded/aligned/styled — they don't stack or affect
  // each other's layout, so two labels sharing an align just overlap.
  const labelElements = state.labels.map((label) => {
    const textColor = label.textColor ?? pickLegibleTextColor(backgroundColor)
    const labelStyle: React.CSSProperties = {
      padding: label.padding ?? DEFAULT_WIDGET_PADDING,
      fontFamily: resolveFont(label.fontFamily).cssFamily,
      fontSize: label.fontSize ?? DEFAULT_WIDGET_FONT_SIZE,
      color: withOpacity(textColor, label.textOpacity ?? 1),
      justifyContent: JUSTIFY_CONTENT[label.align ?? 'center'],
      alignItems: ALIGN_ITEMS[label.verticalAlign ?? 'center'],
      textAlign: label.align ?? 'center'
    }
    return (
      <span key={label.id} className="deck-button__label" style={labelStyle}>
        {label.text}
      </span>
    )
  })

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
