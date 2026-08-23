import type { Widget, WidgetLabel, SwitchPosition, WidgetState } from '@shared/types'

// What "Copy style"/"Paste style" (see ContextMenu.tsx) actually carries
// between two widgets of the SAME type — deliberately just the visual look:
// colors, fonts, borders/radii, and (for a dial switch/encoder) dial shape/
// indicator/detent settings. Deliberately excludes position/size (x/y/w/h/
// cellW/cellH), structural data (blocks, a position's/state's own id/name/
// onSelect/momentary, a label's own id/text/textExpr), event sequences, and
// variable-bound behavior (valueExpr, active*Expr, interactionMode,
// expandMode, statesEnabled) — none of that is "the style."

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  return out
}

const LABEL_STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'textColor',
  'textColorExpr',
  'textOpacity',
  'align',
  'verticalAlign',
  'textAlign',
  'padding',
  'labelAnchor',
  'labelDistance'
] as const satisfies readonly (keyof WidgetLabel)[]

type LabelStyle = Partial<Pick<WidgetLabel, (typeof LABEL_STYLE_KEYS)[number]>>

function styleLabels(labels: WidgetLabel[]): LabelStyle[] {
  return labels.map((label) => pick(label, LABEL_STYLE_KEYS))
}

// Matched by index — a target with fewer/more labels than the source just
// leaves its extras untouched, same "best effort, no error" convention as
// cloneWidget's id regeneration.
function applyLabelStyles(labels: WidgetLabel[], styles: LabelStyle[]): WidgetLabel[] {
  return labels.map((label, i) => (styles[i] ? { ...label, ...styles[i] } : label))
}

const POSITION_STYLE_KEYS = [
  'color',
  'colorExpr',
  'backgroundOpacity',
  'borderOpacity',
  'activeColor',
  'activeColorExpr',
  'activeOpacity'
] as const satisfies readonly (keyof SwitchPosition)[]

type PositionStyle = Partial<Pick<SwitchPosition, (typeof POSITION_STYLE_KEYS)[number]>> & { labels: LabelStyle[] }

function stylePositions(positions: SwitchPosition[]): PositionStyle[] {
  return positions.map((position) => ({ ...pick(position, POSITION_STYLE_KEYS), labels: styleLabels(position.labels) }))
}

function applyPositionStyles(positions: SwitchPosition[], styles: PositionStyle[]): SwitchPosition[] {
  return positions.map((position, i) => {
    const style = styles[i]
    if (!style) return position
    return { ...position, ...style, labels: applyLabelStyles(position.labels, style.labels) }
  })
}

const STATE_STYLE_KEYS = [
  'spacingTop',
  'spacingRight',
  'spacingBottom',
  'spacingLeft',
  'radiusTopLeft',
  'radiusTopRight',
  'radiusBottomLeft',
  'radiusBottomRight',
  'borderWidthTop',
  'borderWidthRight',
  'borderWidthBottom',
  'borderWidthLeft',
  'color',
  'colorExpr',
  'borderColor',
  'borderColorExpr',
  'backgroundOpacity',
  'borderOpacity'
] as const satisfies readonly (keyof WidgetState)[]

type StateStyle = Partial<Pick<WidgetState, (typeof STATE_STYLE_KEYS)[number]>> & { labels: LabelStyle[] }

function styleStates(states: WidgetState[]): StateStyle[] {
  return states.map((state) => ({ ...pick(state, STATE_STYLE_KEYS), labels: styleLabels(state.labels) }))
}

function applyStateStyles(states: WidgetState[], styles: StateStyle[]): WidgetState[] {
  return states.map((state, i) => {
    const style = styles[i]
    if (!style) return state
    return { ...state, ...style, labels: applyLabelStyles(state.labels, style.labels) }
  })
}

