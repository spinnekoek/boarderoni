import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { resolveFont } from '@shared/fonts'
import { withOpacity } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import { resolveLabelText, resolveTextColor, type VariableMap } from '@shared/expr'
import { parseLabelContent } from '@shared/labelContent'
import type { WidgetLabel } from '@shared/types'
import { findIcon } from './faIcons'

// Turns a label's resolved text into its display nodes — `{{icon:fa-*}}`
// tokens become FontAwesome icons and ␤ becomes a line break (see
// shared/labelContent.ts for the token grammar, shared by both the plain
// `text` field and a `textExpr`'s returned string). An icon name with no
// match falls back to showing the raw token so a typo is visible rather than
// silently dropped.
function renderLabelContent(text: string): React.ReactNode[] {
  return parseLabelContent(text).map((part, i) => {
    if (part.kind === 'break') return <br key={i} />
    if (part.kind === 'icon') {
      const icon = findIcon(part.name)
      return icon ? <FontAwesomeIcon key={i} icon={icon} /> : `{{icon:${part.name}}}`
    }
    return part.value
  })
}

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

// A single label's own absolutely-positioned overlay covering its parent —
// individually padded/aligned/styled, so a caller can place multiple labels
// (see renderWidgetLabels below) or position just one on its own (DialSwitch
// positions, one detent-anchored wrapper per label — see DialSwitchWidget.tsx).
export function renderWidgetLabel(label: WidgetLabel, backgroundColor: string, variables: VariableMap): React.JSX.Element {
  const resolvedTextColor = resolveTextColor(label, backgroundColor, variables)
  const labelStyle: React.CSSProperties = {
    padding: label.padding ?? DEFAULT_WIDGET_PADDING,
    fontFamily: resolveFont(label.fontFamily).cssFamily,
    fontSize: label.fontSize ?? DEFAULT_WIDGET_FONT_SIZE,
    color: withOpacity(resolvedTextColor.color, resolvedTextColor.opacity ?? label.textOpacity ?? 1),
    justifyContent: JUSTIFY_CONTENT[label.align ?? 'center'],
    alignItems: ALIGN_ITEMS[label.verticalAlign ?? 'center'],
    textAlign: label.align ?? 'center'
  }
  return (
    <span key={label.id} className="deck-button__label" style={labelStyle}>
      <span className="deck-button__label-content">{renderLabelContent(resolveLabelText(label, variables))}</span>
    </span>
  )
}

// Each label is its own absolutely-positioned overlay covering the full
// widget — they don't stack or affect each other's layout, so two labels
// sharing an align just overlap.
export function renderWidgetLabels(labels: WidgetLabel[], backgroundColor: string, variables: VariableMap): React.JSX.Element[] {
  return labels.map((label) => renderWidgetLabel(label, backgroundColor, variables))
}
