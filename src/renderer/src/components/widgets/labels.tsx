import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { resolveFont, DEFAULT_LABEL_LINE_HEIGHT } from '@shared/fonts'
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
export function renderWidgetLabel(
  label: WidgetLabel,
  backgroundColor: string,
  variables: VariableMap,
  debugMode: boolean = false
): React.JSX.Element {
  const resolvedTextColor = resolveTextColor(label, backgroundColor, variables)
  const labelBackgroundColor = label.backgroundColor ? withOpacity(label.backgroundColor, label.backgroundOpacity ?? 1) : 'transparent'
  const padding = label.padding ?? DEFAULT_WIDGET_PADDING
  const align = label.align ?? 'center'
  const verticalAlign = label.verticalAlign ?? 'center'
  // CSS padding can't go negative — the browser drops the whole declaration
  // rather than clamping it, so a negative value would silently act like 0.
  // What actually reaches `padding` below is clamped at 0; anything past
  // that instead pushes the label beyond its own edge via translate, in
  // whichever direction align/verticalAlign already anchor it to (center on
  // either axis has no edge to push past, so it stays a no-op there — same
  // as positive padding already was at center).
  const overflow = Math.min(padding, 0)
  const dx = (align === 'left' ? overflow : align === 'right' ? -overflow : 0) + (label.offsetX ?? 0)
  const dy = (verticalAlign === 'top' ? overflow : verticalAlign === 'bottom' ? -overflow : 0) + (label.offsetY ?? 0)
  const rotation = label.rotation ?? 0
  const transformParts: string[] = []
  if (dx !== 0 || dy !== 0) transformParts.push(`translate(${dx}px, ${dy}px)`)
  if (rotation !== 0) transformParts.push(`rotate(${rotation}deg)`)
  const font = resolveFont(label.fontFamily)
  const labelStyle: React.CSSProperties = {
    padding: Math.max(padding, 0),
    transform: transformParts.length > 0 ? transformParts.join(' ') : undefined,
    fontFamily: font.cssFamily,
    fontSize: label.fontSize ?? DEFAULT_WIDGET_FONT_SIZE,
    // Overrides the CSS class's own line-height (styles.css's
    // .deck-button__label) for a custom font that needs a different value —
    // see FontOption.lineHeight's own comment for why this can't just be a
    // per-label field like fontSize/color are.
    lineHeight: font.lineHeight ?? DEFAULT_LABEL_LINE_HEIGHT,
    color: withOpacity(resolvedTextColor.color, resolvedTextColor.opacity ?? label.textOpacity ?? 1),
    justifyContent: JUSTIFY_CONTENT[align],
    alignItems: ALIGN_ITEMS[verticalAlign],
    textAlign: label.textAlign ?? align
  }
  return (
    <span key={label.id} className={`deck-button__label${debugMode ? ' deck-button__label--debug' : ''}`} style={labelStyle}>
      <span className="deck-button__label-content" style={{ backgroundColor: labelBackgroundColor }}>
        {renderLabelContent(resolveLabelText(label, variables))}
      </span>
    </span>
  )
}

// Each label is its own absolutely-positioned overlay covering the full
// widget — they don't stack or affect each other's layout, so two labels
// sharing an align just overlap.
export function renderWidgetLabels(
  labels: WidgetLabel[],
  backgroundColor: string,
  variables: VariableMap,
  debugMode: boolean = false
): React.JSX.Element[] {
  // Every widget type funnels its labels[] through here — one guard against
  // a corrupted/hand-edited save's missing array covers all of them, rather
  // than repeating `?? []` at each of their call sites.
  return (labels ?? []).map((label) => renderWidgetLabel(label, backgroundColor, variables, debugMode))
}
