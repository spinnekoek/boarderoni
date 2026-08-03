import { resolveFont } from '@shared/fonts'
import { pickLegibleTextColor, withOpacity } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import type { WidgetLabel } from '@shared/types'

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

// Each label is its own absolutely-positioned overlay covering the full
// widget, individually padded/aligned/styled — they don't stack or affect
// each other's layout, so two labels sharing an align just overlap. Shared
// between ButtonWidget and MorphButtonWidget since a widget's overall shape
// doesn't change how a single label renders within its box.
export function renderWidgetLabels(labels: WidgetLabel[], backgroundColor: string): React.JSX.Element[] {
  return labels.map((label) => {
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
}