// Shared by DialSwitchWidget's dial and EncoderWidget's grip — same
// DialShapeStyle fields either extends (see shared/types.ts). Covers both
// "dial shape" and "indicator settings" from the feature request; detents
// (switch-dial only, an encoder has no discrete positions) are added on top
// in extractDialStyle below.
const DIAL_SHAPE_KEYS = [
  'dialShape',
  'dialDistance',
  'squareWidth',
  'squareHeight',
  'squareBorderWidth',
  'squareBorderRadius',
  'squareColor',
  'squareBorderColor',
  'circleSize',
  'circleBorderWidth',
  'circleColor',
  'circleBorderColor',
  'circleIndentCount',
  'circleIndentSize',
  'circleIndentColor',
  'circleIndentDistance',
  'circleIndentShape',
  'indicatorShape',
  'indicatorStyle',
  'indicatorColor',
  'indicatorDistance',
  'indicatorSquareBorder'
] as const

const BOX_BORDER_KEYS = [
  'radiusTopLeft',
  'radiusTopRight',
  'radiusBottomLeft',
  'radiusBottomRight',
  'borderWidthTop',
  'borderWidthRight',
  'borderWidthBottom',
  'borderWidthLeft',
  'borderColor',
  'borderColorExpr',
  'borderOpacity'
] as const

function extractButtonStyle(widget: { states: WidgetState[] }) {
  return { states: styleStates(widget.states) }
}

function extractGaugeStyle(widget: Extract<Widget, { type: 'gauge' }>) {
  return {
    ...pick(widget, ['style', 'orientation', 'startAngle', 'endAngle', 'fill', 'track', ...BOX_BORDER_KEYS] as const),
    labels: styleLabels(widget.labels)
  }
}

function extractAdjusterStyle(widget: Extract<Widget, { type: 'adjuster' }>) {
  return {
    ...pick(widget, [
      'style',
      'orientation',
      'startAngle',
      'endAngle',
      'fill',
      'track',
      ...BOX_BORDER_KEYS,
      ...DIAL_SHAPE_KEYS,
      'bezelRadius',
      'bezelColor',
      'bezelOpacity',
      'bezelBorderWidth',
      'innerBezelRadius',
      'innerBezelColor',
      'innerBezelOpacity',
      'innerBezelBorderColor',
      'innerBezelBorderWidth'
    ] as const),
    labels: styleLabels(widget.labels)
  }
}

function extractEncoderStyle(widget: Extract<Widget, { type: 'encoder' }>) {
  return {
    ...pick(widget, [...DIAL_SHAPE_KEYS, 'fill', 'track', 'borderColor', 'borderColorExpr', 'borderOpacity'] as const),
    labels: styleLabels(widget.labels)
  }
}

function extractRockerStyle(widget: Extract<Widget, { type: 'switch-rocker' }>) {
  return {
    ...pick(widget, ['orientation', 'track', ...BOX_BORDER_KEYS] as const),
    positions: stylePositions(widget.positions)
  }
}

function extractDialStyle(widget: Extract<Widget, { type: 'switch-dial' }>) {
  return {
    ...pick(widget, [
      ...DIAL_SHAPE_KEYS,
      'startAngle',
      'endAngle',
      'track',
      'fill',
      'borderColor',
      'borderColorExpr',
      'borderOpacity',
      'detentShape',
      'detentRadius',
      'detentStyle'
    ] as const),
    labels: styleLabels(widget.labels),
    positions: stylePositions(widget.positions)
  }
}

function extractToggleStyle(widget: Extract<Widget, { type: 'switch-toggle' }>) {
  return {
    ...pick(widget, [
      'orientation',
      'track',
      'fill',
      'borderColor',
      'borderColorExpr',
      'borderOpacity',
      'bezelRadius',
      'bezelShape',
      'bezelRotation',
      'leverLength',
      'leverBorderColor',
      'leverBorderWidth',
      'leverTipRadius',
      'leverBaseRadius',
      'circleColor',
      'circleOpacity',
      'circleRadius',
      'circleBorderColor',
      'circleBorderWidth',
      'circleTopStyle',
      'innerBezelColor',
      'innerBezelOpacity',
      'innerBezelRadius',
      'innerBezelBorderColor',
      'innerBezelBorderWidth',
      'guard',
      'guardBorderWidth',
      'guardRadius'
    ] as const),
    labels: styleLabels(widget.labels),
    positions: stylePositions(widget.positions)
  }
}

function extractDropdownStyle(widget: Extract<Widget, { type: 'dropdown' }>) {
  return {
    ...pick(widget, ['orientation', 'track', ...BOX_BORDER_KEYS] as const),
    positions: stylePositions(widget.positions)
  }
}

