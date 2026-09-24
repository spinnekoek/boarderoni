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

type PositionStyle = Partial<Pick<SwitchPosition, (typeof POSITION_STYLE_KEYS)[number]>> & { name: string; labels: LabelStyle[] }

function stylePositions(positions: SwitchPosition[]): PositionStyle[] {
  return positions.map((position) => ({ ...pick(position, POSITION_STYLE_KEYS), name: position.name, labels: styleLabels(position.labels) }))
}

// Matched by `name`, not array index — a position/state is user-renamed and
// reordered freely (see PropertiesPanel.tsx), so "index 1" in the source
// isn't reliably "index 1" in the target. A source entry with no
// same-named counterpart in the target is just skipped — copy style never
// creates positions/states that aren't already there.
function applyPositionStyles(positions: SwitchPosition[], styles: PositionStyle[]): SwitchPosition[] {
  return positions.map((position) => {
    const style = styles.find((s) => s.name === position.name)
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
  'borderOpacity',
  'glowColor',
  'glowColorExpr',
  'glowOpacity'
] as const satisfies readonly (keyof WidgetState)[]

type StateStyle = Partial<Pick<WidgetState, (typeof STATE_STYLE_KEYS)[number]>> & { name: string; labels: LabelStyle[] }

function styleStates(states: WidgetState[]): StateStyle[] {
  return states.map((state) => ({ ...pick(state, STATE_STYLE_KEYS), name: state.name, labels: styleLabels(state.labels) }))
}

// Matched by `name`, not array index — see applyPositionStyles' comment
// above, same reasoning applies to states (e.g. a source's "Clicked" style
// has nowhere to go if the target hasn't had that state enabled/added yet).
function applyStateStyles(states: WidgetState[], styles: StateStyle[]): WidgetState[] {
  return states.map((state) => {
    const style = styles.find((s) => s.name === state.name)
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
  'circleIndentOpacity',
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

function extractBarGaugeStyle(widget: Extract<Widget, { type: 'gauge-bar' }>) {
  return {
    ...pick(widget, ['orientation', 'fill', 'track', ...BOX_BORDER_KEYS] as const),
    labels: styleLabels(widget.labels)
  }
}

function extractArcGaugeStyle(widget: Extract<Widget, { type: 'gauge-arc' }>) {
  return {
    ...pick(widget, ['startAngle', 'endAngle', 'fill', 'track'] as const),
    labels: styleLabels(widget.labels)
  }
}

function extractAdjusterSliderStyle(widget: Extract<Widget, { type: 'adjuster-slider' }>) {
  return {
    ...pick(widget, ['orientation', 'fill', 'track', ...BOX_BORDER_KEYS] as const),
    labels: styleLabels(widget.labels)
  }
}

function extractAdjusterKnobStyle(widget: Extract<Widget, { type: 'adjuster-knob' }>) {
  return {
    ...pick(widget, [
      'startAngle',
      'endAngle',
      'fill',
      'track',
      'borderColor',
      'borderColorExpr',
      'borderOpacity',
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

// Same look fields as a screen capture plus its border width/radius. Crop
// (tuned per component's bezel) and the streaming knobs (streamMode/fps/
// quality/tapToStream) are behavior, not style, so they stay put.
function extractDcsViewportStyle(widget: Extract<Widget, { type: 'dcs-viewport' }>) {
  return pick(widget, [
    'fit',
    'brightness',
    'contrast',
    'saturation',
    'sharpen',
    'borderColor',
    'borderColorExpr',
    'borderOpacity',
    'borderWidth',
    'borderRadius'
  ] as const)
}

// Rotation is geometry (like x/y/w/h), not style, so it isn't carried.
function extractLineStyle(widget: Extract<Widget, { type: 'line' }>) {
  return pick(widget, ['color', 'colorExpr', 'lineWidth'] as const)
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
    case 'gauge-bar':
      return { widgetType: widget.type, data: extractBarGaugeStyle(widget) }
    case 'gauge-arc':
      return { widgetType: widget.type, data: extractArcGaugeStyle(widget) }
    case 'adjuster-slider':
      return { widgetType: widget.type, data: extractAdjusterSliderStyle(widget) }
    case 'adjuster-knob':
      return { widgetType: widget.type, data: extractAdjusterKnobStyle(widget) }
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
    case 'dcs-viewport':
      return { widgetType: widget.type, data: extractDcsViewportStyle(widget) }
    case 'line':
      return { widgetType: widget.type, data: extractLineStyle(widget) }
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
    case 'gauge-bar': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractBarGaugeStyle>
      return { ...widget, ...rest, labels: applyLabelStyles(widget.labels, labels) }
    }
    case 'gauge-arc': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractArcGaugeStyle>
      return { ...widget, ...rest, labels: applyLabelStyles(widget.labels, labels) }
    }
    case 'adjuster-slider': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractAdjusterSliderStyle>
      return { ...widget, ...rest, labels: applyLabelStyles(widget.labels, labels) }
    }
    case 'adjuster-knob': {
      const { labels, ...rest } = entry.data as ReturnType<typeof extractAdjusterKnobStyle>
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
    case 'dcs-viewport': {
      const rest = entry.data as ReturnType<typeof extractDcsViewportStyle>
      return { ...widget, ...rest }
    }
    case 'line': {
      const rest = entry.data as ReturnType<typeof extractLineStyle>
      return { ...widget, ...rest }
    }
    case 'label': {
      const { label } = entry.data as ReturnType<typeof extractLabelStyle>
      return { ...widget, label: { ...widget.label, ...label } }
    }
  }
}