function extractScreenCaptureStyle(widget: Extract<Widget, { type: 'screen-capture' }>) {
  return pick(widget, ['fit', 'brightness', 'contrast', 'saturation', 'sharpen', 'borderColor', 'borderColorExpr', 'borderOpacity'] as const)
}

function extractLabelStyle(widget: Extract<Widget, { type: 'label' }>) {
  return { label: pick(widget.label, LABEL_STYLE_KEYS) }
}

export interface StyleClipboardEntry {
  widgetType: Widget['type']
  data: unknown
}

export function extractWidgetStyle(widget: Widget): StyleClipboardEntry {
  switch (widget.type) {
    case 'button':
    case 'morph':
      return { widgetType: widget.type, data: extractButtonStyle(widget) }
    case 'gauge':
      return { widgetType: widget.type, data: extractGaugeStyle(widget) }
    case 'adjuster':
      return { widgetType: widget.type, data: extractAdjusterStyle(widget) }
    case 'encoder':
      return { widgetType: widget.type, data: extractEncoderStyle(widget) }
    case 'switch-rocker':
      return { widgetType: widget.type, data: extractRockerStyle(widget) }
    case 'switch-dial':
      return { widgetType: widget.type, data: extractDialStyle(widget) }
    case 'switch-toggle':
      return { widgetType: widget.type, data: extractToggleStyle(widget) }
    case 'dropdown':
      return { widgetType: widget.type, data: extractDropdownStyle(widget) }
    case 'screen-capture':
      return { widgetType: widget.type, data: extractScreenCaptureStyle(widget) }
    case 'label':
      return { widgetType: widget.type, data: extractLabelStyle(widget) }
  }
}

// Callers are expected to have already checked widget.type === entry.widgetType
// (see useStyleClipboardStore.pasteStyle) — that's what makes each cast below
// sound despite entry.data being typed unknown at the boundary.
export function applyWidgetStyle(widget: Widget, entry: StyleClipboardEntry): Widget {
  if (widget.type !== entry.widgetType) return widget
  switch (widget.type) {
    case 'button':
    case 'morph': {
      const { states } = entry.data as ReturnType<typeof extractButtonStyle>
      return { ...widget, states: applyStateStyles(widget.states, states) }
    }
    case 'gauge': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractGaugeStyle>
      return { ...widget, ...rest, labels: applyLabelStyles(widget.labels, labels) }
    }
    case 'adjuster': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractAdjusterStyle>
      return { ...widget, ...rest, labels: applyLabelStyles(widget.labels, labels) }
    }
    case 'encoder': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractEncoderStyle>
      return { ...widget, ...rest, labels: applyLabelStyles(widget.labels, labels) }
    }
    case 'switch-rocker': {
      const { positions, ...rest } = entry.data as ReturnType<typeof extractRockerStyle>
      return { ...widget, ...rest, positions: applyPositionStyles(widget.positions, positions) }
    }
    case 'switch-dial': {
      const { labels, positions, ...rest } = entry.data as ReturnType<typeof extractDialStyle>
      return {
        ...widget,
        ...rest,
        labels: applyLabelStyles(widget.labels, labels),
        positions: applyPositionStyles(widget.positions, positions)
      }
    }
    case 'switch-toggle': {
      const { labels, positions, ...rest } = entry.data as ReturnType<typeof extractToggleStyle>
      return {
        ...widget,
        ...rest,
        labels: applyLabelStyles(widget.labels, labels),
        positions: applyPositionStyles(widget.positions, positions)
      }
    }
    case 'dropdown': {
      const { positions, ...rest } = entry.data as ReturnType<typeof extractDropdownStyle>
      return { ...widget, ...rest, positions: applyPositionStyles(widget.positions, positions) }
    }
    case 'screen-capture': {
      const rest = entry.data as ReturnType<typeof extractScreenCaptureStyle>
      return { ...widget, ...rest }
    }
    case 'label': {
      const { label } = entry.data as ReturnType<typeof extractLabelStyle>
      return { ...widget, label: { ...widget.label, ...label } }
    }
  }
}
