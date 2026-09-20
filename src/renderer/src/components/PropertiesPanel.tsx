import { useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore, useGridSize, useCanvasSize } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useConfirmStore } from '../confirmStore'
import { nextId, isSectionOpen, setSectionOpen, getLastDcsAircraft, setLastDcsAircraft } from '../id'
import { usePropertiesExpansionStore, expandAllSections, collapseAllSections } from '../propertiesExpansionStore'
import { fuzzyScore } from '../fuzzyMatch'
import { WindowsAudioTargetPicker } from '../plugins/WindowsAudioTargetPicker'
import { FONT_OPTIONS, resolveFont, customFontToOption } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, pickAutoBorderColor, pickLegibleTextColor } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING, DCS_COMMAND_VALUE_SHORTHAND } from '@shared/constants'
import { deriveClickedState } from '@shared/states'
import { blockMerge, hasMorphCycle, isMorphSliderActive, type BlockMerge } from '@shared/morph'
import { toVariableMap, tryEvaluateExpression } from '@shared/expr'
import { getSubDeckWidgets } from '@shared/subDecks'
import { ANCHOR_OPTIONS } from '../background'
import { KeyCapture } from './KeyCapture'
import { SequenceRecorder } from './SequenceRecorder'
import { ColorPickerButton } from './ColorPickerButton'
import { DETENT_SIZE } from './widgets/DialShapeGraphic'
import { isMiddlePosition as isMiddleTogglePosition, toggleNameForIndex } from './widgets/ToggleSwitchWidget'
import { ARC_DEFAULT_TRACK_COLOR, ARC_DEFAULT_INDICATOR_COLOR, ARC_DEFAULT_TICK_COLOR } from './widgets/GaugeWidget'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import type {
  ActionStep,
  AdjusterKnobWidget,
  AdjusterSliderWidget,
  BackgroundFit,
  CallRestAction,
  CallRestPlaceholderValue,
  ColorAppearance,
  ConditionStep,
  DelayStep,
  DetentStyle,
  DialShapeStyle,
  DialSwitchWidget,
  DropdownWidget,
  EncoderTickSet,
  EncoderWidget,
  EventfulWidget,
  GaugeTickSet,
  BarGaugeWidget,
  ArcGaugeWidget,
  DcsViewportWidget,
  HorizontalAlign,
  KeypressAction,
  LabelWidget,
  LineWidget,
  MorphBlock,
  MorphBlockStateOverride,
  NavigateSubDeckAction,
  OpenOverlayAction,
  OverlayEdge,
  RestWebhookTarget,
  RockerSwitchWidget,
  ScreenCaptureWidget,
  SendDcsCommandAction,
  SetWindowsAudioAction,
  SequenceStep,
  SquareBorderStyle,
  StatefulWidget,
  SubDeck,
  SwitchPosition,
  ToggleSwitchWidget,
  VerticalAlign,
  Widget,
  WidgetAction,
  WidgetLabel,
  WidgetState
} from '@shared/types'
import { extractAllPlaceholders } from '@shared/restPlaceholders'
import { stepTitle } from '@shared/actionTitle'
import type { DcsBiosCommandCatalogEntry, DcsBiosInputInterface } from '@shared/dcsBiosTypes'
import { DCS_AIRCRAFT_CATALOG } from '@shared/dcsViewportsCatalog'

const ACTIVE_STATE_EXPR_PLACEHOLDER = "return variables.BATTERY_SW === 0 ? 'Default' : 'Active';"
const ACTIVE_POSITION_EXPR_PLACEHOLDER = "return variables.GEAR_HANDLE === 1 ? 'Down' : 'Up';"
const GUARD_OPEN_EXPR_PLACEHOLDER = 'return variables.GEAR_HANDLE === 1;'
const LABEL_TEXT_EXPR_PLACEHOLDER = 'return "Count: " + variables.my_variable + " {{icon:fa-image}}";'

// Header shown at the top of the properties panel for whichever widget is
// selected, so switching between widgets (especially two that look similar
// mid-edit, like a rocker switch and an adjuster slider) is never ambiguous
// about which kind of widget you're looking at.
const WIDGET_TYPE_LABELS: Record<Widget['type'], string> = {
  button: 'Button',
  morph: 'Morph button',
  'gauge-bar': 'Bar Gauge',
  'gauge-arc': 'Arc Gauge',
  'adjuster-slider': 'Slider',
  'adjuster-knob': 'Knob',
  encoder: 'Encoder',
  'switch-rocker': 'Rocker switch',
  'switch-dial': 'Dial switch',
  'switch-toggle': 'Toggle switch',
  dropdown: 'Dropdown',
  'screen-capture': 'Screen capture',
  'dcs-viewport': 'DCS viewport',
  label: 'Label',
  line: 'Line'
}

// One 3x3 grid replaces the old separate horizontal/vertical button rows —
// each cell is a (h, v) pair, in reading order (top-left to bottom-right),
// so picking a corner/edge sets both axes in a single click instead of two.
const ALIGN_GRID: { h: HorizontalAlign; v: VerticalAlign }[] = [
  { h: 'left', v: 'top' },
  { h: 'center', v: 'top' },
  { h: 'right', v: 'top' },
  { h: 'left', v: 'center' },
  { h: 'center', v: 'center' },
  { h: 'right', v: 'center' },
  { h: 'left', v: 'bottom' },
  { h: 'center', v: 'bottom' },
  { h: 'right', v: 'bottom' }
]
const JUSTIFY_FOR_V: Record<VerticalAlign, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' }
const ALIGN_ITEMS_FOR_H: Record<HorizontalAlign, string> = { left: 'flex-start', center: 'center', right: 'flex-end' }

const BACKGROUND_FITS: { value: BackgroundFit; label: string }[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
  { value: 'none', label: 'Actual size' }
]

interface ResizeState {
  startX: number
  startWidth: number
}

interface SideFieldProps {
  value: number
  min: number
  disabled?: boolean
  onChange: (value: number) => void
}

// Shared collapsible section wrapper — every group of related fields in this
// panel (Style/Value, Colors, Border, Labels, States, Position & Size, ...)
// renders as one of these, so the panel reads as a consistent stack of
// clearly-separated cards instead of a flat list of fields divided only by
// thin <hr> lines. `open` is forwarded straight through rather than treated
// as an uncontrolled defaultOpen — some callers (e.g. a per-event action
// sequence) recompute it live across re-renders (open once populated), not
// just on mount, so this stays a plain stateless wrapper around that.
function PropertiesSection({
  title,
  badge,
  sectionKey,
  headerExtra,
  children,
  onDragStart,
  onDragOver,
  onDrop
}: {
  title: string
  badge?: number | string
  // Persistence key for remembering this section's open/closed state (see
  // id.ts's isSectionOpen/setSectionOpen) — defaults to `title`. Per-label
  // sections pass the label's own id instead: several labels can share the
  // same title ("Untitled label") but shouldn't share open state.
  sectionKey?: string
  // Extra controls shown in the clickable header itself, beside the title —
  // e.g. EventSequenceEditor's "Set all delays" bulk input, usable without
  // opening the section at all. Stops click/pointerdown from bubbling up to
  // <summary> so interacting with these doesn't also toggle the section —
  // a <summary>'s expand/collapse is the browser's own default action on
  // any click that reaches it, descendant-originated or not.
  headerExtra?: React.ReactNode
  children: React.ReactNode
  // Opts this section into being a reorderable row inside a drag list (used
  // by EventSequenceEditor's step list). All three land on the rendered
  // <details> itself, which is draggable ONLY WHILE COLLAPSED (`!open`) — a
  // collapsed <details> renders none of its body's own text/number inputs
  // at all (only <summary>'s title, plus headerExtra's own controls, which
  // already stopPropagation their own pointerdown/click), so there's
  // nothing inside a draggable collapsed row for a click-drag to mean
  // "select this text" instead of "drag this row". Expanding a row to edit
  // it simply turns dragging back off until it's collapsed again — no
  // separate pointerdown/pointerup guard needed, unlike the old flat
  // sequence-step div this replaces.
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
}): React.JSX.Element {
  const key = sectionKey ?? title
  const [open, setOpen] = useState(() => isSectionOpen(key))
  const reorderable = onDragStart !== undefined

  // Properties panel's own "Expand all"/"Collapse all" header buttons (see
  // propertiesExpansionStore.ts) — every mounted PropertiesSection reacts
  // independently, including ones nested inside another (a label/position's
  // own sub-section), since those are always mounted in the DOM regardless
  // of their ancestor <details>'s own open/closed state.
  const command = usePropertiesExpansionStore((s) => s.command)
  const appliedCommandId = useRef(0)
  useEffect(() => {
    if (!command || command.id === appliedCommandId.current) return
    appliedCommandId.current = command.id
    setOpen(command.open)
    setSectionOpen(key, command.open)
  }, [command, key])

  return (
    <details
      className="properties-section"
      open={open}
      draggable={reorderable ? !open : undefined}
      onDragStart={reorderable ? onDragStart : undefined}
      onDragOver={reorderable ? onDragOver : undefined}
      onDrop={reorderable ? onDrop : undefined}
      onToggle={(e) => {
        const next = e.currentTarget.open
        setOpen(next)
        setSectionOpen(key, next)
      }}
    >
      <summary>
        <span>
          {title}
          {badge ? ` (${badge})` : ''}
        </span>
        {headerExtra && (
          <span className="properties-section__header-extra" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {headerExtra}
          </span>
        )}
      </summary>
      <div className="properties-section__body">{children}</div>
    </details>
  )
}

// A "box model" style 4-input layout (top/left/right/bottom arranged around
// a small box icon) for a set of per-side values — spacing and border
// thickness both are one, for both a plain button's own state and a morph
// block's override. Position alone conveys which side each field is, same
// idea as the text-align grid above.
function SidesInputGrid({
  top,
  right,
  bottom,
  left
}: {
  top: SideFieldProps
  right: SideFieldProps
  bottom: SideFieldProps
  left: SideFieldProps
}): React.JSX.Element {
  function renderInput(side: SideFieldProps): React.JSX.Element {
    return (
      <input
        type="number"
        min={side.min}
        disabled={side.disabled}
        value={side.value}
        onChange={(e) => side.onChange(Math.max(side.min, Math.round(Number(e.target.value))))}
      />
    )
  }
  return (
    <div className="sides-grid">
      <label className="sides-grid__top" title="Top">
        <span>T</span>
        {renderInput(top)}
      </label>
      <label className="sides-grid__left" title="Left">
        <span>L</span>
        {renderInput(left)}
      </label>
      <div className="sides-grid__center" />
      <label className="sides-grid__right" title="Right">
        <span>R</span>
        {renderInput(right)}
      </label>
      <label className="sides-grid__bottom" title="Bottom">
        <span>B</span>
        {renderInput(bottom)}
      </label>
    </div>
  )
}

// Same idea as SidesInputGrid, but for the 4 corners (border radius) rather
// than the 4 edges — each input sits in the grid corner matching the corner
// it controls, around a center icon with rounded corners of its own.
function CornersInputGrid({
  topLeft,
  topRight,
  bottomLeft,
  bottomRight
}: {
  topLeft: SideFieldProps
  topRight: SideFieldProps
  bottomLeft: SideFieldProps
  bottomRight: SideFieldProps
}): React.JSX.Element {
  function renderInput(corner: SideFieldProps): React.JSX.Element {
    return (
      <input
        type="number"
        min={corner.min}
        disabled={corner.disabled}
        value={corner.value}
        onChange={(e) => corner.onChange(Math.max(corner.min, Math.round(Number(e.target.value))))}
      />
    )
  }
  return (
    <div className="corners-grid">
      <label className="corners-grid__top-left" title="Top left">
        <span>TL</span>
        {renderInput(topLeft)}
      </label>
      <label className="corners-grid__top-right" title="Top right">
        <span>TR</span>
        {renderInput(topRight)}
      </label>
      <div className="corners-grid__center" />
      <label className="corners-grid__bottom-left" title="Bottom left">
        <span>BL</span>
        {renderInput(bottomLeft)}
      </label>
      <label className="corners-grid__bottom-right" title="Bottom right">
        <span>BR</span>
        {renderInput(bottomRight)}
      </label>
    </div>
  )
}

// Header for one label's own collapsible sub-section (see every `labels.map`
// call site below) — the label's own text reads as a much more useful
// at-a-glance identifier than a generic "Label 1"/"Label 2", especially once
// there are several. Falls back to naming the mechanism when there's no
// literal text to show (an expression-driven label, or a genuinely blank
// one) rather than showing nothing.
// Shift+Enter in the plain label text input inserts a ␤ (U+2424) at the
// caret instead of doing nothing/submitting — the same line-break token
// labels.tsx renders as a <br> (see shared/labelContent.ts), since a
// single-line <input> can't hold a real newline character.
function insertLabelBreak(input: HTMLInputElement, value: string, setText: (text: string) => void): void {
  const start = input.selectionStart ?? value.length
  const end = input.selectionEnd ?? value.length
  setText(value.slice(0, start) + '␤' + value.slice(end))
  // `value` is a controlled prop — it won't reflect the new text (and the
  // caret the browser would otherwise place) until the next render, so the
  // restore has to happen a tick later.
  requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1))
}

function labelSectionTitle(label: WidgetLabel): string {
  if (label.text.trim()) return label.text
  return label.textExpr !== undefined ? 'ƒx label' : 'Untitled label'
}

// Every widget type's own "Visible" toggle (see WidgetVisibility in
// shared/types.ts) — one shared component rather than duplicating this
// checkbox/ƒx pair into each of the 11 per-type Advanced sections below,
// same "generic over the shared fields" reasoning as LabelFields. Same
// plain/expression toggle shape as SendDcsCommandActionEditor's Value
// field and ToggleSwitchWidget's "Open when," just with a checkbox
// (rather than a text input, or a plain/expression radio with no static
// value at all) standing in for the non-expression state.
const VISIBLE_EXPR_PLACEHOLDER = 'return variables.my_variable > 0;'
// GaugeWidget.showIndicatorExpr's own placeholder — same convention as
// VISIBLE_EXPR_PLACEHOLDER above.
const SHOW_INDICATOR_EXPR_PLACEHOLDER = 'return variables.my_variable > 0;'

function VisibilityField({
  visible,
  visibleExpr,
  onChange
}: {
  visible: boolean | undefined
  visibleExpr: string | undefined
  onChange: (fields: { visible?: boolean; visibleExpr?: string }) => void
}): React.JSX.Element {
  const isExpr = visibleExpr !== undefined
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      {/* A plain div, not a <label> — same reasoning as LabelFields' own
          text field: the CodeEditor below nests its own focusable input,
          and clicking into it inside a <label> would also synthesize a
          click on the field's first labelable descendant (the ƒx/clear
          button), instantly exiting expression mode the moment you tried
          to type. */}
      <div className="properties__field">
        <span>Visible</span>
        <div className="color-picker-button__row">
          {isExpr ? (
            <div className="color-picker-button__trigger color-picker-button__trigger--expr">ƒx</div>
          ) : (
            <label className="properties__checkbox" style={{ flex: 1, minWidth: 0 }}>
              <input type="checkbox" checked={visible ?? true} onChange={(e) => onChange({ visible: e.target.checked })} />
              Shown
            </label>
          )}
          {isExpr ? (
            <button type="button" className="color-picker-button__clear" title="Use a fixed on/off value instead" onClick={() => onChange({ visibleExpr: undefined })}>
              ×
            </button>
          ) : (
            <button type="button" className="color-picker-button__fx" title="Compute visibility with an expression" onClick={() => onChange({ visibleExpr: '' })}>
              ƒx
            </button>
          )}
        </div>
        {isExpr && (
          <div className="color-picker-button__expr-panel">
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor value={visibleExpr ?? ''} onChange={(code) => onChange({ visibleExpr: code })} placeholder={VISIBLE_EXPR_PLACEHOLDER} minimal />
              <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setExpanded(true)}>
                ⤢
              </button>
            </div>
          </div>
        )}
      </div>

      {expanded && (
        <ExpressionEditorModal
          value={visibleExpr ?? ''}
          onChange={(code) => onChange({ visibleExpr: code })}
          placeholder={VISIBLE_EXPR_PLACEHOLDER}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}

// One labelled expression field: a minimal CodeEditor plus the same
// expand-to-modal affordance colorExpr/visibleExpr already have (see
// VisibleField just above, whose inline copy of this shape it mirrors).
//
// Extracted rather than repeated because the fourteen widget-specific
// expression fields this replaced — rotateAngleExpr on five widget types,
// both gauges' valueExpr, both tick sets' labelTextExpr, the encoder/adjuster
// rest values, guardOpenExpr — all needed byte-identical wrappers, and
// several of them render inside a .map() where a single `expanded` flag held
// by the parent couldn't say WHICH row was expanded.
function ExpressionField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      {/* A div, not a <label> — see VisibleField's own comment: CodeEditor
          nests its own focusable input, and a wrapping <label> would
          synthesize a second click on the field's first labelable
          descendant every time you clicked into the editor. */}
      <div className="properties__field">
        <span>{label}</span>
        <div className="color-picker-button__expr-editor-wrap">
          <CodeEditor value={value} onChange={onChange} placeholder={placeholder} minimal />
          <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setExpanded(true)}>
            ⤢
          </button>
        </div>
      </div>
      {expanded && <ExpressionEditorModal value={value} onChange={onChange} placeholder={placeholder} onClose={() => setExpanded(false)} />}
    </>
  )
}

function LabelFields({
  label,
  backgroundColor,
  onChange,
  onRemove,
  showAnchor = false,
  showRemove = true
}: {
  label: WidgetLabel
  backgroundColor: string
  onChange: (fields: Partial<WidgetLabel>) => void
  onRemove: () => void
  // Dial switch position labels only — see WidgetLabel.labelAnchor.
  showAnchor?: boolean
  // False for LabelWidget's own single, non-removable label (see its own
  // PropertiesPanel branch below) — "removing" the only thing a Label
  // widget draws doesn't mean anything; delete the widget itself instead.
  showRemove?: boolean
}): React.JSX.Element {
  const isTextColorExpr = label.textColorExpr !== undefined
  const isAutoTextColor = label.textColor == null && !isTextColorExpr
  const isTextExpr = label.textExpr !== undefined
  // Remembers the last non-empty textExpr across a toggle-off-then-back-on
  // — without this, clicking × (which unconditionally clears to undefined)
  // then ƒx again started a real, already-written expression over from a
  // blank string with no way back short of Ctrl+Z. Same fix
  // SendDcsCommandActionEditor's own Value field already uses for this
  // exact shape.
  const textExprDraftRef = useRef(label.textExpr ?? '')
  useEffect(() => {
    if (label.textExpr) textExprDraftRef.current = label.textExpr
  }, [label.textExpr])
  const [textExprExpanded, setTextExprExpanded] = useState(false)
  // Every LabelFields instance reads this directly (rather than the 9-odd
  // call sites threading it down as a prop) — same "just read the store"
  // convention as any other component-local hook use in this file.
  const customFonts = useDashboardStore((s) => s.customFonts)
  const fontOptions = [...FONT_OPTIONS, ...customFonts.map(customFontToOption)]

  return (
    <>
      {/* A plain div, not a <label> — the CodeEditor below nests its own
          focusable/labelable input, and clicking into it inside a <label>
          would also synthesize a click on the field's first labelable
          descendant (the fx/clear button), instantly exiting expression
          mode the moment you tried to type — same pitfall as
          ColorPickerButton's own popover, see its call site's comment. */}
      <div className="properties__field">
        <span>Text</span>
        <div className="color-picker-button__row">
          {isTextExpr ? (
            <div className="color-picker-button__trigger color-picker-button__trigger--expr">ƒx</div>
          ) : (
            <input
              value={label.text}
              onChange={(e) => onChange({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !e.shiftKey) return
                e.preventDefault()
                insertLabelBreak(e.currentTarget, label.text, (text) => onChange({ text }))
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
          )}
          {isTextExpr ? (
            <button type="button" className="color-picker-button__clear" title="Use static text" onClick={() => onChange({ textExpr: undefined })}>
              ×
            </button>
          ) : (
            <button type="button" className="color-picker-button__fx" title="Use an expression" onClick={() => onChange({ textExpr: textExprDraftRef.current })}>
              ƒx
            </button>
          )}
        </div>
        {isTextExpr && (
          <div className="color-picker-button__expr-panel">
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor
                value={label.textExpr ?? ''}
                onChange={(code) => onChange({ textExpr: code })}
                placeholder={LABEL_TEXT_EXPR_PLACEHOLDER}
                minimal
              />
              <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setTextExprExpanded(true)}>
                ⤢
              </button>
            </div>
          </div>
        )}
      </div>

      {textExprExpanded && (
        <ExpressionEditorModal
          value={label.textExpr ?? ''}
          onChange={(code) => onChange({ textExpr: code })}
          placeholder={LABEL_TEXT_EXPR_PLACEHOLDER}
          onClose={() => setTextExprExpanded(false)}
        />
      )}

      <label className="properties__field">
        <span>Font</span>
        <select
          value={resolveFont(label.fontFamily).id}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          style={{ fontFamily: resolveFont(label.fontFamily).cssFamily }}
        >
          {fontOptions.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.cssFamily }}>
              {f.label}
              {f.monospace ? ' (mono)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="properties__field">
        <span>Font size</span>
        <input
          type="number"
          min={1}
          value={label.fontSize ?? DEFAULT_WIDGET_FONT_SIZE}
          onChange={(e) => onChange({ fontSize: Math.max(1, Number(e.target.value)) })}
        />
      </label>

      <label className="properties__field">
        <span>Padding</span>
        <input type="number" value={label.padding ?? DEFAULT_WIDGET_PADDING} onChange={(e) => onChange({ padding: Number(e.target.value) })} />
      </label>

      <label className="properties__field">
        <span>Offset X</span>
        <input type="number" value={label.offsetX ?? 0} onChange={(e) => onChange({ offsetX: Number(e.target.value) })} />
      </label>

      <label className="properties__field">
        <span>Offset Y</span>
        <input type="number" value={label.offsetY ?? 0} onChange={(e) => onChange({ offsetY: Number(e.target.value) })} />
      </label>

      <label className="properties__field">
        <span>Rotation</span>
        <select
          value={label.rotation ?? 0}
          onChange={(e) => onChange({ rotation: Number(e.target.value) as WidgetLabel['rotation'] })}
        >
          <option value={0}>0°</option>
          <option value={90}>90°</option>
          <option value={180}>180°</option>
          <option value={270}>270°</option>
        </select>
      </label>

      <div className="properties__field">
        <span>Text color</span>
        <ColorPickerButton
          key={`${label.id}-textColor`}
          value={label.textColor ?? pickLegibleTextColor(backgroundColor)}
          onChange={(color) => onChange({ textColor: color, textColorExpr: undefined })}
          isExpr={isTextColorExpr}
          exprValue={label.textColorExpr ?? ''}
          onExprChange={(code) => onChange({ textColorExpr: code })}
          onEnterExpr={() => onChange({ textColorExpr: label.textColorExpr ?? '' })}
          onClearExpr={() => onChange({ textColorExpr: undefined })}
          auto={isAutoTextColor}
          onAuto={() => onChange({ textColor: undefined, textColorExpr: undefined })}
          opacity={label.textOpacity ?? 1}
          onOpacityChange={(v) => onChange({ textOpacity: v })}
        />
      </div>

      <div className="properties__field">
        <span>Background color</span>
        <ColorPickerButton
          key={`${label.id}-backgroundColor`}
          value={label.backgroundColor ?? DEFAULT_WIDGET_COLOR}
          onChange={(color) => onChange({ backgroundColor: color })}
          opacity={label.backgroundOpacity ?? (label.backgroundColor === undefined ? 0 : 1)}
          onOpacityChange={(v) => onChange({ backgroundOpacity: v })}
        />
      </div>

      {/* A plain div, not a <label> — same reasoning as VisibilityField's own
          comment: clicking the open space inside a <label> (not just its
          actual controls) synthesizes a click on the field's first
          labelable descendant, which would always be the top/left button
          regardless of where in the grid you actually clicked. */}
      <div className="properties__field">
        <span>Align</span>
        <div className="text-align-grid">
          {ALIGN_GRID.map(({ h, v }) => {
            const active = (label.align ?? 'center') === h && (label.verticalAlign ?? 'center') === v
            return (
              <button
                key={`${h}-${v}`}
                type="button"
                className={`text-align-button${active ? ' text-align-button--active' : ''}`}
                style={{ justifyContent: JUSTIFY_FOR_V[v] }}
                onClick={() => onChange({ align: h, verticalAlign: v })}
                title={`Align ${v} ${h}`}
              >
                <span className="text-align-button__lines" style={{ alignItems: ALIGN_ITEMS_FOR_H[h] }}>
                  <span style={{ width: '60%' }} />
                  <span style={{ width: '100%' }} />
                  <span style={{ width: '45%' }} />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <label className="properties__field">
        <span>Text align</span>
        <select
          value={label.textAlign ?? ''}
          onChange={(e) => onChange({ textAlign: e.target.value === '' ? undefined : (e.target.value as HorizontalAlign) })}
        >
          <option value="">Same as align</option>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <p className="properties__hint">
        How the text itself sits within its label box, independent of where that box is placed by Align above — e.g. a box pinned to
        the right can still have its own (possibly multi-line) text centered.
      </p>

      {showAnchor && (
        <>
          <label className="properties__field">
            <span>Label anchor</span>
            <select
              value={label.labelAnchor ?? 'auto'}
              onChange={(e) => onChange({ labelAnchor: e.target.value === 'auto' ? undefined : (e.target.value as WidgetLabel['labelAnchor']) })}
            >
              <option value="auto">Auto (radial — points outward from this detent)</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <p className="properties__hint">
            Auto places this label just outside the dial, pointing away from center along its detent's own angle — usually the right
            choice. A fixed side pins just this label there instead, independent of every other label.
          </p>
          <label className="properties__field">
            <span>Label distance</span>
            <input type="number" value={label.labelDistance ?? 12} onChange={(e) => onChange({ labelDistance: Number(e.target.value) })} />
          </label>
          <p className="properties__hint">
            Distance outward from the ring/pole, along whichever direction Label anchor above already points — this detent&rsquo;s own
            angle for Auto, or straight along that fixed side for Top/Bottom/Left/Right. Negative pulls the label in past the ring,
            toward (and, if pushed far enough, through) center. Independent of Padding above, which only moves the label within its own
            small box and clamps hard once it exceeds that box&rsquo;s size.
          </p>
        </>
      )}

      {showRemove && (
        <button type="button" className="properties__file-remove" onClick={onRemove}>
          Remove label
        </button>
      )}
    </>
  )
}

// Shared by DialSwitchWidget's ring detents AND its own dial-center
// indicator marker (see DetentStyle/indicatorStyle in shared/types.ts) —
// same shape choice, same width/height/border/radius fields, just wired to
// whichever pair of (shape, style) props the caller passes. Fill color
// stays out of this component (per-position for ring detents, a single
// field for the indicator) since it isn't shaped the same way in both
// places — callers render their own color field(s) alongside this.
function DetentShapeEditor({
  shape,
  onShapeChange,
  style,
  onStyleChange,
  squareBorder,
  onSquareBorderChange,
  allowNone
}: {
  shape: NonNullable<DialShapeStyle['indicatorShape']>
  onShapeChange: (shape: NonNullable<DialShapeStyle['indicatorShape']>) => void
  style: DetentStyle | undefined
  onStyleChange: (style: DetentStyle) => void
  // Only the dial-center indicator's 'square' shape wires these — a ring
  // detent's own square stays on the scalar width/radius inputs below (see
  // the "Detents" PropertiesSection's own DetentShapeEditor call, which
  // omits both). Presence of the callback (not a separate boolean) gates
  // the per-side grid, same "optional callback presence enables optional
  // UI" convention ColorPickerButton's onEnterExpr/onExprChange already use.
  squareBorder?: SquareBorderStyle
  onSquareBorderChange?: (value: SquareBorderStyle) => void
  // Whether "None" (draw nothing) is offered at all — the dial-center
  // indicator and the "Detents" section's own ring-detent call (below) both
  // pass this now; omitted (e.g. a circle indent's own shape picker) means
  // there's always supposed to be SOME visible marker, so the option is
  // hidden entirely instead of just being one more choice nobody should pick.
  allowNone?: boolean
}): React.JSX.Element {
  if (shape === 'none') {
    return (
      <div className="properties__grid2">
        <label className="properties__field">
          <span>Shape</span>
          <select value={shape} onChange={(e) => onShapeChange(e.target.value as NonNullable<DialShapeStyle['indicatorShape']>)}>
            <option value="none">None</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="tick">Tick</option>
            <option value="triangle">Triangle</option>
          </select>
        </label>
        <div />
      </div>
    )
  }

  const defaultSize = DETENT_SIZE[shape]
  const defaultBorderRadius = shape === 'square' ? 2 : 1
  // Every shape but circle can show a meaningful border now — a triangle
  // renders as a real stroked, roundable SVG shape (see DialShapeGraphic.tsx
  // for the ring-detent path and DetentIndicatorShape for the indicator),
  // not a border-less CSS clip-path. Circle's roundness already comes from
  // being a circle/ellipse, so radius has nothing to add there.
  const showBorderRadius = shape !== 'circle'
  const showSquareBorderGrid = shape === 'square' && onSquareBorderChange

  return (
    <>
      <div className="properties__grid2">
        <label className="properties__field">
          <span>Shape</span>
          <select value={shape} onChange={(e) => onShapeChange(e.target.value as NonNullable<DialShapeStyle['indicatorShape']>)}>
            {allowNone && <option value="none">None</option>}
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="tick">Tick</option>
            <option value="triangle">Triangle</option>
          </select>
        </label>
        <div />
      </div>
      <div className="properties__grid2">
        <label className="properties__field">
          <span>Width</span>
          <input
            type="number"
            min={1}
            value={style?.width ?? defaultSize.width}
            onChange={(e) => onStyleChange({ ...style, width: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="properties__field">
          <span>Height</span>
          <input
            type="number"
            min={1}
            value={style?.height ?? defaultSize.height}
            onChange={(e) => onStyleChange({ ...style, height: Math.max(1, Number(e.target.value)) })}
          />
        </label>
      </div>
      {showSquareBorderGrid ? (
        <>
          <p className="properties__hint">Border width, per side:</p>
          <SidesInputGrid
            top={{ value: squareBorder?.widthTop ?? style?.borderWidth ?? 0, min: 0, onChange: (v) => onSquareBorderChange({ ...squareBorder, widthTop: v }) }}
            right={{
              value: squareBorder?.widthRight ?? style?.borderWidth ?? 0,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, widthRight: v })
            }}
            bottom={{
              value: squareBorder?.widthBottom ?? style?.borderWidth ?? 0,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, widthBottom: v })
            }}
            left={{
              value: squareBorder?.widthLeft ?? style?.borderWidth ?? 0,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, widthLeft: v })
            }}
          />
          <p className="properties__hint">Border radius, per corner:</p>
          <CornersInputGrid
            topLeft={{
              value: squareBorder?.radiusTopLeft ?? style?.borderRadius ?? defaultBorderRadius,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, radiusTopLeft: v })
            }}
            topRight={{
              value: squareBorder?.radiusTopRight ?? style?.borderRadius ?? defaultBorderRadius,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, radiusTopRight: v })
            }}
            bottomLeft={{
              value: squareBorder?.radiusBottomLeft ?? style?.borderRadius ?? defaultBorderRadius,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, radiusBottomLeft: v })
            }}
            bottomRight={{
              value: squareBorder?.radiusBottomRight ?? style?.borderRadius ?? defaultBorderRadius,
              min: 0,
              onChange: (v) => onSquareBorderChange({ ...squareBorder, radiusBottomRight: v })
            }}
          />
          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton value={style?.borderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => onStyleChange({ ...style, borderColor: color })} />
          </div>
        </>
      ) : (
        <>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>Border width</span>
              <input
                type="number"
                min={0}
                value={style?.borderWidth ?? 0}
                onChange={(e) => onStyleChange({ ...style, borderWidth: Math.max(0, Number(e.target.value)) })}
              />
            </label>
            {showBorderRadius && (
              <label className="properties__field">
                <span>Border radius</span>
                <input
                  type="number"
                  min={0}
                  value={style?.borderRadius ?? defaultBorderRadius}
                  onChange={(e) => onStyleChange({ ...style, borderRadius: Math.max(0, Number(e.target.value)) })}
                />
              </label>
            )}
          </div>
          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton value={style?.borderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => onStyleChange({ ...style, borderColor: color })} />
          </div>
        </>
      )}
    </>
  )
}

// The "Dial shape"/"Indicator" property sections — shared by DialSwitchWidget
// and EncoderWidget (both `extend DialShapeStyle`, see shared/types.ts), so
// this is the properties-panel counterpart to DialShapeGraphic.tsx's shared
// rendering: write the fields once, both widget types get identical
// shape/indicator controls. `fill`/`onFillChange` are threaded in separately
// (rather than folded into `value`/`onChange`) since `fill` lives on the
// widget itself, not on DialShapeStyle — it's what a 'needle' dialShape (and
// square/circleColor's own fallback) reads its color from on both widgets.
function DialShapeFields({
  value,
  onChange,
  fill,
  onFillChange,
  track,
  needleColorLabel
}: {
  value: DialShapeStyle
  onChange: (patch: Partial<DialShapeStyle>) => void
  fill: ColorAppearance
  onFillChange: (fill: ColorAppearance) => void
  // Read-only — just the auto-fallback preview/value for Indent color (see
  // circleIndentColor above), same role fill.color plays for circleColor's
  // own auto fallback. No onTrackChange: this section never edits track
  // itself, that lives in each widget's own "Colors" section.
  track: ColorAppearance
  needleColorLabel: string
}): React.JSX.Element {
  const isFillExpr = fill.colorExpr !== undefined
  const dialShape = value.dialShape ?? 'needle'

  return (
    <>
      <PropertiesSection title="Dial shape">
        <label className="properties__field">
          <span>Shape</span>
          <select value={dialShape} onChange={(e) => onChange({ dialShape: e.target.value === 'needle' ? undefined : (e.target.value as DialShapeStyle['dialShape']) })}>
            <option value="needle">Needle</option>
            <option value="square">Square</option>
            <option value="circle">Circle</option>
            <option value="none">None</option>
          </select>
        </label>

        {(dialShape === 'square' || dialShape === 'circle') && (
          <>
            <label className="properties__field">
              <span>Distance from center</span>
              <input type="number" value={value.dialDistance ?? 0} onChange={(e) => onChange({ dialDistance: Number(e.target.value) })} />
            </label>
            <p className="properties__hint">How far the shape itself sits from the dial's center — negative flips it to the opposite side.</p>
          </>
        )}

        {dialShape === 'needle' && (
          <div className="properties__field">
            <span>{needleColorLabel}</span>
            <ColorPickerButton
              value={fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => onFillChange({ ...fill, color, colorExpr: undefined })}
              isExpr={isFillExpr}
              exprValue={fill.colorExpr ?? ''}
              onExprChange={(code) => onFillChange({ ...fill, colorExpr: code })}
              onEnterExpr={() => onFillChange({ ...fill, colorExpr: fill.colorExpr ?? '' })}
              onClearExpr={() => onFillChange({ ...fill, colorExpr: undefined })}
              opacity={fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => onFillChange({ ...fill, backgroundOpacity: v })}
            />
          </div>
        )}

        {dialShape === 'square' && (
          <>
            <div className="properties__grid2">
              <label className="properties__field">
                <span>Square width</span>
                <input type="number" min={1} value={value.squareWidth ?? 24} onChange={(e) => onChange({ squareWidth: Math.max(1, Number(e.target.value)) })} />
              </label>
              <label className="properties__field">
                <span>Square height</span>
                <input
                  type="number"
                  min={1}
                  value={value.squareHeight ?? 24}
                  onChange={(e) => onChange({ squareHeight: Math.max(1, Number(e.target.value)) })}
                />
              </label>
            </div>
            <div className="properties__grid2">
              <label className="properties__field">
                <span>Square border width</span>
                <input
                  type="number"
                  min={0}
                  value={value.squareBorderWidth ?? 0}
                  onChange={(e) => onChange({ squareBorderWidth: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <label className="properties__field">
                <span>Square border radius</span>
                <input
                  type="number"
                  min={0}
                  value={value.squareBorderRadius ?? 2}
                  onChange={(e) => onChange({ squareBorderRadius: Math.max(0, Number(e.target.value)) })}
                />
              </label>
            </div>
            <div className="properties__field">
              <span>Square color</span>
              <ColorPickerButton
                value={value.squareColor ?? fill.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(color) => onChange({ squareColor: color })}
                auto={value.squareColor === undefined}
                onAuto={() => onChange({ squareColor: undefined })}
              />
            </div>
            <div className="properties__field">
              <span>Square border color</span>
              <ColorPickerButton value={value.squareBorderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => onChange({ squareBorderColor: color })} />
            </div>
          </>
        )}

        {dialShape === 'circle' && (
          <>
            <div className="properties__grid2">
              <label className="properties__field">
                <span>Circle size</span>
                <input type="number" min={1} value={value.circleSize ?? 20} onChange={(e) => onChange({ circleSize: Math.max(1, Number(e.target.value)) })} />
              </label>
              <label className="properties__field">
                <span>Circle border width</span>
                <input
                  type="number"
                  min={0}
                  value={value.circleBorderWidth ?? 0}
                  onChange={(e) => onChange({ circleBorderWidth: Math.max(0, Number(e.target.value)) })}
                />
              </label>
            </div>
            <div className="properties__field">
              <span>Circle color</span>
              <ColorPickerButton
                value={value.circleColor ?? fill.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(color) => onChange({ circleColor: color })}
                auto={value.circleColor === undefined}
                onAuto={() => onChange({ circleColor: undefined })}
              />
            </div>
            <div className="properties__field">
              <span>Circle border color</span>
              <ColorPickerButton value={value.circleBorderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => onChange({ circleBorderColor: color })} />
            </div>
            <div className="properties__grid2">
              <label className="properties__field">
                <span>Indent count</span>
                <input
                  type="number"
                  min={0}
                  value={value.circleIndentCount ?? 0}
                  onChange={(e) => onChange({ circleIndentCount: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <label className="properties__field">
                <span>Indent size</span>
                <input
                  type="number"
                  min={0}
                  value={value.circleIndentSize ?? Math.round(((value.circleSize ?? 20) / 6) * 10) / 10}
                  onChange={(e) => onChange({ circleIndentSize: Math.max(0, Number(e.target.value)) })}
                />
              </label>
            </div>
            <div className="properties__grid2">
              <label className="properties__field">
                <span>Indent distance</span>
                <input
                  type="number"
                  min={0}
                  value={value.circleIndentDistance ?? (value.circleSize ?? 20) / 2}
                  onChange={(e) => onChange({ circleIndentDistance: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <label className="properties__field">
                <span>Indent shape</span>
                <select
                  value={value.circleIndentShape ?? 'circle'}
                  onChange={(e) => onChange({ circleIndentShape: e.target.value === 'circle' ? undefined : (e.target.value as DialShapeStyle['circleIndentShape']) })}
                >
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                  <option value="tick">Tick</option>
                  <option value="triangle">Triangle</option>
                </select>
              </label>
            </div>
            <div className="properties__field">
              <span>Indent color</span>
              <ColorPickerButton
                value={value.circleIndentColor ?? track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(color) => onChange({ circleIndentColor: color })}
                auto={value.circleIndentColor === undefined}
                onAuto={() => onChange({ circleIndentColor: undefined })}
                opacity={value.circleIndentOpacity ?? 1}
                onOpacityChange={(v) => onChange({ circleIndentOpacity: v })}
              />
            </div>
            <p className="properties__hint">Auto matches the dial face/track color, so a notch reads as the face showing through. Pick a color to give it its own look instead.</p>
          </>
        )}
      </PropertiesSection>

      {(dialShape === 'square' || dialShape === 'circle') && (
        <PropertiesSection title="Indicator">
          <DetentShapeEditor
            shape={value.indicatorShape ?? 'circle'}
            onShapeChange={(shape) => onChange({ indicatorShape: shape === 'circle' ? undefined : shape })}
            style={value.indicatorStyle}
            onStyleChange={(indicatorStyle) => onChange({ indicatorStyle })}
            allowNone
            squareBorder={value.indicatorSquareBorder}
            onSquareBorderChange={(indicatorSquareBorder) => onChange({ indicatorSquareBorder })}
          />
          <div className="properties__field">
            <span>Indicator color</span>
            <ColorPickerButton
              value={value.indicatorColor ?? ((dialShape === 'square' ? value.squareColor : value.circleColor) ?? fill.color ?? DEFAULT_WIDGET_COLOR)}
              onChange={(color) => onChange({ indicatorColor: color })}
              auto={value.indicatorColor === undefined}
              onAuto={() => onChange({ indicatorColor: undefined })}
            />
          </div>
          <label className="properties__field">
            <span>Indicator distance</span>
            <input
              type="number"
              min={0}
              value={value.indicatorDistance ?? (dialShape === 'square' ? (value.squareHeight ?? 24) / 2 : (value.circleSize ?? 20) / 2)}
              onChange={(e) => onChange({ indicatorDistance: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </PropertiesSection>
      )}
    </>
  )
}

// The action-kind selector + per-kind fields, shared by ButtonWidget/
// MorphButtonWidget's own properties (below) and AdjusterWidget — an
// Adjuster fires this exact same WidgetAction union on drag, just with
// variables.$value additionally in scope server-side (see useAdjusterDrag.ts
// and triggerAction in main/index.ts), so nothing here is button-specific.
function ActionFields({
  action,
  onChange,
  dcsBiosActionEnabled,
  variableHint
}: {
  action: WidgetAction
  onChange: (action: WidgetAction) => void
  dcsBiosActionEnabled: boolean
  // A short "variables.$whatever" reference, threaded down from whichever
  // EventSequenceEditor this action lives under (see its own doc comment) —
  // only set for events that actually put something extra in scope (Press/
  // Release/Position Change/Turn CW/Turn CCW — see TriggerValue in
  // main/index.ts), spliced into this action kind's own expression
  // placeholder(s) below so it's discoverable right where you'd type it,
  // not just in the hint text above the step list.
  variableHint?: string
}): React.JSX.Element {
  // Own selector rather than a threaded prop — ActionFields is nested
  // several components deep (SequenceStepFields/EventSequenceEditor/every
  // widget's own properties section), so a prop would need plumbing
  // through all of them just for this one default/picker.
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks) ?? []

  // Same "own selector" reasoning as subDecks above — restWebhookTargets is
  // fetched once at the top-level PropertiesPanel component (see its own
  // requestRestWebhookTargets effect), this just reads the cached result.
  // Only targets that are enabled AND have a URL configured are offered as
  // a new action-kind option, but an already-selected-and-since-removed
  // target still gets a (labeled) option so it doesn't silently vanish —
  // same "don't break an existing button" reasoning dcsBiosActionEnabled
  // uses for send-dcs-command above.
  const restWebhookTargets = useDashboardStore((s) => s.restWebhookTargets)
  const callableRestTargets = restWebhookTargets.filter((t) => t.enabled && t.url.trim())
  const selectedRestTarget = action.kind === 'call-rest' ? restWebhookTargets.find((t) => t.id === action.targetId) : undefined

  // Same "own selector" reasoning as subDecks/restWebhookTargets above, and
  // same null-reads-as-enabled convention dcsBiosActionEnabled's own prop
  // uses (see its computation in the top-level PropertiesPanel component)
  // — just read directly here instead of threading a second boolean prop
  // through every one of dcsBiosActionEnabled's many call sites for what's
  // otherwise the exact same gate.
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const windowsAudioActionEnabled = enabledPlugins === null || enabledPlugins.includes('windowsAudio')

  return (
    <>
      <label className="properties__field properties__field--inline">
        <span>Action</span>
        <select
          value={action.kind === 'call-rest' ? `call-rest:${action.targetId}` : action.kind}
          onChange={(e) => {
            const kind = e.target.value
            if (kind === 'none') onChange({ kind: 'none' })
            else if (kind === 'keypress') onChange({ kind: 'keypress', keys: [] })
            else if (kind === 'update-state') onChange({ kind: 'update-state', code: '' })
            else if (kind === 'send-dcs-command')
              onChange({ kind: 'send-dcs-command', aircraft: getLastDcsAircraft(), identifier: '', interface: 'action', argument: '' })
            else if (kind === 'navigate-subdeck') onChange({ kind: 'navigate-subdeck', target: { type: 'main-deck' } })
            else if (kind === 'open-overlay')
              onChange({ kind: 'open-overlay', subDeckId: subDecks[0]?.id ?? '', edge: 'right', size: 320, sizeUnit: 'px' })
            else if (kind === 'close-overlay') onChange({ kind: 'close-overlay' })
            else if (kind === 'set-windows-audio') onChange({ kind: 'set-windows-audio', deviceName: '' })
            else if (kind.startsWith('call-rest:')) onChange({ kind: 'call-rest', targetId: kind.slice('call-rest:'.length), values: [] })
          }}
        >
          <option value="none">No action</option>
          <option value="keypress">Keypress</option>
          <option value="update-state">Update state</option>
          {(dcsBiosActionEnabled || action.kind === 'send-dcs-command') && <option value="send-dcs-command">Send DCS command</option>}
          {(windowsAudioActionEnabled || action.kind === 'set-windows-audio') && <option value="set-windows-audio">Set Windows Audio</option>}
          <option value="navigate-subdeck">Navigate to screen</option>
          <option value="open-overlay">Open overlay</option>
          <option value="close-overlay">Close overlay</option>
          {callableRestTargets.map((target) => (
            <option key={target.id} value={`call-rest:${target.id}`}>
              Call {target.name}
            </option>
          ))}
          {action.kind === 'call-rest' && !callableRestTargets.some((t) => t.id === action.targetId) && (
            <option value={`call-rest:${action.targetId}`}>
              Call {selectedRestTarget ? `${selectedRestTarget.name} (disabled)` : '(deleted REST webhook target)'}
            </option>
          )}
        </select>
      </label>

      {action.kind === 'none' ? (
        <p className="properties__hint">No action — this step does nothing.</p>
      ) : action.kind === 'keypress' ? (
        <>
          <label className="properties__field">
            <span>Keys</span>
            <div className="key-capture-row">
              <KeyCapture keys={action.keys} onChange={(keys) => onChange({ ...action, keys })} />
              {action.keys.length > 0 && (
                <button type="button" className="key-capture__clear" title="Unbind" onClick={() => onChange({ ...action, keys: [] })}>
                  ×
                </button>
              )}
            </div>
          </label>
          <p className="properties__hint">Click the box, then press the key combo to bind. Click away to finish.</p>

          <label className="properties__field">
            <span>Mode</span>
            <select
              value={action.mode ?? 'press'}
              onChange={(e) => onChange({ ...action, mode: e.target.value as KeypressAction['mode'] })}
            >
              <option value="press">Press and release</option>
              <option value="down">Down only (hold)</option>
              <option value="up">Up only (release)</option>
            </select>
          </label>
          {action.mode && action.mode !== 'press' && (
            <p className="properties__hint">
              Pair a "Down only" step with a later "Up only" step (typically with a Delay step between them) to hold this key across a
              sequence — see the Actions section below.
            </p>
          )}
        </>
      ) : action.kind === 'update-state' ? (
        <>
          <label className="properties__field">
            <span>Code</span>
            <CodeEditor
              value={action.code}
              onChange={(code) => onChange({ kind: 'update-state', code })}
              placeholder={
                variableHint
                  ? `return { my_variable: ${variableHint} };`
                  : 'return { my_variable: (variables.my_variable ?? 0) + 1 };'
              }
            />
          </label>
          <p className="properties__hint">
            JS function body — <code>variables</code> holds every variable&rsquo;s current value. Return an object of{' '}
            <code>{'{ name: newValue }'}</code> pairs to update them (unknown names get created).
          </p>
        </>
      ) : action.kind === 'navigate-subdeck' ? (
        <NavigateSubDeckActionEditor
          action={action}
          subDecks={subDecks}
          onPatch={(fields) => onChange({ ...action, ...fields })}
        />
      ) : action.kind === 'open-overlay' ? (
        <OpenOverlayActionEditor action={action} subDecks={subDecks} onPatch={(fields) => onChange({ ...action, ...fields })} />
      ) : action.kind === 'close-overlay' ? (
        <p className="properties__hint">
          Closes whichever slide-over panel is currently open on the device that triggers this. No effect if none is open.
        </p>
      ) : action.kind === 'send-dcs-command' ? (
        <SendDcsCommandActionEditor action={action} onPatch={(fields) => onChange({ ...action, ...fields })} variableHint={variableHint} />
      ) : action.kind === 'set-windows-audio' ? (
        <SetWindowsAudioActionEditor action={action} onPatch={(fields) => onChange({ ...action, ...fields })} variableHint={variableHint} />
      ) : (
        // Narrowed by every kind check above, but TS doesn't retain that
        // narrowing inside the onChange closure below (a callback could in
        // principle run after `action` changes) — the cast reflects what's
        // already true at this point in the ternary, not a real unsafe leap.
        <CallRestActionEditor
          action={action as CallRestAction}
          restWebhookTargets={restWebhookTargets}
          onPatch={(fields) => onChange({ ...(action as CallRestAction), ...fields })}
          variableHint={variableHint}
        />
      )}
    </>
  )
}

// One step within an event's sequence — a plain WidgetAction (via
// ActionFields, unchanged), a Delay step (a single ms field), or a
// Condition step (an fx expression plus two nested EventSequenceEditor
// branches — reusing that same component recursively rather than a
// bespoke branch-list widget, since a branch is just another event's own
// SequenceStep[] with nowhere else to live). All three share the same
// remove control.
function SequenceStepFields({
  step,
  onChange,
  onRemove,
  dcsBiosActionEnabled,
  variableHint
}: {
  step: SequenceStep
  onChange: (step: SequenceStep) => void
  onRemove: () => void
  dcsBiosActionEnabled: boolean
  // See ActionFields' own doc comment.
  variableHint?: string
}): React.JSX.Element {
  if (step.kind === 'delay') {
    return (
      <div className="sequence-step__row">
        <label className="properties__field properties__field--inline">
          <span>Delay (ms)</span>
          <input
            type="number"
            min={0}
            value={step.delayMs}
            onChange={(e) => onChange({ ...step, delayMs: Math.max(0, Math.round(Number(e.target.value))) })}
          />
        </label>
        <button type="button" className="properties__file-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    )
  }
  if (step.kind === 'condition') {
    return (
      <>
        <label className="properties__field">
          <span>Condition</span>
          <CodeEditor
            value={step.condition}
            onChange={(condition) => onChange({ ...step, condition })}
            placeholder={variableHint ? `return ${variableHint} > 0;` : 'return variables.GEAR_HANDLE === 1;'}
          />
        </label>
        <p className="properties__hint">
          JS function body — return a truthy/falsy value. <code>variables</code> holds every variable&rsquo;s current value.
        </p>
        <EventSequenceEditor
          title="If true"
          steps={step.whenTrue}
          onChange={(whenTrue) => onChange({ ...step, whenTrue })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          variableHint={variableHint}
        />
        <EventSequenceEditor
          title="If false"
          steps={step.whenFalse}
          onChange={(whenFalse) => onChange({ ...step, whenFalse })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          variableHint={variableHint}
        />
        <button type="button" className="properties__file-remove sequence-step__remove" onClick={onRemove}>
          Remove step
        </button>
      </>
    )
  }
  return (
    <>
      <ActionFields
        action={step.action}
        onChange={(action) => onChange({ ...step, action })}
        dcsBiosActionEnabled={dcsBiosActionEnabled}
        variableHint={variableHint}
      />
      <button type="button" className="properties__file-remove sequence-step__remove" onClick={onRemove}>
        Remove step
      </button>
    </>
  )
}

// One interaction event's reorderable SequenceStep[] — self-contained
// drag-reorder state (dragStepIndex), same interaction pattern as the
// widget-states tabs' dragStateIndex/handleReorderState below, scoped per
// instance rather than shared, since Press/Release/Move each reorder
// independently.
// Exported for GlobalActionsModal.tsx, which reuses this wholesale for a
// deck-wide rule's own action list — everything it needs beyond these props
// (sub-decks, REST targets, enabled plugins) is read from the store by
// ActionFields itself, so nothing widget-specific has to be faked.
export function EventSequenceEditor({
  title,
  steps,
  onChange,
  dcsBiosActionEnabled,
  hint,
  variableHint
}: {
  title: string
  steps: SequenceStep[]
  onChange: (steps: SequenceStep[]) => void
  dcsBiosActionEnabled: boolean
  // Shown once, above the step list — e.g. Position Change/increment/
  // decrement's own note about variables.$value/$index (see TriggerValue in
  // main/index.ts) being in scope for this particular event's expressions.
  hint?: string
  // See ActionFields' own doc comment — threaded all the way down to each
  // step's own expression placeholder(s), not just this section's hint text
  // above.
  variableHint?: string
}): React.JSX.Element {
  const dragStepIndex = useRef<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [bulkDelayMs, setBulkDelayMs] = useState(30)
  const confirm = useConfirmStore((s) => s.confirm)

  function patchStep(index: number, step: SequenceStep): void {
    onChange(steps.map((s, i) => (i === index ? step : s)))
  }
  function removeStep(index: number): void {
    onChange(steps.filter((_, i) => i !== index))
  }
  // Shared by both the collapsed header's own delete button and the
  // expanded body's "Remove step"/"Remove" button — same confirm-then-act
  // pattern as every other Remove/Delete control in this panel (see
  // confirmRemoveLabel and friends).
  async function confirmRemoveStep(index: number): Promise<void> {
    const ok = await confirm('Remove this step? This cannot be undone.', { confirmLabel: 'Remove' })
    if (ok) removeStep(index)
  }
  // A step's own PropertiesSection is keyed by its (freshly generated,
  // never-before-seen) id, so isSectionOpen would default it to collapsed —
  // pre-seed the open-sections store so a step reads as expanded the moment
  // it's added, instead of forcing an extra click to see what was just
  // created.
  function addActionStep(): void {
    const id = nextId()
    setSectionOpen(id, true)
    onChange([...steps, { kind: 'action', id, action: { kind: 'none' } } satisfies ActionStep])
  }
  function addDelayStep(): void {
    const id = nextId()
    setSectionOpen(id, true)
    onChange([...steps, { kind: 'delay', id, delayMs: 250 } satisfies DelayStep])
  }
  function addConditionStep(): void {
    const id = nextId()
    setSectionOpen(id, true)
    onChange([...steps, { kind: 'condition', id, condition: '', whenTrue: [], whenFalse: [] } satisfies ConditionStep])
  }
  function setAllDelays(delayMs: number): void {
    onChange(steps.map((s) => (s.kind === 'delay' ? { ...s, delayMs } : s)))
  }
  function handleReorderStep(dropIndex: number): void {
    const dragIndex = dragStepIndex.current
    dragStepIndex.current = null
    if (dragIndex === null || dragIndex === dropIndex) return
    const next = [...steps]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(dropIndex > dragIndex ? dropIndex - 1 : dropIndex, 0, moved)
    onChange(next)
  }

  return (
    <PropertiesSection
      title={title}
      badge={steps.length}
      headerExtra={
        steps.some((s) => s.kind === 'delay') ? (
          <>
            <input
              type="number"
              min={0}
              value={bulkDelayMs}
              onChange={(e) => setBulkDelayMs(Math.max(0, Math.round(Number(e.target.value))))}
            />
            <button type="button" className="properties__file-button" onClick={() => setAllDelays(bulkDelayMs)}>
              Set all delays
            </button>
          </>
        ) : undefined
      }
    >
      {hint && <p className="properties__hint">{hint}</p>}
      {steps.length === 0 && <p className="properties__hint">No actions on this event.</p>}
      {steps.map((step, index) => (
        <PropertiesSection
          key={step.id}
          title={stepTitle(step)}
          sectionKey={step.id}
          onDragStart={() => (dragStepIndex.current = index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleReorderStep(index)}
          headerExtra={
            <button type="button" className="properties__file-remove" onClick={() => confirmRemoveStep(index)}>
              Delete
            </button>
          }
        >
          <SequenceStepFields
            step={step}
            onChange={(s) => patchStep(index, s)}
            onRemove={() => confirmRemoveStep(index)}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
            variableHint={variableHint}
          />
        </PropertiesSection>
      ))}
      {recording ? (
        <SequenceRecorder
          onRecorded={(recorded) => {
            if (recorded.length > 0) onChange([...steps, ...recorded])
            setRecording(false)
          }}
        />
      ) : (
        <div className="properties__file-row">
          <button type="button" className="properties__file-button" onClick={addActionStep}>
            + Add action
          </button>
          <button type="button" className="properties__file-button" onClick={addDelayStep}>
            + Add delay
          </button>
          <button type="button" className="properties__file-button" onClick={addConditionStep}>
            + Add condition
          </button>
          <button type="button" className="properties__file-button" onClick={() => setRecording(true)}>
            ● Record keys
          </button>
        </div>
      )}
    </PropertiesSection>
  )
}

// Spacing/radius/border-thickness for one base block in the currently
// active state. Any side touching another block of this widget is
// auto-computed (and its input disabled) whenever auto fit is on — the
// override values still shown for a locked field are what auto fit itself
// resolved to (see effectiveBlockAppearance), not the raw manual value,
// so the field reads correctly even while disabled.
function MorphBlockFields({
  block,
  merge,
  override,
  widgetColor,
  widgetBorderColor,
  widgetBackgroundOpacity,
  widgetBorderOpacity,
  onChange
}: {
  block: MorphBlock
  // Per-side: is this side currently coordinating an auto-fit seam with its
  // neighbor (see blockMerge in shared/morph.ts — requires both this
  // block's own autoFit AND the neighbor's to be on, not just adjacency).
  merge: BlockMerge
  override: MorphBlockStateOverride
  // Resolved widget-level fallbacks — what this block shows while its own
  // color/opacity fields are left on Auto (i.e. inherited, not overridden).
  widgetColor: string
  widgetBorderColor: string
  widgetBackgroundOpacity: number
  widgetBorderOpacity: number
  onChange: (fields: Partial<MorphBlockStateOverride>) => void
}): React.JSX.Element {
  const autoFit = override.autoFit ?? true
  const isColorExpr = override.colorExpr !== undefined
  const isAutoColor = override.color === undefined && !isColorExpr
  const isBorderColorExpr = override.borderColorExpr !== undefined
  const isAutoBorderColor = override.borderColor === undefined && !isBorderColorExpr
  const lockTop = merge.up
  const lockRight = merge.right
  const lockBottom = merge.down
  const lockLeft = merge.left
  const lockTopLeft = merge.up || merge.left
  const lockTopRight = merge.up || merge.right
  const lockBottomLeft = merge.down || merge.left
  const lockBottomRight = merge.down || merge.right

  return (
    <>
      <p className="properties__hint">
        Editing base block ({block.col}, {block.row})
      </p>

      <label className="properties__checkbox">
        <input type="checkbox" checked={autoFit} onChange={(e) => onChange({ autoFit: e.target.checked })} />
        Auto fit
      </label>
      <p className="properties__hint">
        Sides touching another block of this widget are computed automatically (disabled below) while auto fit is on.
      </p>

      <span className="properties__section-label">Color</span>
      <div className="properties__field">
        <span>Color</span>
        <ColorPickerButton
          key={`${block.id}-color`}
          value={override.color ?? widgetColor}
          onChange={(color) => onChange({ color, colorExpr: undefined })}
          isExpr={isColorExpr}
          exprValue={override.colorExpr ?? ''}
          onExprChange={(code) => onChange({ colorExpr: code })}
          onEnterExpr={() => onChange({ colorExpr: override.colorExpr ?? '' })}
          onClearExpr={() => onChange({ colorExpr: undefined })}
          auto={isAutoColor}
          onAuto={() => onChange({ color: undefined, colorExpr: undefined })}
          opacity={override.backgroundOpacity ?? widgetBackgroundOpacity}
          onOpacityChange={(v) => onChange({ backgroundOpacity: v })}
        />
      </div>
      <div className="properties__field">
        <span>Border color</span>
        <ColorPickerButton
          key={`${block.id}-border`}
          value={override.borderColor ?? widgetBorderColor}
          onChange={(color) => onChange({ borderColor: color, borderColorExpr: undefined })}
          isExpr={isBorderColorExpr}
          exprValue={override.borderColorExpr ?? ''}
          onExprChange={(code) => onChange({ borderColorExpr: code })}
          onEnterExpr={() => onChange({ borderColorExpr: override.borderColorExpr ?? '' })}
          onClearExpr={() => onChange({ borderColorExpr: undefined })}
          auto={isAutoBorderColor}
          onAuto={() => onChange({ borderColor: undefined, borderColorExpr: undefined })}
          opacity={override.borderOpacity ?? widgetBorderOpacity}
          onOpacityChange={(v) => onChange({ borderOpacity: v })}
        />
      </div>
      <p className="properties__hint">Auto inherits the widget's own color for this state — override here to make just this block different.</p>

      <span className="properties__section-label">Spacing</span>
      <SidesInputGrid
        top={{ value: lockTop ? -1 : (override.spacingTop ?? 0), min: -1, disabled: lockTop, onChange: (v) => onChange({ spacingTop: v }) }}
        right={{
          value: lockRight ? -1 : (override.spacingRight ?? 0),
          min: -1,
          disabled: lockRight,
          onChange: (v) => onChange({ spacingRight: v })
        }}
        bottom={{
          value: lockBottom ? -1 : (override.spacingBottom ?? 0),
          min: -1,
          disabled: lockBottom,
          onChange: (v) => onChange({ spacingBottom: v })
        }}
        left={{
          value: lockLeft ? -1 : (override.spacingLeft ?? 0),
          min: -1,
          disabled: lockLeft,
          onChange: (v) => onChange({ spacingLeft: v })
        }}
      />

      <span className="properties__section-label">Border radius</span>
      <CornersInputGrid
        topLeft={{
          value: lockTopLeft ? 0 : (override.radiusTopLeft ?? 4),
          min: 0,
          disabled: lockTopLeft,
          onChange: (v) => onChange({ radiusTopLeft: v })
        }}
        topRight={{
          value: lockTopRight ? 0 : (override.radiusTopRight ?? 4),
          min: 0,
          disabled: lockTopRight,
          onChange: (v) => onChange({ radiusTopRight: v })
        }}
        bottomLeft={{
          value: lockBottomLeft ? 0 : (override.radiusBottomLeft ?? 4),
          min: 0,
          disabled: lockBottomLeft,
          onChange: (v) => onChange({ radiusBottomLeft: v })
        }}
        bottomRight={{
          value: lockBottomRight ? 0 : (override.radiusBottomRight ?? 4),
          min: 0,
          disabled: lockBottomRight,
          onChange: (v) => onChange({ radiusBottomRight: v })
        }}
      />

      <span className="properties__section-label">Border thickness</span>
      <SidesInputGrid
        top={{ value: lockTop ? 0 : (override.borderWidthTop ?? 1), min: 0, disabled: lockTop, onChange: (v) => onChange({ borderWidthTop: v }) }}
        right={{
          value: lockRight ? 0 : (override.borderWidthRight ?? 1),
          min: 0,
          disabled: lockRight,
          onChange: (v) => onChange({ borderWidthRight: v })
        }}
        bottom={{
          value: lockBottom ? 0 : (override.borderWidthBottom ?? 1),
          min: 0,
          disabled: lockBottom,
          onChange: (v) => onChange({ borderWidthBottom: v })
        }}
        left={{
          value: lockLeft ? 0 : (override.borderWidthLeft ?? 1),
          min: 0,
          disabled: lockLeft,
          onChange: (v) => onChange({ borderWidthLeft: v })
        }}
      />
    </>
  )
}

function interfaceLabel(iface: DcsBiosInputInterface): string {
  switch (iface) {
    case 'set_state':
      return 'Set position'
    case 'fixed_step':
      return 'Step (INC/DEC)'
    case 'action':
      return 'Action'
    case 'variable_step':
      return 'Adjust by amount'
  }
}

// Straight from the confirmed real "Input Interfaces" documentation (see
// worker.ts/docParser.ts's own comments) — what a valid argument for this
// specific command actually looks like.
function commandValueHint(entry: DcsBiosCommandCatalogEntry): string {
  switch (entry.interface) {
    case 'set_state':
      return `number, 0–${entry.maxValue ?? 0}`
    case 'fixed_step':
      return 'INC or DEC'
    case 'action':
      return `fixed value: ${entry.argument ?? ''}`
    case 'variable_step':
      return `+NUMBER or -NUMBER (try ±${entry.suggestedStep ?? 3200}), position range 0–${entry.maxValue ?? 0}`
  }
}

function defaultArgumentFor(entry: DcsBiosCommandCatalogEntry): string {
  switch (entry.interface) {
    case 'set_state':
      return '0'
    case 'fixed_step':
      return 'INC'
    case 'action':
      return entry.argument ?? ''
    case 'variable_step':
      return `+${entry.suggestedStep ?? 3200}`
  }
}

// When `entries` is already relevance-sorted (a search is active), groups
// are left in the order their best entry first appears — a Map's keys
// iterate in insertion order, so the category containing the top-scoring
// entry (inserted first) naturally sorts first — instead of alphabetically,
// so the group holding a search's best/exact match is the one shown at the
// top rather than wherever its name happens to fall alphabetically.
function groupCommandsByCategory(
  entries: DcsBiosCommandCatalogEntry[],
  sortAlphabetically = true
): { category: string; entries: DcsBiosCommandCatalogEntry[] }[] {
  const byCategory = new Map<string, DcsBiosCommandCatalogEntry[]>()
  for (const entry of entries) {
    const list = byCategory.get(entry.category)
    if (list) list.push(entry)
    else byCategory.set(entry.category, [entry])
  }
  const groups = Array.from(byCategory, ([category, categoryEntries]) => ({ category, entries: categoryEntries }))
  return sortAlphabetically ? groups.sort((a, b) => a.category.localeCompare(b.category)) : groups
}

// Editor for a ButtonWidget's SendDcsCommandAction — aircraft picker, then a
// searchable single-select command browser (same category-grouped list
// pattern as EventSourcesModal's field browser, just single-select since a button
// fires exactly one command), then a value box with the same fx/expression
// toggle every other bindable value in this app uses (see MappingRow in
// EventSourcesModal.tsx). A "Test" button sends the CURRENTLY configured value
// immediately, using this editor's own live dashboard.variables for
// argumentExpr — useful for confirming a command actually does what's
// expected before wiring it to a real button click.
const OVERLAY_EDGE_OPTIONS: { value: OverlayEdge; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' }
]

function NavigateSubDeckActionEditor({
  action,
  subDecks,
  onPatch
}: {
  action: NavigateSubDeckAction
  subDecks: SubDeck[]
  onPatch: (fields: Partial<NavigateSubDeckAction>) => void
}): React.JSX.Element {
  return (
    <label className="properties__field">
      <span>Target screen</span>
      <select
        value={action.target.type === 'sub-deck' ? action.target.subDeckId : ''}
        onChange={(e) => onPatch({ target: e.target.value ? { type: 'sub-deck', subDeckId: e.target.value } : { type: 'main-deck' } })}
      >
        <option value="">Main deck</option>
        {subDecks.map((sd) => (
          <option key={sd.id} value={sd.id}>
            {sd.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function OpenOverlayActionEditor({
  action,
  subDecks,
  onPatch
}: {
  action: OpenOverlayAction
  subDecks: SubDeck[]
  onPatch: (fields: Partial<OpenOverlayAction>) => void
}): React.JSX.Element {
  return (
    <>
      <label className="properties__field">
        <span>Target screen</span>
        {subDecks.length === 0 ? (
          <span className="properties__hint-inline">No screens yet — add one from the toolbar's Screens button first.</span>
        ) : (
          <select value={action.subDeckId} onChange={(e) => onPatch({ subDeckId: e.target.value })}>
            {subDecks.map((sd) => (
              <option key={sd.id} value={sd.id}>
                {sd.name}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="properties__field">
        <span>Anchor edge</span>
        <select value={action.edge} onChange={(e) => onPatch({ edge: e.target.value as OverlayEdge })}>
          {OVERLAY_EDGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="properties__field">
        <span>Size</span>
        <div className="properties__file-row">
          <input type="number" min={1} value={action.size} onChange={(e) => onPatch({ size: Number(e.target.value) })} />
          <button
            type="button"
            className="unit-toggle"
            title="Toggle between pixels and percent of screen"
            onClick={() => onPatch({ sizeUnit: action.sizeUnit === 'px' ? 'percent' : 'px' })}
          >
            {action.sizeUnit === 'px' ? 'px' : '%'}
          </button>
        </div>
      </label>
    </>
  )
}

function SendDcsCommandActionEditor({
  action,
  onPatch,
  variableHint
}: {
  action: SendDcsCommandAction
  onPatch: (fields: Partial<SendDcsCommandAction>) => void
  // See ActionFields' own doc comment.
  variableHint?: string
}): React.JSX.Element {
  const dcsBiosAircraft = useDashboardStore((s) => s.dcsBiosAircraft)
  const requestDcsBiosAircraftList = useDashboardStore((s) => s.requestDcsBiosAircraftList)
  const dcsBiosCommandCatalogs = useDashboardStore((s) => s.dcsBiosCommandCatalogs)
  const requestDcsBiosCommandCatalog = useDashboardStore((s) => s.requestDcsBiosCommandCatalog)
  const sendDcsBiosCommand = useDashboardStore((s) => s.sendDcsBiosCommand)
  const dcsBiosSendCommandResult = useDashboardStore((s) => s.dcsBiosSendCommandResult)
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []

  const [browserOpen, setBrowserOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')

  // dcsBiosSendCommandResult is one global store field, shared by every open
  // SendDcsCommandActionEditor (Press, Release, every other event, on every
  // widget) — reading it straight would make clicking Test on ANY of them
  // flash a result on ALL of them. This captures it into local state instead,
  // only when THIS instance is the one that just fired a test (awaitingResult
  // below) — see handleTest.
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const awaitingResult = useRef(false)
  useEffect(() => {
    if (!awaitingResult.current) return
    awaitingResult.current = false
    setTestResult(dcsBiosSendCommandResult)
  }, [dcsBiosSendCommandResult])

  useEffect(() => {
    if (dcsBiosAircraft === null) requestDcsBiosAircraftList()
  }, [dcsBiosAircraft, requestDcsBiosAircraftList])

  useEffect(() => {
    if (action.aircraft && dcsBiosCommandCatalogs[action.aircraft] === undefined) requestDcsBiosCommandCatalog(action.aircraft)
  }, [action.aircraft, dcsBiosCommandCatalogs, requestDcsBiosCommandCatalog])

  const catalogState = action.aircraft ? dcsBiosCommandCatalogs[action.aircraft] : undefined
  const catalogEntries = useMemo(() => (Array.isArray(catalogState) ? catalogState : []), [catalogState])
  const selected = catalogEntries.find((c) => c.identifier === action.identifier && c.interface === action.interface)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return catalogEntries
    return catalogEntries
      .map((e) => ({
        entry: e,
        // Typing a DCS-BIOS identifier verbatim (e.g. "INS_SW") should
        // always surface that exact command first, even over a fuzzy match
        // against some longer identifier/label that happens to score just
        // as well otherwise (a plain substring run scores identically
        // whether it's the whole identifier or just part of a longer one —
        // see fuzzyScore) — so an exact identifier match is forced above
        // every fuzzy one instead of relying on score alone.
        score:
          e.identifier.toLowerCase() === needle
            ? Infinity
            : Math.max(
                fuzzyScore(needle, e.label.toLowerCase()),
                fuzzyScore(needle, e.identifier.toLowerCase()),
                fuzzyScore(needle, e.category.toLowerCase())
              )
      }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.entry)
  }, [catalogEntries, search])
  const hasSearch = search.trim().length > 0
  const groups = useMemo(() => groupCommandsByCategory(filtered, !hasSearch), [filtered, hasSearch])

  const isExpr = action.argumentExpr !== undefined
  const draftRef = useRef(action.argumentExpr ?? '')
  useEffect(() => {
    if (action.argumentExpr) draftRef.current = action.argumentExpr
  }, [action.argumentExpr])

  function pickAircraft(aircraft: string): void {
    onPatch({ aircraft, identifier: '', interface: 'action', argument: '' })
    setLastDcsAircraft(aircraft)
    setBrowserOpen(false)
  }

  function pickCommand(entry: DcsBiosCommandCatalogEntry): void {
    onPatch({
      identifier: entry.identifier,
      interface: entry.interface,
      // Only fills in a starting value when there wasn't one already —
      // switching to a different command shouldn't wipe out a value you'd
      // already set, but a genuinely blank field still gets a sensible
      // default instead of staying empty.
      argument: action.argument === '' ? defaultArgumentFor(entry) : action.argument,
      argumentExpr: undefined
    })
    setBrowserOpen(false)
  }

  function handleTest(): void {
    let arg: string
    // Mirrors runSendDcsCommand's own $value-shorthand precedence — see
    // DCS_COMMAND_VALUE_SHORTHAND's doc comment.
    const expr =
      isExpr && action.argumentExpr
        ? action.argumentExpr
        : action.argument.trim() === DCS_COMMAND_VALUE_SHORTHAND
          ? `return variables.${DCS_COMMAND_VALUE_SHORTHAND};`
          : undefined
    if (expr) {
      const result = tryEvaluateExpression(expr, toVariableMap(variables))
      if (!result.ok) return
      arg = String(result.value)
    } else {
      arg = action.argument
    }
    // Only marked AFTER the possible early return above — an expression that
    // fails to evaluate never actually sends anything, so there's no
    // response coming to claim; leaving awaitingResult set in that case
    // would incorrectly grab the next unrelated instance's result instead.
    awaitingResult.current = true
    setTestResult(null)
    sendDcsBiosCommand(action.identifier, arg)
  }

  return (
    <>
      <label className="properties__field">
        <span>Aircraft</span>
        {dcsBiosAircraft === null ? (
          <span className="properties__hint-inline">Loading aircraft…</span>
        ) : dcsBiosAircraft.length === 0 ? (
          <span className="properties__hint-inline">No installed DCS-BIOS aircraft found — check the docs folder in Settings.</span>
        ) : (
          <select value={action.aircraft} onChange={(e) => pickAircraft(e.target.value)}>
            <option value="">Pick an aircraft…</option>
            {dcsBiosAircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </label>

      {action.aircraft && (
        <label className="properties__field">
          <span>Command</span>
          <button
            type="button"
            className="properties__file-button"
            onClick={() => {
              // Opening with a command already selected seeds the search
              // with its own identifier, so the browser starts already
              // filtered to it (and its neighbors) instead of the full,
              // unfiltered catalog every time.
              if (!browserOpen && selected) setSearch(selected.identifier)
              setBrowserOpen((o) => !o)
            }}
          >
            {selected ? `${selected.category} — ${selected.label} — ${interfaceLabel(selected.interface)}` : 'Pick a command…'}
          </button>
        </label>
      )}

      {browserOpen && (
        <div className="events-modal__field-browser">
          {catalogState === undefined || catalogState === 'loading' ? (
            <p className="properties__hint">Loading commands…</p>
          ) : !Array.isArray(catalogState) ? (
            <p className="properties__hint dcsbios-settings__error">Failed to load commands: {catalogState.error}</p>
          ) : (
            <>
              <input
                className="variables-modal__search"
                type="text"
                placeholder={`Search ${catalogEntries.length} commands…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="events-modal__field-groups">
                {groups.map((group) => (
                  <details key={group.category} className="events-modal__field-category" open={hasSearch}>
                    <summary>
                      <span>{group.category}</span>
                      <span className="variables-modal__group-count">{group.entries.length}</span>
                    </summary>
                    <div className="events-modal__field-list">
                      {group.entries.map((entry) => (
                        <button
                          type="button"
                          key={`${entry.identifier}:${entry.interface}`}
                          className="events-modal__field-row events-modal__field-row--button"
                          onClick={() => pickCommand(entry)}
                        >
                          <span className="events-modal__field-label" title={entry.label}>
                            {entry.label}
                          </span>
                          <span className="events-modal__field-key">
                            {entry.identifier} · {interfaceLabel(entry.interface)}
                          </span>
                          <span className="events-modal__field-hint">{commandValueHint(entry)}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                ))}
                {groups.length === 0 && <p className="properties__hint">No commands match &quot;{search}&quot;.</p>}
              </div>
            </>
          )}
        </div>
      )}

      {action.identifier && (
        <>
          <label className="properties__field">
            <span>Value</span>
            <div className="properties__file-row">
              {isExpr ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input
                  value={action.argument}
                  onChange={(e) => onPatch({ argument: e.target.value })}
                  title={`Type ${DCS_COMMAND_VALUE_SHORTHAND} to send the value that triggered this action, same as an expression of "return variables.${DCS_COMMAND_VALUE_SHORTHAND};" below`}
                />
              )}
              {isExpr ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed value instead"
                  onClick={() => onPatch({ argumentExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title={`Compute the value with an expression — or type ${DCS_COMMAND_VALUE_SHORTHAND} in the Value field above as shorthand for "return variables.${DCS_COMMAND_VALUE_SHORTHAND};"`}
                  onClick={() => onPatch({ argumentExpr: draftRef.current })}
                >
                  ƒx
                </button>
              )}
              <button type="button" className="properties__file-button" onClick={handleTest}>
                Test
              </button>
              {testResult && (
                <span className={testResult.ok ? 'properties__hint-inline' : 'dcsbios-settings__error'}>
                  {testResult.ok ? 'Sent' : `Failed: ${testResult.error}`}
                </span>
              )}
            </div>
          </label>
          {selected && <p className="properties__hint">{commandValueHint(selected)}</p>}

          {isExpr && (
            // A plain div, not a <label> — button is a labelable element per
            // the HTML spec, so a <label> wrapping the Expand button below
            // would make a click ANYWHERE in this field (not just the
            // button itself) synthesize a click on it, same gotcha this
            // file's other CodeEditor fields already avoid (see e.g. the
            // visibleExpr field's own comment above).
            <div className="properties__field">
              <span>Expression</span>
              <div className="color-picker-button__expr-panel">
                <div className="color-picker-button__expr-editor-wrap">
                  <CodeEditor
                    value={action.argumentExpr ?? ''}
                    onChange={(code) => onPatch({ argumentExpr: code })}
                    placeholder={variableHint ? `return ${variableHint} === 'Top' ? '1' : '0';` : "return variables.my_variable > 0 ? 'ON' : 'OFF';"}
                    minimal
                  />
                  <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setExpanded(true)}>
                    ⤢
                  </button>
                </div>
              </div>
            </div>
          )}

          {expanded && (
            <ExpressionEditorModal
              value={action.argumentExpr ?? ''}
              onChange={(code) => onPatch({ argumentExpr: code })}
              placeholder={variableHint ? `return ${variableHint} === 'Top' ? '1' : '0';` : "return variables.my_variable > 0 ? 'ON' : 'OFF';"}
              onClose={() => setExpanded(false)}
            />
          )}
        </>
      )}
    </>
  )
}

// Editor for a ButtonWidget/AdjusterWidget's SetWindowsAudioAction — a
// device picker (same options as WindowsAudioConfigPanel's own), a Volume
// field with the same plain-value/$value-shorthand/expression precedence
// SendDcsCommandActionEditor's own Value field uses, and a Mute action
// select. No "Test" button here (unlike SendDcsCommandActionEditor) — DCS
// commands are cheap and inert to test blind; a live volume/mute change is
// neither, so it isn't offered as a one-click try-it.
function SetWindowsAudioActionEditor({
  action,
  onPatch,
  variableHint
}: {
  action: SetWindowsAudioAction
  onPatch: (fields: Partial<SetWindowsAudioAction>) => void
  // See ActionFields' own doc comment.
  variableHint?: string
}): React.JSX.Element {
  const isExpr = action.volumeExpr !== undefined

  return (
    <>
      <label className="properties__field">
        <span>Target</span>
        <WindowsAudioTargetPicker
          deviceName={action.deviceName}
          appName={action.appName}
          onChangeDeviceName={(deviceName) => onPatch({ deviceName })}
          onChangeAppName={(appName) => onPatch({ appName })}
        />
      </label>

      <label className="properties__field">
        <span>Volume</span>
        <div className="properties__file-row">
          {isExpr ? (
            <span className="properties__hint-inline">Using expression below</span>
          ) : (
            <input
              value={action.volume ?? ''}
              placeholder="0-100, leave blank to only touch mute"
              onChange={(e) => onPatch({ volume: e.target.value })}
              title={`Type ${DCS_COMMAND_VALUE_SHORTHAND} to send the value that triggered this action, same as an expression of "return variables.${DCS_COMMAND_VALUE_SHORTHAND};" below`}
            />
          )}
          {isExpr ? (
            <button type="button" className="color-picker-button__clear" title="Use a fixed value instead" onClick={() => onPatch({ volumeExpr: undefined })}>
              ×
            </button>
          ) : (
            <button
              type="button"
              className="color-picker-button__fx"
              title={`Compute the value with an expression — or type ${DCS_COMMAND_VALUE_SHORTHAND} in the Volume field above as shorthand for "return variables.${DCS_COMMAND_VALUE_SHORTHAND};"`}
              onClick={() => onPatch({ volumeExpr: '' })}
            >
              ƒx
            </button>
          )}
        </div>
      </label>
      {isExpr && (
        <div className="properties__field">
          <span>Expression</span>
          <div className="color-picker-button__expr-panel">
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor
                value={action.volumeExpr ?? ''}
                onChange={(code) => onPatch({ volumeExpr: code })}
                placeholder={variableHint ? `return ${variableHint};` : 'return variables.my_variable;'}
                minimal
              />
            </div>
          </div>
        </div>
      )}

      <label className="properties__field">
        <span>Mute</span>
        <select
          value={action.muteAction ?? 'none'}
          onChange={(e) => onPatch({ muteAction: e.target.value === 'none' ? undefined : (e.target.value as SetWindowsAudioAction['muteAction']) })}
        >
          <option value="none">Don&rsquo;t change</option>
          <option value="mute">Mute</option>
          <option value="unmute">Unmute</option>
          <option value="toggle">Toggle</option>
        </select>
      </label>
    </>
  )
}

const CALL_REST_EXPR_PLACEHOLDER = 'return variables.my_variable;'

// One placeholder's value row for a CallRestAction — same fx → inline panel
// → expand-to-modal interaction as SendDcsCommandActionEditor's own Value/
// argumentExpr field above (and MappingRow's expr toggle in EventSourcesModal.tsx).
function CallRestPlaceholderRow({
  entry,
  onPatch,
  variableHint
}: {
  entry: CallRestPlaceholderValue
  onPatch: (fields: Partial<CallRestPlaceholderValue>) => void
  // See ActionFields' own doc comment.
  variableHint?: string
}): React.JSX.Element {
  const isExpr = entry.expr !== undefined
  const [expanded, setExpanded] = useState(false)
  const draftRef = useRef(entry.expr ?? '')
  const placeholder = variableHint ? `return ${variableHint};` : CALL_REST_EXPR_PLACEHOLDER
  useEffect(() => {
    if (entry.expr) draftRef.current = entry.expr
  }, [entry.expr])

  return (
    // Plain div, not <label> — once isExpr is true this row has TWO
    // labelable descendants (the × clear button, the ⤢ expand button)
    // alongside CodeMirror's own contenteditable area, which ISN'T a
    // labelable form control. A <label> forwards any click that doesn't
    // land on a labelable element to the first one it contains — so a
    // click meant to focus the code editor was silently re-fired as a
    // click on the × button instead, clearing the expression the instant
    // you tried to start typing in it.
    <div className="properties__field">
      <span>{entry.placeholder}</span>
      <div className="properties__file-row">
        {isExpr ? (
          <span className="properties__hint-inline">Using expression below</span>
        ) : (
          <input value={entry.value} onChange={(e) => onPatch({ value: e.target.value })} />
        )}
        {isExpr ? (
          <button
            type="button"
            className="color-picker-button__clear"
            title="Use a fixed value instead"
            onClick={() => onPatch({ expr: undefined })}
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            className="color-picker-button__fx"
            title="Compute the value with an expression"
            onClick={() => onPatch({ expr: draftRef.current })}
          >
            ƒx
          </button>
        )}
      </div>

      {isExpr && (
        <div className="color-picker-button__expr-panel">
          <div className="color-picker-button__expr-editor-wrap">
            <CodeEditor value={entry.expr ?? ''} onChange={(code) => onPatch({ expr: code })} placeholder={placeholder} minimal />
            <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setExpanded(true)}>
              ⤢
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <ExpressionEditorModal value={entry.expr ?? ''} onChange={(code) => onPatch({ expr: code })} placeholder={placeholder} onClose={() => setExpanded(false)} />
      )}
    </div>
  )
}

// CallRestAction's editor — one row per {{placeholder}} token currently
// found in the target RestWebhookTarget's payloadTemplate OR any of its
// headers' own values (see extractAllPlaceholders in
// shared/restPlaceholders.ts), reconciled live against action.values by
// placeholder name. A stale values entry whose token no longer exists
// anywhere just isn't rendered (and is ignored at execution — see
// runCallRestAction in main/index.ts); it isn't deleted from the array
// either, in case the token comes back.
function CallRestActionEditor({
  action,
  restWebhookTargets,
  onPatch,
  variableHint
}: {
  action: CallRestAction
  restWebhookTargets: RestWebhookTarget[]
  onPatch: (fields: Partial<CallRestAction>) => void
  // See ActionFields' own doc comment.
  variableHint?: string
}): React.JSX.Element {
  const target = restWebhookTargets.find((t) => t.id === action.targetId)
  if (!target) {
    return <p className="properties__hint dcsbios-settings__error">This REST webhook target no longer exists — pick a different action.</p>
  }

  const placeholders = extractAllPlaceholders([target.payloadTemplate, ...target.headers.map((h) => h.value)])
  if (placeholders.length === 0) {
    return (
      <p className="properties__hint">
        This target's payload template or headers have no placeholders yet — add a {'{{name}}'} token to either in
        Settings to fill in a value here.
      </p>
    )
  }

  function patchPlaceholder(name: string, fields: Partial<CallRestPlaceholderValue>): void {
    const exists = action.values.some((v) => v.placeholder === name)
    const values = exists
      ? action.values.map((v) => (v.placeholder === name ? { ...v, ...fields } : v))
      : [...action.values, { placeholder: name, value: '', ...fields }]
    onPatch({ values })
  }

  return (
    <>
      {placeholders.map((name) => {
        const entry = action.values.find((v) => v.placeholder === name) ?? { placeholder: name, value: '' }
        return (
          <CallRestPlaceholderRow key={name} entry={entry} onPatch={(fields) => patchPlaceholder(name, fields)} variableHint={variableHint} />
        )
      })}
    </>
  )
}

// Shared between RockerSwitchWidget's and DialSwitchWidget's branches below
// — positions/reorder/rename/color/labels editing plus the "Active position"
// expression (see shared/switchPosition.ts) is identical for both; only the
// widget's own shape (segments vs. angles/needle) differs, handled by each
// branch itself. All UI state (which tab is being edited, drag-reorder,
// expression-modal-expanded) lives in the parent PropertiesPanel and is
// passed in, same reasoning as activeStateIndex living in the store for
// Button/Morph — it must survive this component unmounting/remounting as the
// selected widget changes type.
function SwitchPositionsEditor({
  positions,
  activePositionExpr,
  onPatchPositions,
  onPatchActivePositionExpr,
  activePositionIndex,
  setActivePositionIndex,
  onActivePositionIdChange,
  dragPositionIndex,
  activePositionExprExpanded,
  setActivePositionExprExpanded,
  confirm,
  showLabelAnchor = false,
  showPositionName = true,
  maxPositions,
  rootEvents
}: {
  positions: SwitchPosition[]
  activePositionExpr?: string
  onPatchPositions: (positions: SwitchPosition[]) => void
  onPatchActivePositionExpr: (expr: string | undefined) => void
  activePositionIndex: number
  setActivePositionIndex: (indexOrUpdater: number | ((current: number) => number)) => void
  // Rocker only (see its call site below) — keeps the canvas's click-through
  // position highlight (CanvasWidget.tsx's selectedPositionId) in sync with
  // whichever tab this panel is on, in both directions: a tab click here
  // calls this, and a canvas click drives activePositionIndex itself (see
  // the override PropertiesPanel computes before passing it down). Dial
  // switch has no canvas highlight to sync, so it just omits this prop.
  onActivePositionIdChange?: (positionId: string) => void
  dragPositionIndex: React.MutableRefObject<number | null>
  activePositionExprExpanded: boolean
  setActivePositionExprExpanded: (expanded: boolean) => void
  confirm: (message: string, options?: { confirmLabel?: string }) => Promise<boolean>
  // Dial switch only — WidgetLabel.labelAnchor only means anything for a
  // dial's radial detent layout, so rocker/dropdown (which reuse this same
  // positions editor) just leave it unset/unshown — passed through to each
  // position's LabelFields below.
  showLabelAnchor?: boolean
  // Toggle switch only — its position names are fixed (Top/Middle/Bottom,
  // see ToggleSwitchWidget's own comment in shared/types.ts), not freely
  // editable like Rocker/Dial/Dropdown's, so it hides this input entirely
  // rather than showing one that would just get silently overwritten the
  // next time a position is added/removed/reordered.
  showPositionName?: boolean
  // Toggle switch only — a physical lever only has a sensible 2-throw or
  // 3-throw (with a centered neutral) reading, unlike Rocker/Dial's
  // unlimited segments/detents, so it caps how many positions the "+"
  // button below will add. The 2-position floor is already enforced
  // unconditionally further down (see confirmDeletePosition/the "×" button's
  // own `positions.length > 2` guard) — this only adds a ceiling.
  maxPositions?: number
}): React.JSX.Element {
  const positionIndex = Math.min(activePositionIndex, positions.length - 1)
  const activePosition = positions[positionIndex] ?? positions[0]
  const isPositionColorExpr = activePosition.colorExpr !== undefined
  const unselectedColor = activePosition.color ?? DEFAULT_WIDGET_COLOR
  const isPositionActiveColorExpr = activePosition.activeColorExpr !== undefined
  const isAutoPositionActiveColor = activePosition.activeColor === undefined && !isPositionActiveColorExpr

  function patchPosition(fields: Partial<SwitchPosition>): void {
    onPatchPositions(positions.map((p, i) => (i === positionIndex ? { ...p, ...fields } : p)))
  }

  function patchPositionLabel(labelId: string, fields: Partial<WidgetLabel>): void {
    patchPosition({ labels: activePosition.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
  }

  function addPositionLabel(): void {
    patchPosition({ labels: [...activePosition.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
  }

  async function confirmRemovePositionLabel(labelId: string): Promise<void> {
    const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
    if (ok) patchPosition({ labels: activePosition.labels.filter((l) => l.id !== labelId) })
  }

  function handleAddPosition(): void {
    const newPosition: SwitchPosition = { id: nextId(), name: `Position ${positions.length + 1}`, labels: [], onSelect: [] }
    onPatchPositions([...positions, newPosition])
    setActivePositionIndex(positions.length)
    onActivePositionIdChange?.(newPosition.id)
  }

  function renamePosition(index: number, name: string): void {
    onPatchPositions(positions.map((p, i) => (i === index ? { ...p, name } : p)))
  }

  function indexAfterDelete(index: number, deletedIndex: number): number {
    if (index === deletedIndex) return Math.max(0, deletedIndex - 1)
    if (index > deletedIndex) return index - 1
    return index
  }

  async function confirmDeletePosition(index: number): Promise<void> {
    if (positions.length <= 2) return
    const ok = await confirm(`Delete the "${positions[index].name}" position? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (!ok) return
    const remaining = positions.filter((_, i) => i !== index)
    onPatchPositions(remaining)
    // activePositionIndex (the prop) rather than a functional updater — the
    // resulting index needs to be known synchronously here to also resolve
    // its id for onActivePositionIdChange, not just handed to setState.
    const newIndex = indexAfterDelete(activePositionIndex, index)
    setActivePositionIndex(newIndex)
    const newPosition = remaining[newIndex] ?? remaining[0]
    if (newPosition) onActivePositionIdChange?.(newPosition.id)
  }

  function handleReorderPosition(dropIndex: number): void {
    const dragIndex = dragPositionIndex.current
    dragPositionIndex.current = null
    if (dragIndex === null || dragIndex === dropIndex) return
    const reordered = [...positions]
    const [moved] = reordered.splice(dragIndex, 1)
    const target = dropIndex > dragIndex ? dropIndex - 1 : dropIndex
    reordered.splice(target, 0, moved)
    onPatchPositions(reordered)
    setActivePositionIndex(target)
    onActivePositionIdChange?.(moved.id)
  }

  return (
    <>
      <PropertiesSection title="Positions" badge={positions.length}>
        <p className="properties__hint">
          Each position is directly selectable (tap a segment/detent on the deployed switch) and fires its own action — see "Actions"
          below. Which one LOOKS active is normally just whichever this device last tapped; set "Active position" below to derive it
          from a shared variable instead.
        </p>
        <div className="properties__field">
          <span>Positions</span>
          <div className="color-picker-button__row">
            <div className="state-tabs-box">
              <div className="state-tabs">
                {positions.map((p, index) => (
                  <div
                    key={p.id}
                    className={`state-tab${index === positionIndex ? ' state-tab--active' : ''}`}
                    draggable
                    onDragStart={() => (dragPositionIndex.current = index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleReorderPosition(index)}
                    onClick={() => {
                      setActivePositionIndex(index)
                      onActivePositionIdChange?.(p.id)
                    }}
                  >
                    <span className="state-tab__name">{p.name}</span>
                    {positions.length > 2 && (
                      <button
                        type="button"
                        className="state-tab__remove"
                        title="Delete position"
                        onClick={(e) => {
                          e.stopPropagation()
                          confirmDeletePosition(index)
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {(maxPositions === undefined || positions.length < maxPositions) && (
                  <button type="button" className="state-tab state-tab--add" onClick={handleAddPosition} title="Add position">
                    +
                  </button>
                )}
              </div>
            </div>
            {activePositionExpr !== undefined ? (
              <button
                type="button"
                className="color-picker-button__clear"
                title="Stop deriving the active position from an expression"
                onClick={() => onPatchActivePositionExpr(undefined)}
              >
                ×
              </button>
            ) : (
              <button
                type="button"
                className="color-picker-button__fx"
                title="Derive the active position with an expression"
                onClick={() => onPatchActivePositionExpr('')}
              >
                ƒx
              </button>
            )}
          </div>
        </div>

        {activePositionExpr !== undefined && (
          <div className="color-picker-button__expr-panel">
            <p className="properties__hint">
              Returns the exact name of the position that should be active. Falls back to whichever position this device last tapped
              if it throws, returns something else, or names a position that doesn't exist.
            </p>
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor
                value={activePositionExpr}
                onChange={onPatchActivePositionExpr}
                placeholder={ACTIVE_POSITION_EXPR_PLACEHOLDER}
                minimal
              />
              <button
                type="button"
                className="color-picker-button__expand"
                title="Expand"
                onClick={() => setActivePositionExprExpanded(true)}
              >
                ⤢
              </button>
            </div>
          </div>
        )}

        {activePositionExprExpanded && (
          <ExpressionEditorModal
            value={activePositionExpr ?? ''}
            onChange={onPatchActivePositionExpr}
            placeholder={ACTIVE_POSITION_EXPR_PLACEHOLDER}
            onClose={() => setActivePositionExprExpanded(false)}
          />
        )}

        {showPositionName && (
          <label className="properties__field">
            <span>Position name</span>
            <input value={activePosition.name} onChange={(e) => renamePosition(positionIndex, e.target.value)} />
          </label>
        )}

        <div className="properties__divider" />

        <span className="properties__section-label">Color</span>
        <div className="properties__field">
          <span>Unselected color</span>
          <ColorPickerButton
            value={unselectedColor}
            onChange={(color) => patchPosition({ color, colorExpr: undefined })}
            isExpr={isPositionColorExpr}
            exprValue={activePosition.colorExpr ?? ''}
            onExprChange={(code) => patchPosition({ colorExpr: code })}
            onEnterExpr={() => patchPosition({ colorExpr: activePosition.colorExpr ?? '' })}
            onClearExpr={() => patchPosition({ colorExpr: undefined })}
            opacity={activePosition.backgroundOpacity ?? 1}
            onOpacityChange={(v) => patchPosition({ backgroundOpacity: v })}
          />
        </div>

        <div className="properties__field">
          <span>Selected color</span>
          <ColorPickerButton
            key={`${activePosition.id}-active-color`}
            value={activePosition.activeColor ?? pickAutoActiveColor(unselectedColor)}
            onChange={(color) => patchPosition({ activeColor: color, activeColorExpr: undefined })}
            isExpr={isPositionActiveColorExpr}
            exprValue={activePosition.activeColorExpr ?? ''}
            onExprChange={(code) => patchPosition({ activeColorExpr: code })}
            onEnterExpr={() => patchPosition({ activeColorExpr: activePosition.activeColorExpr ?? '' })}
            onClearExpr={() => patchPosition({ activeColorExpr: undefined })}
            auto={isAutoPositionActiveColor}
            onAuto={() => patchPosition({ activeColor: undefined, activeColorExpr: undefined })}
            opacity={activePosition.activeOpacity ?? activePosition.backgroundOpacity ?? 1}
            onOpacityChange={(v) => patchPosition({ activeOpacity: v })}
          />
        </div>

        <div className="properties__divider" />

        <span className="properties__section-label">Position labels</span>
        {activePosition.labels.map((label) => (
          <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
            <LabelFields
              label={label}
              backgroundColor={activePosition.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(fields) => patchPositionLabel(label.id, fields)}
              onRemove={() => confirmRemovePositionLabel(label.id)}
              showAnchor={showLabelAnchor}
            />
          </PropertiesSection>
        ))}
        <button type="button" className="properties__file-button" onClick={addPositionLabel}>
          + Add label
        </button>
      </PropertiesSection>
    </>
  )
}

// Split out of SwitchPositionsEditor (see its own comment) so each switch
// widget can render its Actions as its own top-level PropertiesSection,
// slotted alongside Button/Adjuster/Encoder's Actions instead of buried
// inside the positions editor. Still shares the same root-events + per-
// position-onSelect shape as before — only the render location changed.
function SwitchActionsSection({
  positions,
  onPatchPositions,
  dcsBiosActionEnabled,
  rootEvents
}: {
  positions: SwitchPosition[]
  onPatchPositions: (positions: SwitchPosition[]) => void
  dcsBiosActionEnabled: boolean
  // The widget's own root-level events (Press/Release/Position Change, plus
  // Turn CW/CCW for DialSwitchWidget only — see RockerSwitchWidget.events'
  // own doc comment in shared/types.ts) — shown in the SAME "Actions"
  // section as each position's own onSelect below, rather than a second,
  // separately-titled "Actions" section right next to this one. Each
  // caller builds its own list from its own widget.events shape, since
  // that shape differs per widget type (only DialSwitchWidget has
  // increment/decrement).
  rootEvents?: { title: string; steps: SequenceStep[]; onChange: (steps: SequenceStep[]) => void; hint?: string; variableHint?: string }[]
}): React.JSX.Element {
  return (
    <PropertiesSection title="Actions" badge={`${rootEvents?.length ?? 0} events · ${positions.length} positions`}>
      {rootEvents?.map((e) => (
        <EventSequenceEditor
          key={e.title}
          title={e.title}
          steps={e.steps}
          onChange={e.onChange}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          hint={e.hint}
          variableHint={e.variableHint}
        />
      ))}
      <p className="properties__hint">
        Every position's own sequence — each runs once, server-side, whenever that position is tapped. Editing here is independent
        of which position tab is selected above for color/label editing.
      </p>
      {positions.map((position, index) => (
        <EventSequenceEditor
          key={position.id}
          title={position.name}
          steps={position.onSelect}
          onChange={(steps) => onPatchPositions(positions.map((p, i) => (i === index ? { ...p, onSelect: steps } : p)))}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          variableHint="variables.$value"
        />
      ))}
    </PropertiesSection>
  )
}

export function PropertiesPanel(): React.JSX.Element {
  const dashboard = useDashboardStore((s) => s.dashboard)
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  const widgets = getSubDeckWidgets(dashboard, editingSubDeckId)
  const selectedWidgetIds = useDashboardStore((s) => s.selectedWidgetIds)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const canvasSize = useCanvasSize()
  const setCanvasSize = useDashboardStore((s) => s.setCanvasSize)
  const uploadBackgroundImage = useDashboardStore((s) => s.uploadBackgroundImage)
  const clearBackgroundImage = useDashboardStore((s) => s.clearBackgroundImage)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const removeWidgets = useDashboardStore((s) => s.removeWidgets)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const selectedBlockId = useDashboardStore((s) => s.selectedBlockId)
  const selectBlock = useDashboardStore((s) => s.selectBlock)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  // Built-in + uploaded fonts, for pickers that aren't a LabelFields instance
  // (which reads the store the same way itself) — e.g. GaugeWidget's own
  // tick-set label font, below.
  const customFonts = useDashboardStore((s) => s.customFonts)
  const fontOptions = [...FONT_OPTIONS, ...customFonts.map(customFontToOption)]
  const setActiveStateIndex = useDashboardStore((s) => s.setActiveStateIndex)
  const confirm = useConfirmStore((s) => s.confirm)

  // Gates the "Send DCS command" action-kind option — defaults to enabled
  // while the real setting is still loading (opt-out, not opt-in, matching
  // appSettings.ts's own default), rather than flashing the option away and
  // back once the fetch resolves.
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  useEffect(() => {
    if (enabledPlugins === null) requestAppSettings()
  }, [enabledPlugins, requestAppSettings])
  const dcsBiosActionEnabled = enabledPlugins === null || enabledPlugins.includes('dcsbios')

  // Populates ActionFields' own restWebhookTargets selector (see its
  // comment) without requiring the Settings modal to have been opened first
  // this session. `connected` guards this the same way the ScreenCapture
  // effect below documents — this component mounts before the WebSocket's
  // own 'open' event, and send() silently drops a message on a not-yet-open
  // socket with no retry, so without this the very first request routinely
  // got lost, leaving every "Call REST" action reading as a deleted target
  // forever (even though the action itself still worked — that round trip
  // happens well after the socket's long since connected).
  const restWebhookTargetsConnected = useDashboardStore((s) => s.connected)
  const requestRestWebhookTargets = useDashboardStore((s) => s.requestRestWebhookTargets)
  useEffect(() => {
    if (restWebhookTargetsConnected) requestRestWebhookTargets()
  }, [restWebhookTargetsConnected, requestRestWebhookTargets])

  // Same "fetch once if null" shape as enabledPlugins above, for
  // ScreenCaptureWidget's monitor dropdown — plus `connected` in the deps:
  // this component mounts (and this effect first fires) the instant a deck
  // id is set, which is synchronous and happens before the WebSocket's own
  // 'open' event — send() silently no-ops on a not-yet-open socket with no
  // retry of its own, so without `connected` here the very first request
  // routinely got dropped on the floor, leaving the dropdown empty forever.
  const connected = useDashboardStore((s) => s.connected)
  const screenCaptureDisplays = useDashboardStore((s) => s.screenCaptureDisplays)
  const requestScreenCaptureDisplays = useDashboardStore((s) => s.requestScreenCaptureDisplays)
  const pickScreenCaptureRegion = useDashboardStore((s) => s.pickScreenCaptureRegion)
  useEffect(() => {
    if (screenCaptureDisplays === null && connected) requestScreenCaptureDisplays()
  }, [screenCaptureDisplays, connected, requestScreenCaptureDisplays])
  // Which monitor "Pick region" targets next — local UI state, not saved
  // onto the widget until a region is actually picked (see the
  // screen-capture branch below), so changing this alone never leaves a
  // saved region mismatched against a different displayId.
  const [pickerDisplayId, setPickerDisplayId] = useState<number | null>(null)

  const propertiesWidth = useEditorSettings((s) => s.propertiesWidth)
  const setPropertiesWidth = useEditorSettings((s) => s.setPropertiesWidth)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useGridSize()
  const resizeState = useRef<ResizeState | null>(null)
  const dragStateIndex = useRef<number | null>(null)
  const [activeStateExprExpanded, setActiveStateExprExpanded] = useState(false)
  // Which of a switch widget's positions the panel below is editing (color/
  // labels/name) — independent of which position actually looks "live" on
  // any given client (see useSwitchPosition.ts), same split as Button's
  // activeStateIndex vs. isClicked. Declared unconditionally here (not
  // inside the switch branches below) so its hook order never changes across
  // a selection change from a switch widget to some other type — see
  // PropertiesSection/EventSequenceEditor's own hooks for the same reasoning.
  const [activePositionIndex, setActivePositionIndex] = useState(0)
  const dragPositionIndex = useRef<number | null>(null)
  const [activePositionExprExpanded, setActivePositionExprExpanded] = useState(false)
  // AdjusterWidget.valueExpr's own expand button — declared unconditionally
  // here (not inside the 'adjuster' branch below) for the same reason as
  // activePositionExprExpanded above: its hook order can't change across a
  // selection change to/from an adjuster.
  const [adjusterValueExprExpanded, setAdjusterValueExprExpanded] = useState(false)
  // GaugeWidget.showIndicatorExpr's own expand button — same "declared
  // unconditionally" reasoning as adjusterValueExprExpanded above.
  const [gaugeShowIndicatorExprExpanded, setGaugeShowIndicatorExprExpanded] = useState(false)

  const widget = selectedWidgetIds.length === 1 ? widgets.find((w) => w.id === selectedWidgetIds[0]) ?? null : null

  function handleResizePointerDown(e: React.PointerEvent): void {
    resizeState.current = { startX: e.clientX, startWidth: propertiesWidth }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
  }

  function handleResizePointerMove(e: React.PointerEvent): void {
    const state = resizeState.current
    if (!state) return
    setPropertiesWidth(state.startWidth + (state.startX - e.clientX))
  }

  function handleResizePointerUp(): void {
    resizeState.current = null
  }

  const resizeHandle = (
    <div
      className="properties__resize-handle"
      onPointerDown={handleResizePointerDown}
      onPointerMove={handleResizePointerMove}
      onPointerUp={handleResizePointerUp}
    />
  )

  if (selectedWidgetIds.length > 1) {
    async function handleDeleteMany(): Promise<void> {
      const ok = await confirm(`Delete ${selectedWidgetIds.length} widgets? This cannot be undone.`, { confirmLabel: 'Delete' })
      if (ok) removeWidgets(selectedWidgetIds)
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__hint">
          {selectedWidgetIds.length} widgets selected — select just one to edit its properties.
        </p>        <div className="properties__divider" />
        <button className="properties__delete" onClick={handleDeleteMany}>
          Delete {selectedWidgetIds.length} widgets
        </button>
        </div>
      </aside>
    )
  }

  if (!widget) {
    function handleImageFile(e: React.ChangeEvent<HTMLInputElement>): void {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') uploadBackgroundImage(reader.result)
      }
      reader.readAsDataURL(file)
      e.target.value = ''
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__hint">No widget selected — showing desktop properties.</p>

        <label className="properties__field">
          <span>Deck name</span>
          <input value={dashboard.name} onChange={(e) => updateDashboardMeta({ name: e.target.value })} />
        </label>

        <label
          className="properties__field"
          title="The reference resolution this screen's widgets are positioned against. Deployed clients (Chrome, tablet) scale/letterbox to this size rather than stretching to their own actual viewport — its own value per screen, same as grid size."
        >
          <span>Canvas size</span>
          <div className="color-picker-button__row">
            <input
              type="number"
              min={1}
              value={canvasSize.width}
              onChange={(e) => setCanvasSize(Number(e.target.value), canvasSize.height)}
            />
            <span>×</span>
            <input
              type="number"
              min={1}
              value={canvasSize.height}
              onChange={(e) => setCanvasSize(canvasSize.width, Number(e.target.value))}
            />
          </div>
        </label>

        <div className="properties__field">
          <span>Background color</span>
          <ColorPickerButton
            value={dashboard.backgroundColor}
            onChange={(color) => updateDashboardMeta({ backgroundColor: color, backgroundColorExpr: undefined })}
            isExpr={dashboard.backgroundColorExpr !== undefined}
            exprValue={dashboard.backgroundColorExpr ?? ''}
            onExprChange={(code) => updateDashboardMeta({ backgroundColorExpr: code })}
            onEnterExpr={() => updateDashboardMeta({ backgroundColorExpr: dashboard.backgroundColorExpr ?? '' })}
            onClearExpr={() => updateDashboardMeta({ backgroundColorExpr: undefined })}
          />
        </div>

        <div className="properties__divider" />

        <PropertiesSection title="Background image">
          <label className="properties__field">
            <span>Image</span>
            <div className="properties__file-row">
              <label className="properties__file-button">
                Choose image
                <input type="file" accept="image/*" onChange={handleImageFile} />
              </label>
              {dashboard.backgroundImageVersion && (
                <button type="button" className="properties__file-remove" onClick={clearBackgroundImage}>
                  Remove
                </button>
              )}
            </div>
          </label>

          {dashboard.backgroundImageVersion && (
            <>
              <label className="properties__field">
                <span>Fit</span>
                <select
                  value={dashboard.backgroundFit ?? 'cover'}
                  onChange={(e) => updateDashboardMeta({ backgroundFit: e.target.value as BackgroundFit })}
                >
                  {BACKGROUND_FITS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="properties__field">
                <span>Anchor</span>
                <div className="anchor-grid">
                  {ANCHOR_OPTIONS.map((anchor) => (
                    <button
                      key={anchor}
                      type="button"
                      className={`anchor-button${(dashboard.backgroundAnchor ?? 'center') === anchor ? ' anchor-button--active' : ''}`}
                      onClick={() => updateDashboardMeta({ backgroundAnchor: anchor })}
                      title={anchor}
                    />
                  ))}
                </div>
                <p className="properties__hint">Use "Actual size" fit with a corner anchor to place a fixed logo.</p>
              </label>
            </>
          )}
        </PropertiesSection>
        </div>
      </aside>
    )
  }

  if (widget.type === 'label') {
    const lw = widget
    const minSize = snapToGrid ? gridSize : 1

    function patchWidget(fields: Partial<LabelWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === lw.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchLabel(fields: Partial<WidgetLabel>): void {
      patchWidget({ label: { ...lw.label, ...fields } })
    }

    async function handleDeleteLabel(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(lw.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[lw.type]}</p>

        <PropertiesSection title="Label">
          <LabelFields label={lw.label} backgroundColor={DEFAULT_WIDGET_COLOR} onChange={patchLabel} onRemove={() => {}} showRemove={false} />
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={lw.x} onChange={(e) => patchWidget({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={lw.y} onChange={(e) => patchWidget({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={lw.w} onChange={(e) => patchWidget({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={lw.h} onChange={(e) => patchWidget({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={lw.zIndex ?? 0} onChange={(e) => patchWidget({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={lw.visible} visibleExpr={lw.visibleExpr} onChange={patchWidget} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteLabel}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'line') {
    const line = widget
    const minSize = snapToGrid ? gridSize : 1
    const isColorExpr = line.colorExpr !== undefined

    function patchLine(fields: Partial<LineWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === line.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    async function handleDeleteLine(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(line.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[line.type]}</p>

        <PropertiesSection title="Appearance">
          <div className="properties__field">
            <span>Color</span>
            <ColorPickerButton
              value={line.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchLine({ color, colorExpr: undefined })}
              isExpr={isColorExpr}
              exprValue={line.colorExpr ?? ''}
              onExprChange={(code) => patchLine({ colorExpr: code })}
              onEnterExpr={() => patchLine({ colorExpr: line.colorExpr ?? '' })}
              onClearExpr={() => patchLine({ colorExpr: undefined })}
            />
          </div>
          <label className="properties__field">
            <span>Line width</span>
            <input
              type="number"
              min={1}
              max={line.h}
              value={line.lineWidth ?? line.h}
              onChange={(e) => patchLine({ lineWidth: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <p className="properties__hint">
            The actual drawn thickness, centered within the box's own H (Advanced section below) — keep H taller than this for a
            roomier drag/click target on a thin line.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {line.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={line.rotateAngle ?? 0} onChange={(e) => patchLine({ rotateAngle: Number(e.target.value) })} />
              )}
              {line.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patchLine({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patchLine({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {line.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={line.rotateAngleExpr ?? ''}
              onChange={(code) => patchLine({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            The resize handle only ever changes length (W) — angle it away from horizontal with rotation instead of resizing H.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={line.x} onChange={(e) => patchLine({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={line.y} onChange={(e) => patchLine({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Length (W)</span>
              <input
                type="number"
                min={minSize}
                value={line.w}
                onChange={(e) => patchLine({ w: Math.max(minSize, Number(e.target.value)) })}
              />
            </label>
            <label className="properties__field">
              <span>Box height (H)</span>
              <input
                type="number"
                min={minSize}
                value={line.h}
                onChange={(e) => patchLine({ h: Math.max(minSize, Number(e.target.value)) })}
              />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={line.zIndex ?? 0} onChange={(e) => patchLine({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={line.visible} visibleExpr={line.visibleExpr} onChange={patchLine} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteLine}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'gauge-bar') {
    // Captured into a const rather than relying on control-flow narrowing of
    // `widget` persisting into the nested closures below — same reasoning as
    // ActionFields' own cast comment above (TS doesn't reliably retain a
    // narrowed type inside a closure that could in principle run later).
    const gauge = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = gauge.fill.colorExpr !== undefined
    const isTrackExpr = gauge.track.colorExpr !== undefined
    const isBorderExpr = gauge.borderColorExpr !== undefined

    function patchGauge(fields: Partial<BarGaugeWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === gauge.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchGaugeLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchGauge({ labels: gauge.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addGaugeLabel(): void {
      patchGauge({ labels: [...gauge.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveGaugeLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchGauge({ labels: gauge.labels.filter((l) => l.id !== labelId) })
    }

    async function handleDeleteGauge(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(gauge.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[gauge.type]}</p>

        <PropertiesSection title="Setup">
          <label className="properties__field">
            <span>Orientation</span>
            <select value={gauge.orientation ?? 'horizontal'} onChange={(e) => patchGauge({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>

          <div className="properties__grid2">
            <label className="properties__field">
              <span>Min value</span>
              <input type="number" value={gauge.min} onChange={(e) => patchGauge({ min: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Max value</span>
              <input type="number" value={gauge.max} onChange={(e) => patchGauge({ max: Number(e.target.value) })} />
            </label>
          </div>

          <ExpressionField
            label="Value"
            value={gauge.valueExpr}
            onChange={(code) => patchGauge({ valueExpr: code })}
            placeholder="return variables.my_variable ?? 0;"
          />
          <p className="properties__hint">
            JS function body — <code>variables</code> holds every variable&rsquo;s current value. Must return a number; anything else
            falls back to Min.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Background color</span>
            <ColorPickerButton
              value={gauge.backgroundColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchGauge({ backgroundColor: color })}
              opacity={gauge.backgroundOpacity ?? (gauge.backgroundColor === undefined ? 0 : 1)}
              onOpacityChange={(v) => patchGauge({ backgroundOpacity: v })}
            />
          </div>

          <div className="properties__field">
            <span>Fill color</span>
            <ColorPickerButton
              value={gauge.fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchGauge({ fill: { ...gauge.fill, color, colorExpr: undefined } })}
              isExpr={isFillExpr}
              exprValue={gauge.fill.colorExpr ?? ''}
              onExprChange={(code) => patchGauge({ fill: { ...gauge.fill, colorExpr: code } })}
              onEnterExpr={() => patchGauge({ fill: { ...gauge.fill, colorExpr: gauge.fill.colorExpr ?? '' } })}
              onClearExpr={() => patchGauge({ fill: { ...gauge.fill, colorExpr: undefined } })}
              opacity={gauge.fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchGauge({ fill: { ...gauge.fill, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Track color</span>
            <ColorPickerButton
              value={gauge.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchGauge({ track: { ...gauge.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={gauge.track.colorExpr ?? ''}
              onExprChange={(code) => patchGauge({ track: { ...gauge.track, colorExpr: code } })}
              onEnterExpr={() => patchGauge({ track: { ...gauge.track, colorExpr: gauge.track.colorExpr ?? '' } })}
              onClearExpr={() => patchGauge({ track: { ...gauge.track, colorExpr: undefined } })}
              opacity={gauge.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchGauge({ track: { ...gauge.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={gauge.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchGauge({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={gauge.borderColorExpr ?? ''}
              onExprChange={(code) => patchGauge({ borderColorExpr: code })}
              onEnterExpr={() => patchGauge({ borderColorExpr: gauge.borderColorExpr ?? '' })}
              onClearExpr={() => patchGauge({ borderColorExpr: undefined })}
              opacity={gauge.borderOpacity ?? 1}
              onOpacityChange={(v) => patchGauge({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Border shape">
          <span className="properties__section-label">Border radius</span>
          <CornersInputGrid
            topLeft={{ value: gauge.radiusTopLeft ?? 4, min: 0, onChange: (v) => patchGauge({ radiusTopLeft: v }) }}
            topRight={{ value: gauge.radiusTopRight ?? 4, min: 0, onChange: (v) => patchGauge({ radiusTopRight: v }) }}
            bottomLeft={{ value: gauge.radiusBottomLeft ?? 4, min: 0, onChange: (v) => patchGauge({ radiusBottomLeft: v }) }}
            bottomRight={{ value: gauge.radiusBottomRight ?? 4, min: 0, onChange: (v) => patchGauge({ radiusBottomRight: v }) }}
          />

          <div className="properties__divider" />

          <span className="properties__section-label">Border thickness</span>
          <SidesInputGrid
            top={{ value: gauge.borderWidthTop ?? 1, min: 0, onChange: (v) => patchGauge({ borderWidthTop: v }) }}
            right={{ value: gauge.borderWidthRight ?? 1, min: 0, onChange: (v) => patchGauge({ borderWidthRight: v }) }}
            bottom={{ value: gauge.borderWidthBottom ?? 1, min: 0, onChange: (v) => patchGauge({ borderWidthBottom: v }) }}
            left={{ value: gauge.borderWidthLeft ?? 1, min: 0, onChange: (v) => patchGauge({ borderWidthLeft: v }) }}
          />
        </PropertiesSection>

        <PropertiesSection title="Labels" badge={gauge.labels.length}>
          {gauge.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={gauge.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchGaugeLabel(label.id, fields)}
                onRemove={() => confirmRemoveGaugeLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addGaugeLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={gauge.x} onChange={(e) => patchGauge({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={gauge.y} onChange={(e) => patchGauge({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={gauge.w} onChange={(e) => patchGauge({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={gauge.h} onChange={(e) => patchGauge({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={gauge.zIndex ?? 0} onChange={(e) => patchGauge({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={gauge.visible} visibleExpr={gauge.visibleExpr} onChange={patchGauge} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteGauge}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'gauge-arc') {
    // Captured into a const rather than relying on control-flow narrowing of
    // `widget` persisting into the nested closures below — same reasoning as
    // ActionFields' own cast comment above (TS doesn't reliably retain a
    // narrowed type inside a closure that could in principle run later).
    const gauge = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = gauge.fill.colorExpr !== undefined
    const isTrackExpr = gauge.track.colorExpr !== undefined

    function patchGauge(fields: Partial<ArcGaugeWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === gauge.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchGaugeLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchGauge({ labels: gauge.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addGaugeLabel(): void {
      patchGauge({ labels: [...gauge.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveGaugeLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchGauge({ labels: gauge.labels.filter((l) => l.id !== labelId) })
    }

    const tickSets = gauge.tickSets ?? []

    function patchTickSet(tickSetId: string, fields: Partial<GaugeTickSet>): void {
      patchGauge({ tickSets: tickSets.map((t) => (t.id === tickSetId ? { ...t, ...fields } : t)) })
    }

    function addTickSet(): void {
      patchGauge({ tickSets: [...tickSets, { id: nextId(), count: 5, showLabels: true }] })
    }

    async function confirmRemoveTickSet(tickSetId: string): Promise<void> {
      const ok = await confirm('Remove this tick set? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchGauge({ tickSets: tickSets.filter((t) => t.id !== tickSetId) })
    }

    async function handleDeleteGauge(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(gauge.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[gauge.type]}</p>

        <PropertiesSection title="Setup">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>Start angle</span>
              <input type="number" value={gauge.startAngle ?? 135} onChange={(e) => patchGauge({ startAngle: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>End angle</span>
              <input type="number" value={gauge.endAngle ?? 405} onChange={(e) => patchGauge({ endAngle: Number(e.target.value) })} />
            </label>
          </div>

          <div className="properties__grid2">
            <label className="properties__field">
              <span>Min value</span>
              <input type="number" value={gauge.min} onChange={(e) => patchGauge({ min: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Max value</span>
              <input type="number" value={gauge.max} onChange={(e) => patchGauge({ max: Number(e.target.value) })} />
            </label>
          </div>

          <ExpressionField
            label="Value"
            value={gauge.valueExpr}
            onChange={(code) => patchGauge({ valueExpr: code })}
            placeholder="return variables.my_variable ?? 0;"
          />
          <p className="properties__hint">
            JS function body — <code>variables</code> holds every variable&rsquo;s current value. Must return a number; anything else
            falls back to Min.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Background color</span>
            <ColorPickerButton
              value={gauge.backgroundColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchGauge({ backgroundColor: color })}
              opacity={gauge.backgroundOpacity ?? (gauge.backgroundColor === undefined ? 0 : 1)}
              onOpacityChange={(v) => patchGauge({ backgroundOpacity: v })}
            />
          </div>

          <div className="properties__field">
            <span>Fill color</span>
            <ColorPickerButton
              value={gauge.fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchGauge({ fill: { ...gauge.fill, color, colorExpr: undefined } })}
              isExpr={isFillExpr}
              exprValue={gauge.fill.colorExpr ?? ''}
              onExprChange={(code) => patchGauge({ fill: { ...gauge.fill, colorExpr: code } })}
              onEnterExpr={() => patchGauge({ fill: { ...gauge.fill, colorExpr: gauge.fill.colorExpr ?? '' } })}
              onClearExpr={() => patchGauge({ fill: { ...gauge.fill, colorExpr: undefined } })}
              opacity={gauge.fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchGauge({ fill: { ...gauge.fill, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Track color</span>
            <ColorPickerButton
              value={gauge.track.color ?? ARC_DEFAULT_TRACK_COLOR}
              onChange={(color) => patchGauge({ track: { ...gauge.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={gauge.track.colorExpr ?? ''}
              onExprChange={(code) => patchGauge({ track: { ...gauge.track, colorExpr: code } })}
              onEnterExpr={() => patchGauge({ track: { ...gauge.track, colorExpr: gauge.track.colorExpr ?? '' } })}
              onClearExpr={() => patchGauge({ track: { ...gauge.track, colorExpr: undefined } })}
              opacity={gauge.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchGauge({ track: { ...gauge.track, backgroundOpacity: v } })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Ticks" badge={tickSets.length}>
              {tickSets.map((tickSet, i) => (
                <PropertiesSection key={tickSet.id} title={`Tick set ${i + 1}`} sectionKey={tickSet.id}>
                  <div className="properties__grid2">
                    <label className="properties__field">
                      <span>Count</span>
                      <input
                        type="number"
                        min={2}
                        value={tickSet.count ?? 5}
                        onChange={(e) => patchTickSet(tickSet.id, { count: Math.max(2, Math.round(Number(e.target.value))) })}
                      />
                    </label>
                    <label className="properties__field">
                      <span>Distance from center</span>
                      <input
                        type="number"
                        value={tickSet.distance ?? 46}
                        onChange={(e) => patchTickSet(tickSet.id, { distance: Number(e.target.value) })}
                      />
                    </label>
                    <label className="properties__field">
                      <span>Size</span>
                      <input
                        type="number"
                        min={0}
                        value={tickSet.size ?? 6}
                        onChange={(e) => patchTickSet(tickSet.id, { size: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                    <label className="properties__field">
                      <span>Thickness</span>
                      <input
                        type="number"
                        min={0}
                        value={tickSet.thickness ?? 2}
                        onChange={(e) => patchTickSet(tickSet.id, { thickness: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                  </div>

                  <div className="properties__field">
                    <span>Color</span>
                    <ColorPickerButton
                      value={tickSet.color ?? ARC_DEFAULT_TICK_COLOR}
                      onChange={(color) => patchTickSet(tickSet.id, { color })}
                      opacity={tickSet.opacity ?? 1}
                      onOpacityChange={(v) => patchTickSet(tickSet.id, { opacity: v })}
                    />
                  </div>

                  <div className="properties__grid2">
                    <div className="properties__field">
                      <span>Border color</span>
                      <ColorPickerButton value={tickSet.borderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => patchTickSet(tickSet.id, { borderColor: color })} />
                    </div>
                    <label className="properties__field">
                      <span>Border width</span>
                      <input
                        type="number"
                        min={0}
                        value={tickSet.borderWidth ?? 0}
                        onChange={(e) => patchTickSet(tickSet.id, { borderWidth: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                  </div>

                  <label className="properties__checkbox">
                    <input
                      type="checkbox"
                      checked={tickSet.showLabels ?? false}
                      onChange={(e) => patchTickSet(tickSet.id, { showLabels: e.target.checked })}
                    />
                    Show value labels
                  </label>

                  {tickSet.showLabels && (
                    <>
                      <label className="properties__field">
                        <span>Label font</span>
                        <select
                          value={resolveFont(tickSet.labelFontFamily).id}
                          onChange={(e) => patchTickSet(tickSet.id, { labelFontFamily: e.target.value })}
                          style={{ fontFamily: resolveFont(tickSet.labelFontFamily).cssFamily }}
                        >
                          {fontOptions.map((f) => (
                            <option key={f.id} value={f.id} style={{ fontFamily: f.cssFamily }}>
                              {f.label}
                              {f.monospace ? ' (mono)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="properties__grid2">
                        <label className="properties__field">
                          <span>Label font size</span>
                          <input
                            type="number"
                            min={1}
                            value={tickSet.labelFontSize ?? DEFAULT_WIDGET_FONT_SIZE}
                            onChange={(e) => patchTickSet(tickSet.id, { labelFontSize: Math.max(1, Number(e.target.value)) })}
                          />
                        </label>
                        <label className="properties__field">
                          <span>Label decimals</span>
                          <input
                            type="number"
                            min={0}
                            value={tickSet.labelDecimals ?? 0}
                            onChange={(e) => patchTickSet(tickSet.id, { labelDecimals: Math.max(0, Math.round(Number(e.target.value))) })}
                          />
                        </label>
                      </div>
                      <div className="properties__grid2">
                        <label className="properties__field">
                          <span>Label start</span>
                          <input
                            type="number"
                            placeholder={String(gauge.min)}
                            value={tickSet.labelMin ?? ''}
                            onChange={(e) => patchTickSet(tickSet.id, { labelMin: e.target.value === '' ? undefined : Number(e.target.value) })}
                          />
                        </label>
                        <label className="properties__field">
                          <span>Label end</span>
                          <input
                            type="number"
                            placeholder={String(gauge.max)}
                            value={tickSet.labelMax ?? ''}
                            onChange={(e) => patchTickSet(tickSet.id, { labelMax: e.target.value === '' ? undefined : Number(e.target.value) })}
                          />
                        </label>
                      </div>
                      <p className="properties__hint">
                        Only changes the numbers the ticks print — where they actually sit stays tied to the gauge's own Min/Max. Leave
                        blank to use the gauge's own {gauge.min}-{gauge.max} range.
                      </p>
                      <div className="properties__field">
                        <span>Label color</span>
                        <ColorPickerButton
                          value={tickSet.labelColor ?? pickLegibleTextColor(gauge.track.color ?? ARC_DEFAULT_TRACK_COLOR)}
                          onChange={(color) => patchTickSet(tickSet.id, { labelColor: color })}
                        />
                      </div>
                      <label className="properties__field">
                        <span>Label distance</span>
                        <input
                          type="number"
                          value={tickSet.labelDistance ?? 6}
                          onChange={(e) => patchTickSet(tickSet.id, { labelDistance: Number(e.target.value) })}
                        />
                      </label>
                      <ExpressionField
                        label="Label expression (optional)"
                        value={tickSet.labelTextExpr ?? ''}
                        onChange={(code) => patchTickSet(tickSet.id, { labelTextExpr: code || undefined })}
                        placeholder="return variables.$value.toFixed(1) + ' kt';"
                      />
                      <p className="properties__hint">
                        Overrides Label decimals — this tick's own already-computed value is available as variables.$value (its index in
                        the set as variables.$index), alongside every real Variable.
                      </p>
                    </>
                  )}

                  <button type="button" className="properties__file-remove" onClick={() => confirmRemoveTickSet(tickSet.id)}>
                    Remove tick set
                  </button>
                </PropertiesSection>
              ))}
              <button type="button" className="properties__file-button" onClick={addTickSet}>
                + Add tick set
              </button>
            </PropertiesSection>

            <PropertiesSection title="Indicator">
              <div className="properties__field">
                <div className="color-picker-button__row">
                  {gauge.showIndicatorExpr !== undefined ? (
                    <div className="color-picker-button__trigger color-picker-button__trigger--expr">ƒx</div>
                  ) : (
                    <label className="properties__checkbox" style={{ flex: 1, minWidth: 0 }}>
                      <input type="checkbox" checked={gauge.showIndicator ?? false} onChange={(e) => patchGauge({ showIndicator: e.target.checked })} />
                      Show needle indicator
                    </label>
                  )}
                  {gauge.showIndicatorExpr !== undefined ? (
                    <button
                      type="button"
                      className="color-picker-button__clear"
                      title="Use a fixed on/off value instead"
                      onClick={() => patchGauge({ showIndicatorExpr: undefined })}
                    >
                      ×
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="color-picker-button__fx"
                      title="Compute with an expression"
                      onClick={() => patchGauge({ showIndicatorExpr: '' })}
                    >
                      ƒx
                    </button>
                  )}
                </div>
                {gauge.showIndicatorExpr !== undefined && (
                  <div className="color-picker-button__expr-panel">
                    <div className="color-picker-button__expr-editor-wrap">
                      <CodeEditor
                        value={gauge.showIndicatorExpr ?? ''}
                        onChange={(code) => patchGauge({ showIndicatorExpr: code })}
                        placeholder={SHOW_INDICATOR_EXPR_PLACEHOLDER}
                        minimal
                      />
                      <button
                        type="button"
                        className="color-picker-button__expand"
                        title="Expand"
                        onClick={() => setGaugeShowIndicatorExprExpanded(true)}
                      >
                        ⤢
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {gaugeShowIndicatorExprExpanded && (
                <ExpressionEditorModal
                  value={gauge.showIndicatorExpr ?? ''}
                  onChange={(code) => patchGauge({ showIndicatorExpr: code })}
                  placeholder={SHOW_INDICATOR_EXPR_PLACEHOLDER}
                  onClose={() => setGaugeShowIndicatorExprExpanded(false)}
                />
              )}

              {(gauge.showIndicatorExpr !== undefined || gauge.showIndicator) && (
                <>
                  <label className="properties__field">
                    <span>Shape</span>
                    <select
                      value={gauge.indicatorShape ?? 'needle'}
                      onChange={(e) => patchGauge({ indicatorShape: e.target.value as ArcGaugeWidget['indicatorShape'] })}
                    >
                      <option value="needle">Needle</option>
                      <option value="square">Square</option>
                    </select>
                  </label>
                  <div className="properties__field">
                    <span>Indicator color</span>
                    <ColorPickerButton
                      value={gauge.indicatorColor ?? ARC_DEFAULT_INDICATOR_COLOR}
                      onChange={(color) => patchGauge({ indicatorColor: color })}
                    />
                  </div>
                  <div className="properties__grid2">
                    <label className="properties__field">
                      <span>Starts at</span>
                      <input
                        type="number"
                        min={0}
                        value={gauge.indicatorStartDistance ?? 0}
                        onChange={(e) => patchGauge({ indicatorStartDistance: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                    <label className="properties__field">
                      <span>Ends at</span>
                      <input
                        type="number"
                        min={0}
                        value={gauge.indicatorEndDistance ?? 29}
                        onChange={(e) => patchGauge({ indicatorEndDistance: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                  </div>
                  <p className="properties__hint">Distance from the widget&rsquo;s true center, in the same units as tick distance above.</p>
                  <label className="properties__field">
                    <span>Width</span>
                    <input
                      type="number"
                      min={0}
                      value={gauge.indicatorWidth ?? 2}
                      onChange={(e) => patchGauge({ indicatorWidth: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>

                  <div className="properties__divider" />

                  <span className="properties__section-label">Center circle</span>
                  <div className="properties__grid2">
                    <label className="properties__field">
                      <span>Size</span>
                      <input
                        type="number"
                        min={0}
                        value={gauge.indicatorCenterSize ?? 4}
                        onChange={(e) => patchGauge({ indicatorCenterSize: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                    <label className="properties__field">
                      <span>Border width</span>
                      <input
                        type="number"
                        min={0}
                        value={gauge.indicatorCenterBorderWidth ?? 0}
                        onChange={(e) => patchGauge({ indicatorCenterBorderWidth: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                  </div>
                  <div className="properties__grid2">
                    <div className="properties__field">
                      <span>Color</span>
                      <ColorPickerButton
                        value={gauge.indicatorCenterColor ?? gauge.indicatorColor ?? ARC_DEFAULT_INDICATOR_COLOR}
                        onChange={(color) => patchGauge({ indicatorCenterColor: color })}
                        auto={gauge.indicatorCenterColor === undefined}
                        onAuto={() => patchGauge({ indicatorCenterColor: undefined })}
                      />
                    </div>
                    <div className="properties__field">
                      <span>Border color</span>
                      <ColorPickerButton
                        value={gauge.indicatorCenterBorderColor ?? DEFAULT_WIDGET_COLOR}
                        onChange={(color) => patchGauge({ indicatorCenterBorderColor: color })}
                      />
                    </div>
                  </div>
                </>
              )}
            </PropertiesSection>

        <PropertiesSection title="Labels" badge={gauge.labels.length}>
          {gauge.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={gauge.track.color ?? ARC_DEFAULT_TRACK_COLOR}
                onChange={(fields) => patchGaugeLabel(label.id, fields)}
                onRemove={() => confirmRemoveGaugeLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addGaugeLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={gauge.x} onChange={(e) => patchGauge({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={gauge.y} onChange={(e) => patchGauge({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={gauge.w} onChange={(e) => patchGauge({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={gauge.h} onChange={(e) => patchGauge({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={gauge.zIndex ?? 0} onChange={(e) => patchGauge({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={gauge.visible} visibleExpr={gauge.visibleExpr} onChange={patchGauge} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteGauge}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'adjuster-slider') {
    const adjuster = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = adjuster.fill.colorExpr !== undefined
    const isTrackExpr = adjuster.track.colorExpr !== undefined
    const isBorderExpr = adjuster.borderColorExpr !== undefined

    function patchAdjuster(fields: Partial<AdjusterSliderWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === adjuster.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchAdjusterLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchAdjuster({ labels: adjuster.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addAdjusterLabel(): void {
      patchAdjuster({ labels: [...adjuster.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveAdjusterLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchAdjuster({ labels: adjuster.labels.filter((l) => l.id !== labelId) })
    }

    async function handleDeleteAdjuster(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(adjuster.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[adjuster.type]}</p>

        <PropertiesSection title="Setup">
          <label className="properties__field">
            <span>Orientation</span>
            <select value={adjuster.orientation ?? 'vertical'} onChange={(e) => patchAdjuster({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </label>

          <div className="properties__grid2">
            <label className="properties__field">
              <span>Min value</span>
              <input type="number" value={adjuster.min} onChange={(e) => patchAdjuster({ min: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Max value</span>
              <input type="number" value={adjuster.max} onChange={(e) => patchAdjuster({ max: Number(e.target.value) })} />
            </label>
          </div>

          <div className="properties__field">
            <span>Rest value (optional)</span>
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor
                value={adjuster.valueExpr ?? ''}
                onChange={(code) => patchAdjuster({ valueExpr: code || undefined })}
                placeholder="return variables.my_variable;"
                minimal
              />
              <button
                type="button"
                className="color-picker-button__expand"
                title="Expand"
                onClick={() => setAdjusterValueExprExpanded(true)}
              >
                ⤢
              </button>
            </div>
          </div>
          {adjusterValueExprExpanded && (
            <ExpressionEditorModal
              value={adjuster.valueExpr ?? ''}
              onChange={(code) => patchAdjuster({ valueExpr: code || undefined })}
              placeholder="return variables.my_variable;"
              onClose={() => setAdjusterValueExprExpanded(false)}
            />
          )}
          <p className="properties__hint">
            Where the handle sits while not being dragged — e.g. reflect a variable back into the visual. Falls back to Min if unset.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Handle">
          <label className="properties__field">
            <span>Shape</span>
            <select
              value={adjuster.handleShape ?? 'circle'}
              onChange={(e) => patchAdjuster({ handleShape: e.target.value as NonNullable<AdjusterSliderWidget['handleShape']> })}
            >
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="none">None</option>
            </select>
          </label>

          {(adjuster.handleShape ?? 'circle') !== 'none' && (
            <>
              {adjuster.handleShape === 'square' ? (
                <>
                  <div className="properties__grid2">
                    <label className="properties__field">
                      <span>Width</span>
                      <input
                        type="number"
                        min={1}
                        value={adjuster.handleWidth ?? adjuster.handleSize ?? 14}
                        onChange={(e) => patchAdjuster({ handleWidth: Math.max(1, Number(e.target.value)) })}
                      />
                    </label>
                    <label className="properties__field">
                      <span>Height</span>
                      <input
                        type="number"
                        min={1}
                        value={adjuster.handleHeight ?? adjuster.handleSize ?? 14}
                        onChange={(e) => patchAdjuster({ handleHeight: Math.max(1, Number(e.target.value)) })}
                      />
                    </label>
                  </div>
                  <label className="properties__field">
                    <span>Radius</span>
                    <input
                      type="number"
                      min={0}
                      value={adjuster.handleRadius ?? 0}
                      onChange={(e) => patchAdjuster({ handleRadius: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </>
              ) : (
                <label className="properties__field">
                  <span>Size</span>
                  <input
                    type="number"
                    min={1}
                    value={adjuster.handleSize ?? 14}
                    onChange={(e) => patchAdjuster({ handleSize: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
              )}
              <div className="properties__field">
                <span>Color</span>
                <ColorPickerButton
                  value={adjuster.handleColor ?? adjuster.fill.color ?? DEFAULT_WIDGET_COLOR}
                  onChange={(color) => patchAdjuster({ handleColor: color })}
                  auto={adjuster.handleColor === undefined}
                  onAuto={() => patchAdjuster({ handleColor: undefined })}
                  opacity={adjuster.handleOpacity ?? 1}
                  onOpacityChange={(v) => patchAdjuster({ handleOpacity: v })}
                />
              </div>
              <label className="properties__field">
                <span>Border width</span>
                <input
                  type="number"
                  min={0}
                  value={adjuster.handleBorderWidth ?? 0}
                  onChange={(e) => patchAdjuster({ handleBorderWidth: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <div className="properties__field">
                <span>Border color</span>
                <ColorPickerButton
                  value={adjuster.handleBorderColor ?? DEFAULT_WIDGET_COLOR}
                  onChange={(color) => patchAdjuster({ handleBorderColor: color })}
                  opacity={adjuster.handleBorderOpacity ?? 1}
                  onOpacityChange={(v) => patchAdjuster({ handleBorderOpacity: v })}
                />
              </div>
            </>
          )}
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Fill color</span>
            <ColorPickerButton
              value={adjuster.fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ fill: { ...adjuster.fill, color, colorExpr: undefined } })}
              isExpr={isFillExpr}
              exprValue={adjuster.fill.colorExpr ?? ''}
              onExprChange={(code) => patchAdjuster({ fill: { ...adjuster.fill, colorExpr: code } })}
              onEnterExpr={() => patchAdjuster({ fill: { ...adjuster.fill, colorExpr: adjuster.fill.colorExpr ?? '' } })}
              onClearExpr={() => patchAdjuster({ fill: { ...adjuster.fill, colorExpr: undefined } })}
              opacity={adjuster.fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ fill: { ...adjuster.fill, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Track color</span>
            <ColorPickerButton
              value={adjuster.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ track: { ...adjuster.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={adjuster.track.colorExpr ?? ''}
              onExprChange={(code) => patchAdjuster({ track: { ...adjuster.track, colorExpr: code } })}
              onEnterExpr={() => patchAdjuster({ track: { ...adjuster.track, colorExpr: adjuster.track.colorExpr ?? '' } })}
              onClearExpr={() => patchAdjuster({ track: { ...adjuster.track, colorExpr: undefined } })}
              opacity={adjuster.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ track: { ...adjuster.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={adjuster.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={adjuster.borderColorExpr ?? ''}
              onExprChange={(code) => patchAdjuster({ borderColorExpr: code })}
              onEnterExpr={() => patchAdjuster({ borderColorExpr: adjuster.borderColorExpr ?? '' })}
              onClearExpr={() => patchAdjuster({ borderColorExpr: undefined })}
              opacity={adjuster.borderOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Border shape">
          <span className="properties__section-label">Border radius</span>
          <CornersInputGrid
            topLeft={{ value: adjuster.radiusTopLeft ?? 8, min: 0, onChange: (v) => patchAdjuster({ radiusTopLeft: v }) }}
            topRight={{ value: adjuster.radiusTopRight ?? 8, min: 0, onChange: (v) => patchAdjuster({ radiusTopRight: v }) }}
            bottomLeft={{ value: adjuster.radiusBottomLeft ?? 8, min: 0, onChange: (v) => patchAdjuster({ radiusBottomLeft: v }) }}
            bottomRight={{ value: adjuster.radiusBottomRight ?? 8, min: 0, onChange: (v) => patchAdjuster({ radiusBottomRight: v }) }}
          />

          <div className="properties__divider" />

          <span className="properties__section-label">Border thickness</span>
          <SidesInputGrid
            top={{ value: adjuster.borderWidthTop ?? 1, min: 0, onChange: (v) => patchAdjuster({ borderWidthTop: v }) }}
            right={{ value: adjuster.borderWidthRight ?? 1, min: 0, onChange: (v) => patchAdjuster({ borderWidthRight: v }) }}
            bottom={{ value: adjuster.borderWidthBottom ?? 1, min: 0, onChange: (v) => patchAdjuster({ borderWidthBottom: v }) }}
            left={{ value: adjuster.borderWidthLeft ?? 1, min: 0, onChange: (v) => patchAdjuster({ borderWidthLeft: v }) }}
          />
        </PropertiesSection>

        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {adjuster.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={adjuster.rotateAngle ?? 0} onChange={(e) => patchAdjuster({ rotateAngle: Number(e.target.value) })} />
              )}
              {adjuster.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patchAdjuster({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patchAdjuster({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {adjuster.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={adjuster.rotateAngleExpr ?? ''}
              onChange={(code) => patchAdjuster({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            Spins the whole widget in place — the slider AND every one of its own labels together, unlike RockerSwitchWidget/
            DialSwitchWidget's own rotation, which keeps their widget-level labels upright. Falls back to the fixed angle if the
            expression is unset or fails to evaluate.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Labels" badge={adjuster.labels.length}>
          {adjuster.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={adjuster.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchAdjusterLabel(label.id, fields)}
                onRemove={() => confirmRemoveAdjusterLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addAdjusterLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <PropertiesSection title="Actions" badge={5}>
          <EventSequenceEditor
            title="Press"
            steps={adjuster.events.press}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, press: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Release"
            steps={adjuster.events.release}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, release: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Double press"
            steps={adjuster.events.doublePress ?? []}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, doublePress: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Triple press"
            steps={adjuster.events.triplePress ?? []}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, triplePress: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Double/Triple press only engage the double/triple-tap window at all once either has any steps — with both empty, Press
            fires the instant the drag starts, same as always.
          </p>
          <EventSequenceEditor
            title="Move (while dragging)"
            steps={adjuster.events.move}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, move: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Move fires continuously (throttled) while dragging — <code>variables.$value</code> is the live position ({adjuster.min}–
            {adjuster.max}). Press/Release fire once each, at the start/end of a drag gesture, with the same{' '}
            <code>variables.$value</code> available.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={adjuster.x} onChange={(e) => patchAdjuster({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={adjuster.y} onChange={(e) => patchAdjuster({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={adjuster.w} onChange={(e) => patchAdjuster({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={adjuster.h} onChange={(e) => patchAdjuster({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={adjuster.zIndex ?? 0} onChange={(e) => patchAdjuster({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={adjuster.visible} visibleExpr={adjuster.visibleExpr} onChange={patchAdjuster} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteAdjuster}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'adjuster-knob') {
    const adjuster = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = adjuster.fill.colorExpr !== undefined
    const isTrackExpr = adjuster.track.colorExpr !== undefined
    const isBorderExpr = adjuster.borderColorExpr !== undefined

    function patchAdjuster(fields: Partial<AdjusterKnobWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === adjuster.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchAdjusterLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchAdjuster({ labels: adjuster.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addAdjusterLabel(): void {
      patchAdjuster({ labels: [...adjuster.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveAdjusterLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchAdjuster({ labels: adjuster.labels.filter((l) => l.id !== labelId) })
    }

    const tickSets = adjuster.tickSets ?? []

    function patchTickSet(tickSetId: string, fields: Partial<GaugeTickSet>): void {
      patchAdjuster({ tickSets: tickSets.map((t) => (t.id === tickSetId ? { ...t, ...fields } : t)) })
    }

    function addTickSet(): void {
      patchAdjuster({ tickSets: [...tickSets, { id: nextId(), count: 5, showLabels: true }] })
    }

    async function confirmRemoveTickSet(tickSetId: string): Promise<void> {
      const ok = await confirm('Remove this tick set? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchAdjuster({ tickSets: tickSets.filter((t) => t.id !== tickSetId) })
    }

    async function handleDeleteAdjuster(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(adjuster.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[adjuster.type]}</p>

        <PropertiesSection title="Setup">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>Start angle</span>
              <input type="number" value={adjuster.startAngle ?? 135} onChange={(e) => patchAdjuster({ startAngle: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>End angle</span>
              <input type="number" value={adjuster.endAngle ?? 405} onChange={(e) => patchAdjuster({ endAngle: Number(e.target.value) })} />
            </label>
          </div>

          <div className="properties__grid2">
            <label className="properties__field">
              <span>Min value</span>
              <input type="number" value={adjuster.min} onChange={(e) => patchAdjuster({ min: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Max value</span>
              <input type="number" value={adjuster.max} onChange={(e) => patchAdjuster({ max: Number(e.target.value) })} />
            </label>
          </div>

          <div className="properties__field">
            <span>Rest value (optional)</span>
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor
                value={adjuster.valueExpr ?? ''}
                onChange={(code) => patchAdjuster({ valueExpr: code || undefined })}
                placeholder="return variables.my_variable;"
                minimal
              />
              <button
                type="button"
                className="color-picker-button__expand"
                title="Expand"
                onClick={() => setAdjusterValueExprExpanded(true)}
              >
                ⤢
              </button>
            </div>
          </div>
          {adjusterValueExprExpanded && (
            <ExpressionEditorModal
              value={adjuster.valueExpr ?? ''}
              onChange={(code) => patchAdjuster({ valueExpr: code || undefined })}
              placeholder="return variables.my_variable;"
              onClose={() => setAdjusterValueExprExpanded(false)}
            />
          )}
          <p className="properties__hint">
            Where the handle sits while not being dragged — e.g. reflect a variable back into the visual. Falls back to Min if unset.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Base circle">
          <p className="properties__hint">The dial face behind the arc/indicator — border reuses Border color above.</p>
          <label className="properties__field">
            <span>Base circle size</span>
            <input
              type="number"
              min={1}
              value={adjuster.bezelRadius ?? 32}
              onChange={(e) => patchAdjuster({ bezelRadius: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <div className="properties__field">
            <span>Base circle color</span>
            <ColorPickerButton
              value={adjuster.bezelColor ?? adjuster.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ bezelColor: color })}
              auto={adjuster.bezelColor === undefined}
              onAuto={() => patchAdjuster({ bezelColor: undefined })}
              opacity={adjuster.bezelOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ bezelOpacity: v })}
            />
          </div>
          <label className="properties__field">
            <span>Base circle border width</span>
            <input
              type="number"
              min={0}
              value={adjuster.bezelBorderWidth ?? 0}
              onChange={(e) => patchAdjuster({ bezelBorderWidth: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </PropertiesSection>

        <PropertiesSection title="Inner circle">
          <label className="properties__field">
            <span>Inner circle size</span>
            <input
              type="number"
              min={0}
              value={adjuster.innerBezelRadius ?? 0}
              onChange={(e) => patchAdjuster({ innerBezelRadius: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <p className="properties__hint">A second circle drawn on top of the base circle. 0 hides it entirely.</p>
          <div className="properties__field">
            <span>Inner circle color</span>
            <ColorPickerButton
              value={adjuster.innerBezelColor ?? adjuster.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ innerBezelColor: color })}
              auto={adjuster.innerBezelColor === undefined}
              onAuto={() => patchAdjuster({ innerBezelColor: undefined })}
              opacity={adjuster.innerBezelOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ innerBezelOpacity: v })}
            />
          </div>
          <label className="properties__field">
            <span>Inner circle border width</span>
            <input
              type="number"
              min={0}
              value={adjuster.innerBezelBorderWidth ?? 0}
              onChange={(e) => patchAdjuster({ innerBezelBorderWidth: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <div className="properties__field">
            <span>Inner circle border color</span>
            <ColorPickerButton
              value={adjuster.innerBezelBorderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ innerBezelBorderColor: color })}
            />
          </div>
        </PropertiesSection>

        <DialShapeFields
          value={adjuster}
          onChange={patchAdjuster}
          fill={adjuster.fill}
          onFillChange={(fill) => patchAdjuster({ fill })}
          track={adjuster.track}
          needleColorLabel="Needle color"
        />

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Fill color</span>
            <ColorPickerButton
              value={adjuster.fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ fill: { ...adjuster.fill, color, colorExpr: undefined } })}
              isExpr={isFillExpr}
              exprValue={adjuster.fill.colorExpr ?? ''}
              onExprChange={(code) => patchAdjuster({ fill: { ...adjuster.fill, colorExpr: code } })}
              onEnterExpr={() => patchAdjuster({ fill: { ...adjuster.fill, colorExpr: adjuster.fill.colorExpr ?? '' } })}
              onClearExpr={() => patchAdjuster({ fill: { ...adjuster.fill, colorExpr: undefined } })}
              opacity={adjuster.fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ fill: { ...adjuster.fill, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Track color</span>
            <ColorPickerButton
              value={adjuster.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ track: { ...adjuster.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={adjuster.track.colorExpr ?? ''}
              onExprChange={(code) => patchAdjuster({ track: { ...adjuster.track, colorExpr: code } })}
              onEnterExpr={() => patchAdjuster({ track: { ...adjuster.track, colorExpr: adjuster.track.colorExpr ?? '' } })}
              onClearExpr={() => patchAdjuster({ track: { ...adjuster.track, colorExpr: undefined } })}
              opacity={adjuster.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ track: { ...adjuster.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={adjuster.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchAdjuster({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={adjuster.borderColorExpr ?? ''}
              onExprChange={(code) => patchAdjuster({ borderColorExpr: code })}
              onEnterExpr={() => patchAdjuster({ borderColorExpr: adjuster.borderColorExpr ?? '' })}
              onClearExpr={() => patchAdjuster({ borderColorExpr: undefined })}
              opacity={adjuster.borderOpacity ?? 1}
              onOpacityChange={(v) => patchAdjuster({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Ticks" badge={tickSets.length}>
            {tickSets.map((tickSet, i) => (
              <PropertiesSection key={tickSet.id} title={`Tick set ${i + 1}`} sectionKey={tickSet.id}>
                <div className="properties__grid2">
                  <label className="properties__field">
                    <span>Count</span>
                    <input
                      type="number"
                      min={2}
                      value={tickSet.count ?? 5}
                      onChange={(e) => patchTickSet(tickSet.id, { count: Math.max(2, Math.round(Number(e.target.value))) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Distance from center</span>
                    <input
                      type="number"
                      value={tickSet.distance ?? 46}
                      onChange={(e) => patchTickSet(tickSet.id, { distance: Number(e.target.value) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Size</span>
                    <input
                      type="number"
                      min={0}
                      value={tickSet.size ?? 6}
                      onChange={(e) => patchTickSet(tickSet.id, { size: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Thickness</span>
                    <input
                      type="number"
                      min={0}
                      value={tickSet.thickness ?? 2}
                      onChange={(e) => patchTickSet(tickSet.id, { thickness: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>

                <div className="properties__field">
                  <span>Color</span>
                  <ColorPickerButton
                    value={tickSet.color ?? '#ffffff'}
                    onChange={(color) => patchTickSet(tickSet.id, { color })}
                    opacity={tickSet.opacity ?? 1}
                    onOpacityChange={(v) => patchTickSet(tickSet.id, { opacity: v })}
                  />
                </div>

                <div className="properties__grid2">
                  <div className="properties__field">
                    <span>Border color</span>
                    <ColorPickerButton value={tickSet.borderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => patchTickSet(tickSet.id, { borderColor: color })} />
                  </div>
                  <label className="properties__field">
                    <span>Border width</span>
                    <input
                      type="number"
                      min={0}
                      value={tickSet.borderWidth ?? 0}
                      onChange={(e) => patchTickSet(tickSet.id, { borderWidth: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>

                <label className="properties__checkbox">
                  <input
                    type="checkbox"
                    checked={tickSet.showLabels ?? false}
                    onChange={(e) => patchTickSet(tickSet.id, { showLabels: e.target.checked })}
                  />
                  Show value labels
                </label>

                {tickSet.showLabels && (
                  <>
                    <label className="properties__field">
                      <span>Label font</span>
                      <select
                        value={resolveFont(tickSet.labelFontFamily).id}
                        onChange={(e) => patchTickSet(tickSet.id, { labelFontFamily: e.target.value })}
                        style={{ fontFamily: resolveFont(tickSet.labelFontFamily).cssFamily }}
                      >
                        {fontOptions.map((f) => (
                          <option key={f.id} value={f.id} style={{ fontFamily: f.cssFamily }}>
                            {f.label}
                            {f.monospace ? ' (mono)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="properties__grid2">
                      <label className="properties__field">
                        <span>Label font size</span>
                        <input
                          type="number"
                          min={1}
                          value={tickSet.labelFontSize ?? DEFAULT_WIDGET_FONT_SIZE}
                          onChange={(e) => patchTickSet(tickSet.id, { labelFontSize: Math.max(1, Number(e.target.value)) })}
                        />
                      </label>
                      <label className="properties__field">
                        <span>Label decimals</span>
                        <input
                          type="number"
                          min={0}
                          value={tickSet.labelDecimals ?? 0}
                          onChange={(e) => patchTickSet(tickSet.id, { labelDecimals: Math.max(0, Math.round(Number(e.target.value))) })}
                        />
                      </label>
                    </div>
                    <div className="properties__grid2">
                      <label className="properties__field">
                        <span>Label start</span>
                        <input
                          type="number"
                          placeholder={String(adjuster.min)}
                          value={tickSet.labelMin ?? ''}
                          onChange={(e) => patchTickSet(tickSet.id, { labelMin: e.target.value === '' ? undefined : Number(e.target.value) })}
                        />
                      </label>
                      <label className="properties__field">
                        <span>Label end</span>
                        <input
                          type="number"
                          placeholder={String(adjuster.max)}
                          value={tickSet.labelMax ?? ''}
                          onChange={(e) => patchTickSet(tickSet.id, { labelMax: e.target.value === '' ? undefined : Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    <p className="properties__hint">
                      Only changes the numbers the ticks print — where they actually sit stays tied to the knob's own Min/Max. Leave
                      blank to use the knob's own {adjuster.min}-{adjuster.max} range.
                    </p>
                    <div className="properties__field">
                      <span>Label color</span>
                      <ColorPickerButton
                        value={tickSet.labelColor ?? pickLegibleTextColor(adjuster.track.color ?? DEFAULT_WIDGET_COLOR)}
                        onChange={(color) => patchTickSet(tickSet.id, { labelColor: color })}
                      />
                    </div>
                    <label className="properties__field">
                      <span>Label distance</span>
                      <input
                        type="number"
                        value={tickSet.labelDistance ?? 6}
                        onChange={(e) => patchTickSet(tickSet.id, { labelDistance: Number(e.target.value) })}
                      />
                    </label>
                    <ExpressionField
                      label="Label expression (optional)"
                      value={tickSet.labelTextExpr ?? ''}
                      onChange={(code) => patchTickSet(tickSet.id, { labelTextExpr: code || undefined })}
                      placeholder="return variables.$value.toFixed(1) + ' kt';"
                    />
                    <p className="properties__hint">
                      Overrides Label decimals — this tick's own already-computed value is available as variables.$value (its index in
                      the set as variables.$index), alongside every real Variable.
                    </p>
                  </>
                )}

                <button type="button" className="properties__file-remove" onClick={() => confirmRemoveTickSet(tickSet.id)}>
                  Remove tick set
                </button>
              </PropertiesSection>
            ))}
            <button type="button" className="properties__file-button" onClick={addTickSet}>
              + Add tick set
            </button>
        </PropertiesSection>

        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {adjuster.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={adjuster.rotateAngle ?? 0} onChange={(e) => patchAdjuster({ rotateAngle: Number(e.target.value) })} />
              )}
              {adjuster.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patchAdjuster({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patchAdjuster({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {adjuster.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={adjuster.rotateAngleExpr ?? ''}
              onChange={(code) => patchAdjuster({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            Spins the whole widget in place — the knob AND every one of its own labels together, unlike RockerSwitchWidget/
            DialSwitchWidget's own rotation, which keeps their widget-level labels upright. Falls back to the fixed angle if the
            expression is unset or fails to evaluate.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Labels" badge={adjuster.labels.length}>
          {adjuster.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={adjuster.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchAdjusterLabel(label.id, fields)}
                onRemove={() => confirmRemoveAdjusterLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addAdjusterLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <PropertiesSection title="Actions" badge={5}>
          <EventSequenceEditor
            title="Press"
            steps={adjuster.events.press}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, press: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Release"
            steps={adjuster.events.release}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, release: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Double press"
            steps={adjuster.events.doublePress ?? []}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, doublePress: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Triple press"
            steps={adjuster.events.triplePress ?? []}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, triplePress: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Double/Triple press only engage the double/triple-tap window at all once either has any steps — with both empty, Press
            fires the instant the drag starts, same as always.
          </p>
          <EventSequenceEditor
            title="Move (while dragging)"
            steps={adjuster.events.move}
            onChange={(steps) => patchAdjuster({ events: { ...adjuster.events, move: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Move fires continuously (throttled) while dragging — <code>variables.$value</code> is the live position ({adjuster.min}–
            {adjuster.max}). Press/Release fire once each, at the start/end of a drag gesture, with the same{' '}
            <code>variables.$value</code> available.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={adjuster.x} onChange={(e) => patchAdjuster({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={adjuster.y} onChange={(e) => patchAdjuster({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={adjuster.w} onChange={(e) => patchAdjuster({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={adjuster.h} onChange={(e) => patchAdjuster({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={adjuster.zIndex ?? 0} onChange={(e) => patchAdjuster({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={adjuster.visible} visibleExpr={adjuster.visibleExpr} onChange={patchAdjuster} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteAdjuster}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'encoder') {
    const encoder = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = encoder.track.colorExpr !== undefined
    const isBorderExpr = encoder.borderColorExpr !== undefined

    function patchEncoder(fields: Partial<EncoderWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === encoder.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchEncoderLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchEncoder({ labels: encoder.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addEncoderLabel(): void {
      patchEncoder({ labels: [...encoder.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveEncoderLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchEncoder({ labels: encoder.labels.filter((l) => l.id !== labelId) })
    }

    const tickSets = encoder.tickSets ?? []

    function patchTickSet(tickSetId: string, fields: Partial<EncoderTickSet>): void {
      patchEncoder({ tickSets: tickSets.map((t) => (t.id === tickSetId ? { ...t, ...fields } : t)) })
    }

    function addTickSet(): void {
      patchEncoder({ tickSets: [...tickSets, { id: nextId(), count: 12 }] })
    }

    async function confirmRemoveTickSet(tickSetId: string): Promise<void> {
      const ok = await confirm('Remove this tick set? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchEncoder({ tickSets: tickSets.filter((t) => t.id !== tickSetId) })
    }

    async function handleDeleteEncoder(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(encoder.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[encoder.type]}</p>

        <PropertiesSection title="Setup">
          <label className="properties__field">
            <span>Degrees per step</span>
            <input
              type="number"
              min={1}
              value={encoder.stepDegrees ?? 15}
              onChange={(e) => patchEncoder({ stepDegrees: Math.max(1, Math.round(Number(e.target.value))) })}
            />
          </label>
          <p className="properties__hint">
            How far (in degrees) a circular drag has to travel before firing one Turn CW/CCW step — smaller is more sensitive. This
            widget has no fixed range: DCS owns the real position, this just reports "turned one detent" (fixed_step INC/DEC).
          </p>

          <ExpressionField
            label="Rest value (optional)"
            value={encoder.valueExpr ?? ''}
            onChange={(code) => patchEncoder({ valueExpr: code || undefined })}
            placeholder="return variables.my_variable;"
          />
          <p className="properties__hint">
            Where the grip points (in degrees, 0 = up) while not being dragged — e.g. reflect a variable back into the visual. Pair
            with a Turn CW/CCW action below that nudges that same variable by the step size. Falls back to 0 if unset.
          </p>
        </PropertiesSection>

        <DialShapeFields
          value={encoder}
          onChange={patchEncoder}
          fill={encoder.fill}
          onFillChange={(fill) => patchEncoder({ fill })}
          track={encoder.track}
          needleColorLabel="Needle color"
        />

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Dial face color</span>
            <ColorPickerButton
              value={encoder.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchEncoder({ track: { ...encoder.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={encoder.track.colorExpr ?? ''}
              onExprChange={(code) => patchEncoder({ track: { ...encoder.track, colorExpr: code } })}
              onEnterExpr={() => patchEncoder({ track: { ...encoder.track, colorExpr: encoder.track.colorExpr ?? '' } })}
              onClearExpr={() => patchEncoder({ track: { ...encoder.track, colorExpr: undefined } })}
              opacity={encoder.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchEncoder({ track: { ...encoder.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={encoder.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchEncoder({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={encoder.borderColorExpr ?? ''}
              onExprChange={(code) => patchEncoder({ borderColorExpr: code })}
              onEnterExpr={() => patchEncoder({ borderColorExpr: encoder.borderColorExpr ?? '' })}
              onClearExpr={() => patchEncoder({ borderColorExpr: undefined })}
              opacity={encoder.borderOpacity ?? 1}
              onOpacityChange={(v) => patchEncoder({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Ticks" badge={tickSets.length}>
          <p className="properties__hint">
            Decorative marks around the full dial, evenly spaced — this widget has no fixed range (see Step above) to interpolate a
            value from, so unlike a Gauge's ticks these have no labels.
          </p>
          {tickSets.map((tickSet, i) => (
            <PropertiesSection key={tickSet.id} title={`Tick set ${i + 1}`} sectionKey={tickSet.id}>
              <div className="properties__grid2">
                <label className="properties__field">
                  <span>Count</span>
                  <input
                    type="number"
                    min={1}
                    value={tickSet.count ?? 12}
                    onChange={(e) => patchTickSet(tickSet.id, { count: Math.max(1, Math.round(Number(e.target.value))) })}
                  />
                </label>
                <label className="properties__field">
                  <span>Distance from center</span>
                  <input
                    type="number"
                    value={tickSet.distance ?? 49}
                    onChange={(e) => patchTickSet(tickSet.id, { distance: Number(e.target.value) })}
                  />
                </label>
                <label className="properties__field">
                  <span>Size</span>
                  <input
                    type="number"
                    min={0}
                    value={tickSet.size ?? 6}
                    onChange={(e) => patchTickSet(tickSet.id, { size: Math.max(0, Number(e.target.value)) })}
                  />
                </label>
                <label className="properties__field">
                  <span>Thickness</span>
                  <input
                    type="number"
                    min={0}
                    value={tickSet.thickness ?? 2}
                    onChange={(e) => patchTickSet(tickSet.id, { thickness: Math.max(0, Number(e.target.value)) })}
                  />
                </label>
              </div>

              <div className="properties__field">
                <span>Color</span>
                <ColorPickerButton
                  value={tickSet.color ?? '#ffffff'}
                  onChange={(color) => patchTickSet(tickSet.id, { color })}
                  opacity={tickSet.opacity ?? 1}
                  onOpacityChange={(v) => patchTickSet(tickSet.id, { opacity: v })}
                />
              </div>

              <div className="properties__grid2">
                <div className="properties__field">
                  <span>Border color</span>
                  <ColorPickerButton value={tickSet.borderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => patchTickSet(tickSet.id, { borderColor: color })} />
                </div>
                <label className="properties__field">
                  <span>Border width</span>
                  <input
                    type="number"
                    min={0}
                    value={tickSet.borderWidth ?? 0}
                    onChange={(e) => patchTickSet(tickSet.id, { borderWidth: Math.max(0, Number(e.target.value)) })}
                  />
                </label>
              </div>

              <button type="button" className="properties__file-remove" onClick={() => confirmRemoveTickSet(tickSet.id)}>
                Remove tick set
              </button>
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addTickSet}>
            + Add tick set
          </button>
        </PropertiesSection>

        <PropertiesSection title="Labels" badge={encoder.labels.length}>
          {encoder.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={encoder.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchEncoderLabel(label.id, fields)}
                onRemove={() => confirmRemoveEncoderLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addEncoderLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <PropertiesSection title="Actions" badge={6}>
          <EventSequenceEditor
            title="Press"
            steps={encoder.events.press}
            onChange={(steps) => patchEncoder({ events: { ...encoder.events, press: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Release"
            steps={encoder.events.release}
            onChange={(steps) => patchEncoder({ events: { ...encoder.events, release: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Double press"
            steps={encoder.events.doublePress ?? []}
            onChange={(steps) => patchEncoder({ events: { ...encoder.events, doublePress: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Triple press"
            steps={encoder.events.triplePress ?? []}
            onChange={(steps) => patchEncoder({ events: { ...encoder.events, triplePress: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Double/Triple press only engage the double/triple-tap window at all once either has any steps — with both empty, Press
            fires the instant the grip is touched, same as always.
          </p>
          <EventSequenceEditor
            title="Turn CW (increment)"
            steps={encoder.events.increment}
            onChange={(steps) => patchEncoder({ events: { ...encoder.events, increment: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Turn CCW (decrement)"
            steps={encoder.events.decrement}
            onChange={(steps) => patchEncoder({ events: { ...encoder.events, decrement: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Press/Release fire once each on a tap or the start/end of a drag — good for a push-encoder's button function. Turn CW/CCW
            fire once per step crossed while dragging in a circle, in either direction.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={encoder.x} onChange={(e) => patchEncoder({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={encoder.y} onChange={(e) => patchEncoder({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={encoder.w} onChange={(e) => patchEncoder({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={encoder.h} onChange={(e) => patchEncoder({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={encoder.zIndex ?? 0} onChange={(e) => patchEncoder({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={encoder.visible} visibleExpr={encoder.visibleExpr} onChange={patchEncoder} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteEncoder}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'switch-rocker') {
    const sw = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = sw.track.colorExpr !== undefined
    const isBorderExpr = sw.borderColorExpr !== undefined
    // Canvas click-through (CanvasWidget.tsx's onPositionSelect) takes
    // priority over the panel's own last-clicked tab whenever it names a
    // position that still exists on this widget — falls back to the local
    // activePositionIndex otherwise (selectedBlockId null/stale, or it's a
    // morph block id left over from some other widget's selection).
    const canvasPositionIndex = selectedBlockId ? sw.positions.findIndex((p) => p.id === selectedBlockId) : -1
    const effectiveActivePositionIndex = canvasPositionIndex >= 0 ? canvasPositionIndex : activePositionIndex

    function patchSwitch(fields: Partial<RockerSwitchWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === sw.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchSwitchLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchSwitch({ labels: sw.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addSwitchLabel(): void {
      patchSwitch({ labels: [...sw.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveSwitchLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchSwitch({ labels: sw.labels.filter((l) => l.id !== labelId) })
    }

    async function handleDeleteSwitch(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(sw.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sw.type]}</p>

        <PropertiesSection title="Setup">
          <label className="properties__field">
            <span>Orientation</span>
            <select value={sw.orientation ?? 'vertical'} onChange={(e) => patchSwitch({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </label>

          <label className="properties__checkbox">
            <input
              type="checkbox"
              checked={sw.settleToInactive ?? false}
              onChange={(e) => patchSwitch({ settleToInactive: e.target.checked })}
            />
            Settle to inactive
          </label>
          <p className="properties__hint">
            Off: defaults to the first position active, and stays on whichever was last tapped — like today. On: nothing&rsquo;s active by
            default, and a tap doesn&rsquo;t stick highlighted either — it always settles back to nothing active. Either way, tapping a
            position always fires its action.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Base color</span>
            <ColorPickerButton
              value={sw.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ track: { ...sw.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={sw.track.colorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ track: { ...sw.track, colorExpr: code } })}
              onEnterExpr={() => patchSwitch({ track: { ...sw.track, colorExpr: sw.track.colorExpr ?? '' } })}
              onClearExpr={() => patchSwitch({ track: { ...sw.track, colorExpr: undefined } })}
              opacity={sw.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ track: { ...sw.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={sw.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={sw.borderColorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ borderColorExpr: code })}
              onEnterExpr={() => patchSwitch({ borderColorExpr: sw.borderColorExpr ?? '' })}
              onClearExpr={() => patchSwitch({ borderColorExpr: undefined })}
              opacity={sw.borderOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Border shape">
          <span className="properties__section-label">Border radius</span>
          <CornersInputGrid
            topLeft={{ value: sw.radiusTopLeft ?? 6, min: 0, onChange: (v) => patchSwitch({ radiusTopLeft: v }) }}
            topRight={{ value: sw.radiusTopRight ?? 6, min: 0, onChange: (v) => patchSwitch({ radiusTopRight: v }) }}
            bottomLeft={{ value: sw.radiusBottomLeft ?? 6, min: 0, onChange: (v) => patchSwitch({ radiusBottomLeft: v }) }}
            bottomRight={{ value: sw.radiusBottomRight ?? 6, min: 0, onChange: (v) => patchSwitch({ radiusBottomRight: v }) }}
          />

          <div className="properties__divider" />

          <span className="properties__section-label">Border thickness</span>
          <SidesInputGrid
            top={{ value: sw.borderWidthTop ?? 1, min: 0, onChange: (v) => patchSwitch({ borderWidthTop: v }) }}
            right={{ value: sw.borderWidthRight ?? 1, min: 0, onChange: (v) => patchSwitch({ borderWidthRight: v }) }}
            bottom={{ value: sw.borderWidthBottom ?? 1, min: 0, onChange: (v) => patchSwitch({ borderWidthBottom: v }) }}
            left={{ value: sw.borderWidthLeft ?? 1, min: 0, onChange: (v) => patchSwitch({ borderWidthLeft: v }) }}
          />
        </PropertiesSection>

        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {sw.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={sw.rotateAngle ?? 0} onChange={(e) => patchSwitch({ rotateAngle: Number(e.target.value) })} />
              )}
              {sw.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patchSwitch({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patchSwitch({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {sw.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={sw.rotateAngleExpr ?? ''}
              onChange={(code) => patchSwitch({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            Spins the shape/segments and each position&rsquo;s own labels together. The widget&rsquo;s own Labels below (a legend/title)
            stay upright. Falls back to the fixed angle if the expression is unset or fails to evaluate.
          </p>
        </PropertiesSection>

        <SwitchPositionsEditor
          positions={sw.positions}
          activePositionExpr={sw.activePositionExpr}
          onPatchPositions={(positions) => patchSwitch({ positions })}
          onPatchActivePositionExpr={(activePositionExpr) => patchSwitch({ activePositionExpr })}
          activePositionIndex={effectiveActivePositionIndex}
          setActivePositionIndex={setActivePositionIndex}
          onActivePositionIdChange={selectBlock}
          dragPositionIndex={dragPositionIndex}
          activePositionExprExpanded={activePositionExprExpanded}
          setActivePositionExprExpanded={setActivePositionExprExpanded}
          confirm={confirm}
        />

        <PropertiesSection title="Labels" badge={sw.labels.length}>
          <p className="properties__hint">Anchored to the widget as a whole, independent of each position's own labels above.</p>
          {sw.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={sw.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchSwitchLabel(label.id, fields)}
                onRemove={() => confirmRemoveSwitchLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addSwitchLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <SwitchActionsSection
          positions={sw.positions}
          onPatchPositions={(positions) => patchSwitch({ positions })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          rootEvents={[
            { title: 'Press', steps: sw.events.press, onChange: (steps) => patchSwitch({ events: { ...sw.events, press: steps } }) },
            { title: 'Release', steps: sw.events.release, onChange: (steps) => patchSwitch({ events: { ...sw.events, release: steps } }) },
            {
              title: 'Position Change',
              steps: sw.events.positionChange,
              onChange: (steps) => patchSwitch({ events: { ...sw.events, positionChange: steps } }),
              hint: sw.settleToInactive
                ? "Runs on every selection (press), alongside that position's own action below — variables.$value is the position's name, variables.$index its position, so one shared sequence can still tell which fired it. With \"Settle to inactive\" on, it also runs once more on release, for the switch settling back to nothing active — variables.$value is 'Inactive', $index is -1 (see the Inactive action below)."
                : "Runs on every selection (press), alongside that position's own action below — variables.$value is the position's name, variables.$index its position, so one shared sequence can still tell which fired it.",
              variableHint: 'variables.$value'
            },
            ...(sw.settleToInactive
              ? [
                  {
                    title: 'Inactive',
                    steps: sw.onInactive,
                    onChange: (steps: SequenceStep[]) => patchSwitch({ onInactive: steps }),
                    hint: 'Runs once, on release, once the switch settles back to nothing active — not a real position, so there\'s nothing here to style or delete. variables.$value is the fixed string \'Inactive\', variables.$index is -1.',
                    variableHint: 'variables.$value'
                  }
                ]
              : [])
          ]}
        />

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={sw.x} onChange={(e) => patchSwitch({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={sw.y} onChange={(e) => patchSwitch({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={sw.w} onChange={(e) => patchSwitch({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={sw.h} onChange={(e) => patchSwitch({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={sw.zIndex ?? 0} onChange={(e) => patchSwitch({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={sw.visible} visibleExpr={sw.visibleExpr} onChange={patchSwitch} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteSwitch}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'switch-toggle') {
    const sw = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = sw.track.colorExpr !== undefined
    const isFillExpr = sw.fill.colorExpr !== undefined
    const isBorderExpr = sw.borderColorExpr !== undefined
    const isGuardExpr = sw.guard?.colorExpr !== undefined
    const isGuardBorderExpr = sw.guard?.borderColorExpr !== undefined
    const isGuardOpenExpr = sw.guardOpenExpr !== undefined
    const canvasPositionIndex = selectedBlockId ? sw.positions.findIndex((p) => p.id === selectedBlockId) : -1
    const effectiveActivePositionIndex = canvasPositionIndex >= 0 ? canvasPositionIndex : activePositionIndex

    function patchSwitch(fields: Partial<ToggleSwitchWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === sw.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchSwitchLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchSwitch({ labels: sw.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addSwitchLabel(): void {
      patchSwitch({ labels: [...sw.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveSwitchLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchSwitch({ labels: sw.labels.filter((l) => l.id !== labelId) })
    }

    async function handleDeleteSwitch(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(sw.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sw.type]}</p>

        <PropertiesSection title="Setup">
          <label className="properties__field">
            <span>Orientation</span>
            <select value={sw.orientation ?? 'vertical'} onChange={(e) => patchSwitch({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </label>

          <label className="properties__field">
            <span>Interaction</span>
            <select
              value={sw.interactionMode ?? 'tap'}
              onChange={(e) => patchSwitch({ interactionMode: e.target.value === 'tap' ? undefined : (e.target.value as ToggleSwitchWidget['interactionMode']) })}
            >
              <option value="tap">Tap a position</option>
              <option value="drag">Press and drag toward a position</option>
            </select>
          </label>
          <p className="properties__hint">
            {(sw.interactionMode ?? 'tap') === 'tap'
              ? 'Tap directly on a position (top/middle/bottom, or its label) to select it.'
              : "Press anywhere on the toggle and drag toward the position you want — you can drag past the widget's own edges. The lever snaps live to whichever position is nearest, so you can see what releasing will select."}
          </p>
          {sw.interactionMode === 'drag' && (
            <>
              <label className="properties__checkbox">
                <input type="checkbox" checked={sw.fireWhileDragging ?? true} onChange={(e) => patchSwitch({ fireWhileDragging: e.target.checked })} />
                Fire while dragging
              </label>
              <p className="properties__hint">
                {(sw.fireWhileDragging ?? true)
                  ? "Position Change (and that position's own actions) fires the instant the drag reaches it, not just when you let go — the default. Turn this off to fire it once, only on release."
                  : 'Position Change fires once, when you release, instead of live as the lever crosses into each position during the drag.'}
              </p>
            </>
          )}
        </PropertiesSection>

        <PropertiesSection title="Shape">
          <label className="properties__field">
            <span>Base shape</span>
            <select
              value={sw.bezelShape ?? 'circle'}
              onChange={(e) => patchSwitch({ bezelShape: e.target.value === 'circle' ? undefined : (e.target.value as ToggleSwitchWidget['bezelShape']) })}
            >
              <option value="circle">Circle</option>
              <option value="hexagon">Hexagon</option>
            </select>
          </label>

          <label className="properties__field">
            <span>Base circle size</span>
            <input
              type="number"
              min={1}
              value={sw.bezelRadius ?? 45}
              onChange={(e) => patchSwitch({ bezelRadius: Math.max(1, Number(e.target.value)) })}
            />
          </label>

          {(sw.bezelShape ?? 'circle') === 'hexagon' && (
            <label className="properties__field">
              <span>Base rotation</span>
              <input type="number" value={sw.bezelRotation ?? 0} onChange={(e) => patchSwitch({ bezelRotation: Number(e.target.value) })} />
            </label>
          )}
        </PropertiesSection>

        {(sw.positions.length === 2 || sw.positions.length === 3) && (
          <PropertiesSection title="Momentary">
            <p className="properties__hint">
              {sw.positions.length === 3
                ? "A momentary Top/Bottom position only stays selected while pressed (or dragged onto, in drag mode) — release it and it springs back to Middle, firing Middle's own action too."
                : "A momentary Top/Bottom position only stays selected while pressed (or dragged onto, in drag mode) — release it and it springs back to the other position, firing that position's own action too. Only one of the two can be momentary at a time — there's no Middle for both to spring back to here, so the other one has to be the resting position that catches it."}
            </p>
            {sw.positions.map((position, index) => {
              if (isMiddleTogglePosition(index, sw.positions.length)) return null
              return (
                <label key={position.id} className="properties__checkbox">
                  <input
                    type="checkbox"
                    checked={position.momentary ?? false}
                    onChange={(e) =>
                      patchSwitch({
                        positions: sw.positions.map((p, i) => {
                          if (i === index) return { ...p, momentary: e.target.checked }
                          // 2-position only — a 3-position switch's two ends
                          // both spring back to the same Middle, so they're
                          // independent; a 2-position switch has nowhere
                          // else for a second momentary end to spring back
                          // to, so checking one always clears the other.
                          if (sw.positions.length === 2 && e.target.checked) return { ...p, momentary: false }
                          return p
                        })
                      })
                    }
                  />
                  {position.name}
                </label>
              )
            })}
          </PropertiesSection>
        )}

        <PropertiesSection title="Inner circle">
          <label className="properties__field">
            <span>Inner circle size</span>
            <input
              type="number"
              min={0}
              value={sw.innerBezelRadius ?? 0}
              onChange={(e) => patchSwitch({ innerBezelRadius: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <p className="properties__hint">A second circle drawn on top of the base circle. 0 hides it entirely.</p>
          <div className="properties__field">
            <span>Inner circle color</span>
            <ColorPickerButton
              value={sw.innerBezelColor ?? sw.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ innerBezelColor: color })}
              auto={sw.innerBezelColor === undefined}
              onAuto={() => patchSwitch({ innerBezelColor: undefined })}
              opacity={sw.innerBezelOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ innerBezelOpacity: v })}
            />
          </div>
          <label className="properties__field">
            <span>Inner circle border width</span>
            <input
              type="number"
              min={0}
              value={sw.innerBezelBorderWidth ?? 0}
              onChange={(e) => patchSwitch({ innerBezelBorderWidth: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <div className="properties__field">
            <span>Inner circle border color</span>
            <ColorPickerButton
              value={sw.innerBezelBorderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ innerBezelBorderColor: color })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Lever">
          <label className="properties__field">
            <span>Lever shape</span>
            <select
              value={sw.leverShape ?? 'normal'}
              onChange={(e) => patchSwitch({ leverShape: e.target.value === 'normal' ? undefined : (e.target.value as ToggleSwitchWidget['leverShape']) })}
            >
              <option value="normal">Normal</option>
              <option value="bar">Bar</option>
            </select>
          </label>
          <p className="properties__hint">
            Bar adds a configurable rectangle capping the lever's own tip, and stands in for the middle-position circle entirely on a
            3-position switch.
          </p>
          <label className="properties__field">
            <span>Lever length</span>
            <input
              type="number"
              min={1}
              value={sw.leverLength ?? 36}
              onChange={(e) => patchSwitch({ leverLength: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__field">
            <span>Lever tip size</span>
            <input
              type="number"
              min={1}
              value={sw.leverTipRadius ?? 9}
              onChange={(e) => patchSwitch({ leverTipRadius: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <p className="properties__hint">
            Also sizes the shaded tip ellipse (see Circle top style below) and, unless Circle size is set separately, the
            middle-position circle on a 3-position switch — the same physical tip, just viewed from a different angle.
          </p>
          <label className="properties__field">
            <span>Circle top style</span>
            <select
              value={sw.circleTopStyle ?? 'rounded'}
              onChange={(e) => patchSwitch({ circleTopStyle: e.target.value === 'rounded' ? undefined : (e.target.value as ToggleSwitchWidget['circleTopStyle']) })}
            >
              <option value="flat">Flat</option>
              <option value="rounded">Rounded</option>
            </select>
          </label>
          <p className="properties__hint">
            Shading on the tip ellipse for top/bottom positions (both position counts) and, on a 3-position switch, the middle-position
            circle too — same physical tip, same shading either way.
          </p>
          <label className="properties__field">
            <span>Lever base size</span>
            <input
              type="number"
              min={1}
              value={sw.leverBaseRadius ?? 4}
              onChange={(e) => patchSwitch({ leverBaseRadius: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <p className="properties__hint">The narrow end, where the lever tapers down into the pivot.</p>
          <label className="properties__field">
            <span>Lever border width</span>
            <input
              type="number"
              min={0}
              value={sw.leverBorderWidth ?? 0}
              onChange={(e) => patchSwitch({ leverBorderWidth: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <div className="properties__field">
            <span>Lever border color</span>
            <ColorPickerButton
              value={sw.leverBorderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ leverBorderColor: color })}
            />
          </div>

          {sw.leverShape === 'bar' && (
            <>
              <div className="properties__divider" />

              <span className="properties__section-label">Bar</span>
              <div className="properties__grid2">
                <label className="properties__field">
                  <span>Width</span>
                  <input
                    type="number"
                    min={1}
                    value={sw.barWidth ?? 20}
                    onChange={(e) => patchSwitch({ barWidth: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label className="properties__field">
                  <span>Height</span>
                  <input
                    type="number"
                    min={1}
                    value={sw.barHeight ?? 10}
                    onChange={(e) => patchSwitch({ barHeight: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
              </div>
              <div className="properties__field">
                <span>Color</span>
                <ColorPickerButton
                  value={sw.barColor ?? sw.fill.color ?? DEFAULT_WIDGET_COLOR}
                  onChange={(color) => patchSwitch({ barColor: color })}
                  auto={sw.barColor === undefined}
                  onAuto={() => patchSwitch({ barColor: undefined })}
                  opacity={sw.barOpacity ?? sw.fill.backgroundOpacity ?? 1}
                  onOpacityChange={(v) => patchSwitch({ barOpacity: v })}
                />
              </div>
              <div className="properties__grid2">
                <label className="properties__field">
                  <span>Border width</span>
                  <input
                    type="number"
                    min={0}
                    value={sw.barBorderWidth ?? 0}
                    onChange={(e) => patchSwitch({ barBorderWidth: Math.max(0, Number(e.target.value)) })}
                  />
                </label>
                <label className="properties__field">
                  <span>Border radius</span>
                  <input
                    type="number"
                    min={0}
                    value={sw.barBorderRadius ?? 0}
                    onChange={(e) => patchSwitch({ barBorderRadius: Math.max(0, Number(e.target.value)) })}
                  />
                </label>
              </div>
              <div className="properties__field">
                <span>Border color</span>
                <ColorPickerButton value={sw.barBorderColor ?? DEFAULT_WIDGET_COLOR} onChange={(color) => patchSwitch({ barBorderColor: color })} />
              </div>
            </>
          )}
        </PropertiesSection>

        {sw.positions.length === 3 && (
          <PropertiesSection title="Circle (middle position)">
            <label className="properties__field">
              <span>Circle size</span>
              <input
                type="number"
                min={1}
                value={sw.circleRadius ?? sw.leverTipRadius ?? 9}
                onChange={(e) => patchSwitch({ circleRadius: Math.max(1, Number(e.target.value)) })}
              />
            </label>
            <p className="properties__hint">Defaults to the Lever tip size above (see Lever section) until set separately here.</p>
            <div className="properties__field">
              <span>Circle color</span>
              <ColorPickerButton
                value={sw.circleColor ?? sw.fill.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(color) => patchSwitch({ circleColor: color })}
                auto={sw.circleColor === undefined}
                onAuto={() => patchSwitch({ circleColor: undefined })}
                opacity={sw.circleOpacity ?? sw.fill.backgroundOpacity ?? 1}
                onOpacityChange={(v) => patchSwitch({ circleOpacity: v })}
              />
            </div>
            <label className="properties__field">
              <span>Circle border width</span>
              <input
                type="number"
                min={0}
                value={sw.circleBorderWidth ?? 0}
                onChange={(e) => patchSwitch({ circleBorderWidth: Math.max(0, Number(e.target.value)) })}
              />
            </label>
            <div className="properties__field">
              <span>Circle border color</span>
              <ColorPickerButton
                value={sw.circleBorderColor ?? DEFAULT_WIDGET_COLOR}
                onChange={(color) => patchSwitch({ circleBorderColor: color })}
              />
            </div>
          </PropertiesSection>
        )}

        <PropertiesSection title="Safety guard">
          <label className="properties__checkbox">
            <input type="checkbox" checked={sw.guardEnabled ?? false} onChange={(e) => patchSwitch({ guardEnabled: e.target.checked })} />
            Enabled
          </label>
          <p className="properties__hint">
            A flip-up cover over the whole switch — closed by default, blocking every tap until you tap it open, which reveals (and
            re-enables taps on) the switch underneath.
          </p>

          {sw.guardEnabled && (
            <>
              <div className="properties__field">
                <span>Cover color</span>
                <ColorPickerButton
                  value={sw.guard?.color ?? '#c0392b'}
                  onChange={(color) => patchSwitch({ guard: { ...sw.guard, color, colorExpr: undefined } })}
                  isExpr={isGuardExpr}
                  exprValue={sw.guard?.colorExpr ?? ''}
                  onExprChange={(code) => patchSwitch({ guard: { ...sw.guard, colorExpr: code } })}
                  onEnterExpr={() => patchSwitch({ guard: { ...sw.guard, colorExpr: sw.guard?.colorExpr ?? '' } })}
                  onClearExpr={() => patchSwitch({ guard: { ...sw.guard, colorExpr: undefined } })}
                  opacity={sw.guard?.backgroundOpacity ?? 1}
                  onOpacityChange={(v) => patchSwitch({ guard: { ...sw.guard, backgroundOpacity: v } })}
                />
              </div>

              <div className="properties__field">
                <span>Border color</span>
                <ColorPickerButton
                  value={sw.guard?.borderColor ?? DEFAULT_WIDGET_COLOR}
                  onChange={(color) => patchSwitch({ guard: { ...sw.guard, borderColor: color, borderColorExpr: undefined } })}
                  isExpr={isGuardBorderExpr}
                  exprValue={sw.guard?.borderColorExpr ?? ''}
                  onExprChange={(code) => patchSwitch({ guard: { ...sw.guard, borderColorExpr: code } })}
                  onEnterExpr={() => patchSwitch({ guard: { ...sw.guard, borderColorExpr: sw.guard?.borderColorExpr ?? '' } })}
                  onClearExpr={() => patchSwitch({ guard: { ...sw.guard, borderColorExpr: undefined } })}
                  opacity={sw.guard?.borderOpacity ?? 1}
                  onOpacityChange={(v) => patchSwitch({ guard: { ...sw.guard, borderOpacity: v } })}
                />
              </div>

              <label className="properties__field">
                <span>Border width</span>
                <input
                  type="number"
                  min={0}
                  value={sw.guardBorderWidth ?? 1}
                  onChange={(e) => patchSwitch({ guardBorderWidth: Math.max(0, Number(e.target.value)) })}
                />
              </label>

              <label className="properties__field">
                <span>Corner radius</span>
                <input
                  type="number"
                  min={0}
                  value={sw.guardRadius ?? 6}
                  onChange={(e) => patchSwitch({ guardRadius: Math.max(0, Number(e.target.value)) })}
                />
              </label>

              <div className="properties__divider" />

              <span className="properties__section-label">Size</span>
              <p className="properties__hint">Independent of the switch's own size — centered over it. Leave blank to match it exactly.</p>
              <div className="properties__grid2">
                <label className="properties__field">
                  <span>W</span>
                  <input
                    type="number"
                    min={1}
                    placeholder={String(sw.w)}
                    value={sw.guardWidth ?? ''}
                    onChange={(e) => patchSwitch({ guardWidth: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label className="properties__field">
                  <span>H</span>
                  <input
                    type="number"
                    min={1}
                    placeholder={String(sw.h)}
                    value={sw.guardHeight ?? ''}
                    onChange={(e) => patchSwitch({ guardHeight: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
                  />
                </label>
              </div>
              <label className="properties__field">
                <span>Position from top</span>
                <input
                  type="number"
                  placeholder={String((sw.h - (sw.guardHeight ?? sw.h)) / 2)}
                  value={sw.guardTop ?? ''}
                  onChange={(e) => patchSwitch({ guardTop: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
              <p className="properties__hint">Can go negative, to extend past the switch's own top edge. Blank keeps it centered.</p>

              <div className="properties__divider" />

              <span className="properties__section-label">Open tab</span>
              <p className="properties__hint">
                The small hinge edge left grabbable once flipped open — same cover color/border/radius/width above, just its own
                height and position.
              </p>
              <div className="properties__grid2">
                <label className="properties__field">
                  <span>Height</span>
                  <input
                    type="number"
                    min={1}
                    value={sw.guardOpenHeight ?? 14}
                    onChange={(e) => patchSwitch({ guardOpenHeight: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label className="properties__field">
                  <span>Position from top</span>
                  <input
                    type="number"
                    value={sw.guardOpenTop ?? 0}
                    onChange={(e) => patchSwitch({ guardOpenTop: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div className="properties__divider" />

              <label className="properties__field">
                <span>Open when</span>
                <div className="properties__file-row">
                  {isGuardOpenExpr ? (
                    <span className="properties__hint-inline">Using expression below</span>
                  ) : (
                    <span className="properties__hint-inline">Local tap (starts closed)</span>
                  )}
                  {isGuardOpenExpr ? (
                    <button
                      type="button"
                      className="color-picker-button__clear"
                      title="Go back to local tap control"
                      onClick={() => patchSwitch({ guardOpenExpr: undefined })}
                    >
                      ×
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="color-picker-button__fx"
                      title="Drive open/closed from an expression"
                      onClick={() => patchSwitch({ guardOpenExpr: '' })}
                    >
                      ƒx
                    </button>
                  )}
                </div>
              </label>
              {isGuardOpenExpr && (
                <ExpressionField
                  label="Expression"
                  value={sw.guardOpenExpr ?? ''}
                  onChange={(code) => patchSwitch({ guardOpenExpr: code })}
                  placeholder={GUARD_OPEN_EXPR_PLACEHOLDER}
                />
              )}
            </>
          )}
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Base color</span>
            <ColorPickerButton
              value={sw.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ track: { ...sw.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={sw.track.colorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ track: { ...sw.track, colorExpr: code } })}
              onEnterExpr={() => patchSwitch({ track: { ...sw.track, colorExpr: sw.track.colorExpr ?? '' } })}
              onClearExpr={() => patchSwitch({ track: { ...sw.track, colorExpr: undefined } })}
              opacity={sw.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ track: { ...sw.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Lever color</span>
            <ColorPickerButton
              value={sw.fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ fill: { ...sw.fill, color, colorExpr: undefined } })}
              isExpr={isFillExpr}
              exprValue={sw.fill.colorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ fill: { ...sw.fill, colorExpr: code } })}
              onEnterExpr={() => patchSwitch({ fill: { ...sw.fill, colorExpr: sw.fill.colorExpr ?? '' } })}
              onClearExpr={() => patchSwitch({ fill: { ...sw.fill, colorExpr: undefined } })}
              opacity={sw.fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ fill: { ...sw.fill, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={sw.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={sw.borderColorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ borderColorExpr: code })}
              onEnterExpr={() => patchSwitch({ borderColorExpr: sw.borderColorExpr ?? '' })}
              onClearExpr={() => patchSwitch({ borderColorExpr: undefined })}
              opacity={sw.borderOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ borderOpacity: v })}
            />
          </div>

          <label className="properties__field">
            <span>Border width</span>
            <input
              type="number"
              min={0}
              value={sw.borderWidth ?? 2}
              onChange={(e) => patchSwitch({ borderWidth: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </PropertiesSection>

        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {sw.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={sw.rotateAngle ?? 0} onChange={(e) => patchSwitch({ rotateAngle: Number(e.target.value) })} />
              )}
              {sw.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patchSwitch({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patchSwitch({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {sw.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={sw.rotateAngleExpr ?? ''}
              onChange={(code) => patchSwitch({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            Spins the whole switch — bezel/lever/guard, each position&rsquo;s own labels, AND the widget&rsquo;s own Labels below —
            together. Falls back to the fixed angle if the expression is unset or fails to evaluate. Drag mode's own movement math
            accounts for this automatically, so the lever still tracks the pointer directly regardless of rotation.
          </p>
        </PropertiesSection>

        <SwitchPositionsEditor
          positions={sw.positions}
          activePositionExpr={sw.activePositionExpr}
          onPatchPositions={(positions) =>
            patchSwitch({ positions: positions.map((p, i) => ({ ...p, name: toggleNameForIndex(i, positions.length) })) })
          }
          onPatchActivePositionExpr={(activePositionExpr) => patchSwitch({ activePositionExpr })}
          activePositionIndex={effectiveActivePositionIndex}
          setActivePositionIndex={setActivePositionIndex}
          onActivePositionIdChange={selectBlock}
          dragPositionIndex={dragPositionIndex}
          activePositionExprExpanded={activePositionExprExpanded}
          setActivePositionExprExpanded={setActivePositionExprExpanded}
          confirm={confirm}
          showLabelAnchor
          showPositionName={false}
          maxPositions={3}
        />

        <PropertiesSection title="Labels" badge={sw.labels.length}>
          <p className="properties__hint">Anchored to the widget as a whole, independent of each position's own labels above.</p>
          {sw.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={sw.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchSwitchLabel(label.id, fields)}
                onRemove={() => confirmRemoveSwitchLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addSwitchLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <SwitchActionsSection
          positions={sw.positions}
          onPatchPositions={(positions) =>
            patchSwitch({ positions: positions.map((p, i) => ({ ...p, name: toggleNameForIndex(i, positions.length) })) })
          }
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          rootEvents={[
            { title: 'Press', steps: sw.events.press, onChange: (steps) => patchSwitch({ events: { ...sw.events, press: steps } }) },
            { title: 'Release', steps: sw.events.release, onChange: (steps) => patchSwitch({ events: { ...sw.events, release: steps } }) },
            {
              title: 'Position Change',
              steps: sw.events.positionChange,
              onChange: (steps) => patchSwitch({ events: { ...sw.events, positionChange: steps } }),
              hint: "Runs on every selection, alongside that position's own action below — variables.$value is the position's name, variables.$index its position, so one shared sequence can still tell which fired it.",
              variableHint: 'variables.$value'
            },
            ...(sw.guardEnabled
              ? [
                  {
                    title: 'Guard Press',
                    steps: sw.events.guardToggle,
                    onChange: (steps: SequenceStep[]) => patchSwitch({ events: { ...sw.events, guardToggle: steps } }),
                    hint: 'Fires whenever the cover is tapped, whether that flips it open or closed — variables.$value is 1 when opening, 0 when closing. The only way to send a real command off pressing the guard itself, since Open when above only ever reads a variable back.',
                    variableHint: 'variables.$value'
                  }
                ]
              : [])
          ]}
        />

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={sw.x} onChange={(e) => patchSwitch({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={sw.y} onChange={(e) => patchSwitch({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={sw.w} onChange={(e) => patchSwitch({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={sw.h} onChange={(e) => patchSwitch({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={sw.zIndex ?? 0} onChange={(e) => patchSwitch({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={sw.visible} visibleExpr={sw.visibleExpr} onChange={patchSwitch} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteSwitch}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'switch-dial') {
    const sw = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = sw.track.colorExpr !== undefined
    const isBorderExpr = sw.borderColorExpr !== undefined

    function patchSwitch(fields: Partial<DialSwitchWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === sw.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    function patchSwitchLabel(labelId: string, fields: Partial<WidgetLabel>): void {
      patchSwitch({ labels: sw.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
    }

    function addSwitchLabel(): void {
      patchSwitch({ labels: [...sw.labels, { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }] })
    }

    async function confirmRemoveSwitchLabel(labelId: string): Promise<void> {
      const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
      if (ok) patchSwitch({ labels: sw.labels.filter((l) => l.id !== labelId) })
    }

    async function handleDeleteSwitch(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(sw.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sw.type]}</p>

        <PropertiesSection title="Setup">
          <div className="properties__grid2">
            <label className="properties__field">
              <span>Start angle</span>
              <input type="number" value={sw.startAngle ?? 240} onChange={(e) => patchSwitch({ startAngle: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>End angle</span>
              <input type="number" value={sw.endAngle ?? 120} onChange={(e) => patchSwitch({ endAngle: Number(e.target.value) })} />
            </label>
          </div>

          <label className="properties__field">
            <span>Interaction</span>
            <select
              value={sw.interactionMode ?? 'tap'}
              onChange={(e) => patchSwitch({ interactionMode: e.target.value === 'tap' ? undefined : (e.target.value as DialSwitchWidget['interactionMode']) })}
            >
              <option value="tap">Tap a detent</option>
              <option value="drag">Press and drag toward a position</option>
            </select>
          </label>
          <p className="properties__hint">
            {(sw.interactionMode ?? 'tap') === 'tap'
              ? 'Tap directly on a detent (or its label) to select it.'
              : "Press anywhere on the dial and drag in the direction you want — you can drag past the widget's own edges. The needle snaps live to whichever position is nearest, so you can see what releasing will select."}
          </p>
          {sw.interactionMode === 'drag' && (
            <>
              <label className="properties__checkbox">
                <input type="checkbox" checked={sw.fireWhileDragging ?? true} onChange={(e) => patchSwitch({ fireWhileDragging: e.target.checked })} />
                Fire while dragging
              </label>
              <p className="properties__hint">
                {(sw.fireWhileDragging ?? true)
                  ? "Position Change (and that position's own actions, and Turn CW/CCW) fires the instant the drag reaches it, not just when you let go — the default. Turn this off to fire it once, only on release."
                  : 'Position Change fires once, when you release, instead of live as the needle crosses into each position during the drag.'}
              </p>
              <label className="properties__checkbox">
                <input
                  type="checkbox"
                  checked={sw.waitForStateConfirm ?? false}
                  onChange={(e) => patchSwitch({ waitForStateConfirm: e.target.checked })}
                />
                Wait for state to confirm
              </label>
              <p className="properties__hint">
                {sw.activePositionExpr === undefined
                  ? 'Needs an Active position expression (below) to have anything to wait on — with none set, this has no effect.'
                  : (sw.waitForStateConfirm ?? false)
                    ? "The needle no longer previews or snaps to a position during the drag — it only moves once Active position's own live value actually changes, i.e. once whatever external system owns the real position confirms it. Position Change/Turn CW/CCW above still fire live exactly as configured; only the needle's own visible position waits."
                    : "The needle previews live during the drag and holds the picked position until Active position's own value confirms it (or briefly reverts if it doesn't). Turn this on to have the needle wait for that confirmation instead of predicting it."}
              </p>
            </>
          )}
        </PropertiesSection>

        <PropertiesSection title="Detents">
          <DetentShapeEditor
            shape={sw.detentShape ?? 'circle'}
            onShapeChange={(shape) => patchSwitch({ detentShape: shape === 'circle' ? undefined : shape })}
            style={sw.detentStyle}
            onStyleChange={(detentStyle) => patchSwitch({ detentStyle })}
            allowNone
          />
          <label className="properties__field">
            <span>Detent distance</span>
            <input
              type="number"
              min={0}
              value={sw.detentRadius ?? 40}
              onChange={(e) => patchSwitch({ detentRadius: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </PropertiesSection>

        <DialShapeFields
          value={sw}
          onChange={patchSwitch}
          fill={sw.fill}
          onFillChange={(fill) => patchSwitch({ fill })}
          track={sw.track}
          needleColorLabel="Needle color"
        />

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Dial face color</span>
            <ColorPickerButton
              value={sw.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ track: { ...sw.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={sw.track.colorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ track: { ...sw.track, colorExpr: code } })}
              onEnterExpr={() => patchSwitch({ track: { ...sw.track, colorExpr: sw.track.colorExpr ?? '' } })}
              onClearExpr={() => patchSwitch({ track: { ...sw.track, colorExpr: undefined } })}
              opacity={sw.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ track: { ...sw.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={sw.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchSwitch({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={sw.borderColorExpr ?? ''}
              onExprChange={(code) => patchSwitch({ borderColorExpr: code })}
              onEnterExpr={() => patchSwitch({ borderColorExpr: sw.borderColorExpr ?? '' })}
              onClearExpr={() => patchSwitch({ borderColorExpr: undefined })}
              opacity={sw.borderOpacity ?? 1}
              onOpacityChange={(v) => patchSwitch({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {sw.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={sw.rotateAngle ?? 0} onChange={(e) => patchSwitch({ rotateAngle: Number(e.target.value) })} />
              )}
              {sw.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patchSwitch({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patchSwitch({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {sw.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={sw.rotateAngleExpr ?? ''}
              onChange={(code) => patchSwitch({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            Spins the whole dial — face/needle, every detent and its own label, AND the widget&rsquo;s own Labels below — together.
            Falls back to the fixed angle if the expression is unset or fails to evaluate. Drag mode's own movement math accounts for
            this automatically, so the needle still tracks the pointer directly regardless of rotation.
          </p>
        </PropertiesSection>

        <SwitchPositionsEditor
          positions={sw.positions}
          activePositionExpr={sw.activePositionExpr}
          onPatchPositions={(positions) => patchSwitch({ positions })}
          onPatchActivePositionExpr={(activePositionExpr) => patchSwitch({ activePositionExpr })}
          activePositionIndex={activePositionIndex}
          setActivePositionIndex={setActivePositionIndex}
          dragPositionIndex={dragPositionIndex}
          activePositionExprExpanded={activePositionExprExpanded}
          setActivePositionExprExpanded={setActivePositionExprExpanded}
          confirm={confirm}
          showLabelAnchor
        />

        <PropertiesSection title="Labels" badge={sw.labels.length}>
          <p className="properties__hint">Anchored to the widget as a whole, independent of each position's own labels above.</p>
          {sw.labels.map((label) => (
            <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
              <LabelFields
                label={label}
                backgroundColor={sw.track.color ?? DEFAULT_WIDGET_COLOR}
                onChange={(fields) => patchSwitchLabel(label.id, fields)}
                onRemove={() => confirmRemoveSwitchLabel(label.id)}
              />
            </PropertiesSection>
          ))}
          <button type="button" className="properties__file-button" onClick={addSwitchLabel}>
            + Add label
          </button>
        </PropertiesSection>

        <SwitchActionsSection
          positions={sw.positions}
          onPatchPositions={(positions) => patchSwitch({ positions })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          rootEvents={[
            { title: 'Press', steps: sw.events.press, onChange: (steps) => patchSwitch({ events: { ...sw.events, press: steps } }) },
            { title: 'Release', steps: sw.events.release, onChange: (steps) => patchSwitch({ events: { ...sw.events, release: steps } }) },
            {
              title: 'Position Change',
              steps: sw.events.positionChange,
              onChange: (steps) => patchSwitch({ events: { ...sw.events, positionChange: steps } }),
              hint: "Runs on every selection, alongside that position's own action below — variables.$value is the position's name, variables.$index its position, so one shared sequence can still tell which fired it.",
              variableHint: 'variables.$value'
            },
            {
              title: 'Turn CW (increment)',
              steps: sw.events.increment,
              onChange: (steps) => patchSwitch({ events: { ...sw.events, increment: steps } }),
              hint: 'Fires when turning the dial lands on a higher position index than whichever was active before — variables.$value/$index are the landed-on position’s name/index, same as Position Change.',
              variableHint: 'variables.$value'
            },
            {
              title: 'Turn CCW (decrement)',
              steps: sw.events.decrement,
              onChange: (steps) => patchSwitch({ events: { ...sw.events, decrement: steps } }),
              hint: 'Fires when turning the dial lands on a lower position index than whichever was active before — variables.$value/$index are the landed-on position’s name/index, same as Position Change.',
              variableHint: 'variables.$value'
            },
            {
              title: 'Double press',
              steps: sw.events.doublePress ?? [],
              onChange: (steps) => patchSwitch({ events: { ...sw.events, doublePress: steps } }),
              hint: 'Only engages the double/triple-tap window at all once this or Triple press has any steps — with both empty, Press fires the instant it’s pressed, same as always.'
            },
            {
              title: 'Triple press',
              steps: sw.events.triplePress ?? [],
              onChange: (steps) => patchSwitch({ events: { ...sw.events, triplePress: steps } })
            }
          ]}
        />

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={sw.x} onChange={(e) => patchSwitch({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={sw.y} onChange={(e) => patchSwitch({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={sw.w} onChange={(e) => patchSwitch({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={sw.h} onChange={(e) => patchSwitch({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={sw.zIndex ?? 0} onChange={(e) => patchSwitch({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={sw.visible} visibleExpr={sw.visibleExpr} onChange={patchSwitch} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteSwitch}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'dropdown') {
    const dd = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = dd.track.colorExpr !== undefined
    const isBorderExpr = dd.borderColorExpr !== undefined

    function patchDropdown(fields: Partial<DropdownWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === dd.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    async function handleDeleteDropdown(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(dd.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[dd.type]}</p>

        <PropertiesSection title="Setup">
          <label className="properties__field">
            <span>Expand mode</span>
            <select
              value={dd.expandMode ?? 'anchored'}
              onChange={(e) => patchDropdown({ expandMode: e.target.value as 'anchored' | 'unanchored' })}
            >
              <option value="anchored">Anchored (active position stays put, others fan out)</option>
              <option value="unanchored">Unanchored (list always starts at the widget)</option>
            </select>
          </label>

          <label className="properties__field">
            <span>Orientation</span>
            <select
              value={dd.orientation ?? 'top-to-bottom'}
              onChange={(e) =>
                patchDropdown({ orientation: e.target.value as 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left' })
              }
            >
              <option value="top-to-bottom">Top to bottom (stacks below)</option>
              <option value="bottom-to-top">Bottom to top (stacks above)</option>
              <option value="left-to-right">Left to right (stacks to the right)</option>
              <option value="right-to-left">Right to left (stacks to the left)</option>
            </select>
          </label>
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Base color</span>
            <ColorPickerButton
              value={dd.track.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchDropdown({ track: { ...dd.track, color, colorExpr: undefined } })}
              isExpr={isTrackExpr}
              exprValue={dd.track.colorExpr ?? ''}
              onExprChange={(code) => patchDropdown({ track: { ...dd.track, colorExpr: code } })}
              onEnterExpr={() => patchDropdown({ track: { ...dd.track, colorExpr: dd.track.colorExpr ?? '' } })}
              onClearExpr={() => patchDropdown({ track: { ...dd.track, colorExpr: undefined } })}
              opacity={dd.track.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchDropdown({ track: { ...dd.track, backgroundOpacity: v } })}
            />
          </div>

          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={dd.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchDropdown({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={dd.borderColorExpr ?? ''}
              onExprChange={(code) => patchDropdown({ borderColorExpr: code })}
              onEnterExpr={() => patchDropdown({ borderColorExpr: dd.borderColorExpr ?? '' })}
              onClearExpr={() => patchDropdown({ borderColorExpr: undefined })}
              opacity={dd.borderOpacity ?? 1}
              onOpacityChange={(v) => patchDropdown({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Border shape">
          <span className="properties__section-label">Border radius</span>
          <CornersInputGrid
            topLeft={{ value: dd.radiusTopLeft ?? 6, min: 0, onChange: (v) => patchDropdown({ radiusTopLeft: v }) }}
            topRight={{ value: dd.radiusTopRight ?? 6, min: 0, onChange: (v) => patchDropdown({ radiusTopRight: v }) }}
            bottomLeft={{ value: dd.radiusBottomLeft ?? 6, min: 0, onChange: (v) => patchDropdown({ radiusBottomLeft: v }) }}
            bottomRight={{ value: dd.radiusBottomRight ?? 6, min: 0, onChange: (v) => patchDropdown({ radiusBottomRight: v }) }}
          />

          <div className="properties__divider" />

          <span className="properties__section-label">Border thickness</span>
          <SidesInputGrid
            top={{ value: dd.borderWidthTop ?? 1, min: 0, onChange: (v) => patchDropdown({ borderWidthTop: v }) }}
            right={{ value: dd.borderWidthRight ?? 1, min: 0, onChange: (v) => patchDropdown({ borderWidthRight: v }) }}
            bottom={{ value: dd.borderWidthBottom ?? 1, min: 0, onChange: (v) => patchDropdown({ borderWidthBottom: v }) }}
            left={{ value: dd.borderWidthLeft ?? 1, min: 0, onChange: (v) => patchDropdown({ borderWidthLeft: v }) }}
          />
        </PropertiesSection>

        <SwitchPositionsEditor
          positions={dd.positions}
          activePositionExpr={dd.activePositionExpr}
          onPatchPositions={(positions) => patchDropdown({ positions })}
          onPatchActivePositionExpr={(activePositionExpr) => patchDropdown({ activePositionExpr })}
          activePositionIndex={activePositionIndex}
          setActivePositionIndex={setActivePositionIndex}
          dragPositionIndex={dragPositionIndex}
          activePositionExprExpanded={activePositionExprExpanded}
          setActivePositionExprExpanded={setActivePositionExprExpanded}
          confirm={confirm}
        />

        <SwitchActionsSection
          positions={dd.positions}
          onPatchPositions={(positions) => patchDropdown({ positions })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          rootEvents={[
            {
              title: 'Press',
              steps: dd.events.press,
              onChange: (steps) => patchDropdown({ events: { ...dd.events, press: steps } })
            },
            {
              title: 'Release',
              steps: dd.events.release,
              onChange: (steps) => patchDropdown({ events: { ...dd.events, release: steps } }),
              hint:
                'Press/Release fire on every hold, wherever it ends — dragging off the end still fires Release, just not the ' +
                'position below it would otherwise land on.'
            },
            {
              title: 'Position Change',
              steps: dd.events.positionChange,
              onChange: (steps) => patchDropdown({ events: { ...dd.events, positionChange: steps } }),
              hint: "Runs on every selection, alongside that position's own action below — variables.$value is the position's name, variables.$index its position, so one shared sequence can still tell which fired it.",
              variableHint: 'variables.$value'
            }
          ]}
        />

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={dd.x} onChange={(e) => patchDropdown({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={dd.y} onChange={(e) => patchDropdown({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={dd.w} onChange={(e) => patchDropdown({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={dd.h} onChange={(e) => patchDropdown({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={dd.zIndex ?? 0} onChange={(e) => patchDropdown({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={dd.visible} visibleExpr={dd.visibleExpr} onChange={patchDropdown} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteDropdown}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'screen-capture') {
    const sc = widget
    const minSize = snapToGrid ? gridSize : 1
    const isBorderExpr = sc.borderColorExpr !== undefined
    // "Pick region" targets whichever monitor the dropdown currently shows
    // — the local override if the user's touched it this session, else the
    // widget's last-picked display, else just the first one available.
    const effectiveDisplayId = pickerDisplayId ?? sc.displayId ?? screenCaptureDisplays?.[0]?.id
    const regionSummary = sc.region
      ? `${Math.round(sc.region.width)}×${Math.round(sc.region.height)} at (${Math.round(sc.region.x)}, ${Math.round(sc.region.y)})`
      : 'No region selected'

    function patchScreenCapture(fields: Partial<ScreenCaptureWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === sc.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    async function handleDeleteScreenCapture(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(sc.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sc.type]}</p>

        <PropertiesSection title="Source">
          <label className="properties__field">
            <span>Monitor</span>
            <select value={effectiveDisplayId ?? ''} onChange={(e) => setPickerDisplayId(Number(e.target.value))}>
              {(screenCaptureDisplays ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <p className="properties__hint">{regionSummary}</p>
          <button
            type="button"
            className="properties__file-button"
            disabled={effectiveDisplayId === undefined}
            onClick={() => effectiveDisplayId !== undefined && pickScreenCaptureRegion(sc.id, effectiveDisplayId)}
          >
            Pick region…
          </button>
        </PropertiesSection>

        <PropertiesSection title="Stream">
          <label className="properties__field">
            <span>Mode</span>
            <select value={sc.streamMode ?? 'poll'} onChange={(e) => patchScreenCapture({ streamMode: e.target.value as ScreenCaptureWidget['streamMode'] })}>
              <option value="poll">Poll (simple, one request per frame)</option>
              <option value="mjpeg">Live (persistent stream)</option>
            </select>
          </label>
          <label className="properties__field">
            <span>FPS</span>
            <input
              type="number"
              min={1}
              max={60}
              value={sc.fps ?? 5}
              // Clamping on every keystroke (rather than on blur) fights
              // typing a value below the current one's first digit — e.g.
              // typing "50" over quality's min of 10 momentarily reads "5",
              // which used to clamp straight to 10 before the second digit
              // could land. Let onChange pass the raw number through
              // unclamped (guarding only against a still-empty/NaN field)
              // and clamp once the field is committed on blur instead.
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isNaN(n)) patchScreenCapture({ fps: n })
              }}
              onBlur={(e) => patchScreenCapture({ fps: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
          <label className="properties__field">
            <span>Quality</span>
            <input
              type="number"
              min={10}
              max={100}
              value={sc.quality ?? 70}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isNaN(n)) patchScreenCapture({ quality: n })
              }}
              onBlur={(e) => patchScreenCapture({ quality: Math.min(100, Math.max(10, Number(e.target.value) || 10)) })}
            />
          </label>
        </PropertiesSection>

        <PropertiesSection title="Fit">
          <label className="properties__field">
            <span>Fit</span>
            <select value={sc.fit ?? 'cover'} onChange={(e) => patchScreenCapture({ fit: e.target.value as BackgroundFit })}>
              {BACKGROUND_FITS.filter((f) => f.value !== 'tile').map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </PropertiesSection>

        <PropertiesSection title="Adjustments">
          <label className="properties__field">
            <span>Brightness</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={sc.brightness ?? 1}
              onChange={(e) => patchScreenCapture({ brightness: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__field">
            <span>Contrast</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={sc.contrast ?? 1}
              onChange={(e) => patchScreenCapture({ contrast: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__field">
            <span>Saturation</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={sc.saturation ?? 1}
              onChange={(e) => patchScreenCapture({ saturation: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__checkbox">
            <input type="checkbox" checked={sc.sharpen ?? false} onChange={(e) => patchScreenCapture({ sharpen: e.target.checked })} />
            Sharpen
          </label>
          <p className="properties__hint">Costs real CPU on the desktop per captured frame — off by default.</p>
        </PropertiesSection>

        <PropertiesSection title="Border">
          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={sc.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchScreenCapture({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={sc.borderColorExpr ?? ''}
              onExprChange={(code) => patchScreenCapture({ borderColorExpr: code })}
              onEnterExpr={() => patchScreenCapture({ borderColorExpr: sc.borderColorExpr ?? '' })}
              onClearExpr={() => patchScreenCapture({ borderColorExpr: undefined })}
              opacity={sc.borderOpacity ?? 1}
              onOpacityChange={(v) => patchScreenCapture({ borderOpacity: v })}
            />
          </div>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={sc.x} onChange={(e) => patchScreenCapture({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={sc.y} onChange={(e) => patchScreenCapture({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={sc.w} onChange={(e) => patchScreenCapture({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={sc.h} onChange={(e) => patchScreenCapture({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={sc.zIndex ?? 0} onChange={(e) => patchScreenCapture({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={sc.visible} visibleExpr={sc.visibleExpr} onChange={patchScreenCapture} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteScreenCapture}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  if (widget.type === 'dcs-viewport') {
    const dv = widget
    const minSize = snapToGrid ? gridSize : 1
    const isBorderExpr = dv.borderColorExpr !== undefined
    const [selectedAircraft, selectedComponent] = dv.componentKey?.split(':') ?? [Object.keys(DCS_AIRCRAFT_CATALOG)[0], undefined]
    const aircraftProfile = DCS_AIRCRAFT_CATALOG[selectedAircraft]

    function patchDcsViewport(fields: Partial<DcsViewportWidget>): void {
      updateWidgets(widgets.map((w) => (w.id === dv.id ? ({ ...w, ...fields } as Widget) : w)))
    }

    async function handleDeleteDcsViewport(): Promise<void> {
      const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
      if (ok) {
        removeWidget(dv.id)
        selectWidget(null)
      }
    }

    return (
      <aside className="properties" style={{ width: propertiesWidth }}>
        {resizeHandle}
        <div className="properties__scroll">
        <div className="properties__header">
          <h2 className="properties__title">Properties</h2>
          <div className="properties__header-actions">
            <button type="button" className="properties__header-button" onClick={expandAllSections}>
              Expand all
            </button>
            <button type="button" className="properties__header-button" onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        </div>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[dv.type]}</p>

        <PropertiesSection title="Source">
          <label className="properties__field">
            <span>Aircraft</span>
            <select
              value={selectedAircraft}
              onChange={(e) => {
                const firstComponent = DCS_AIRCRAFT_CATALOG[e.target.value]?.components[0]?.id
                patchDcsViewport({ componentKey: firstComponent ? `${e.target.value}:${firstComponent}` : undefined })
              }}
            >
              {Object.entries(DCS_AIRCRAFT_CATALOG).map(([id, aircraft]) => (
                <option key={id} value={id}>
                  {aircraft.label}
                </option>
              ))}
            </select>
          </label>
          <label className="properties__field">
            <span>Component</span>
            <select
              value={selectedComponent ?? ''}
              onChange={(e) => patchDcsViewport({ componentKey: `${selectedAircraft}:${e.target.value}` })}
            >
              <option value="" disabled>
                Select a component…
              </option>
              {(aircraftProfile?.components ?? []).map((component) => (
                <option key={component.id} value={component.id}>
                  {component.label}
                </option>
              ))}
            </select>
          </label>

          <div className="properties__divider" />

          <span className="properties__section-label">Crop</span>
          <span className="properties__hint-inline">
            Percent to trim off each edge before Fit — use this to crop out DCS's own cockpit-instrument bezel if the
            default automatic inset isn't quite right for this component. Negative values expand back out past that
            default inset instead.
          </span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>Top</span>
              <input
                type="number"
                min={-50}
                max={49}
                step={0.5}
                value={dv.cropTop ?? 0}
                onChange={(e) => patchDcsViewport({ cropTop: Math.min(49, Math.max(-50, Number(e.target.value))) })}
              />
            </label>
            <label className="properties__field">
              <span>Right</span>
              <input
                type="number"
                min={-50}
                max={49}
                step={0.5}
                value={dv.cropRight ?? 0}
                onChange={(e) => patchDcsViewport({ cropRight: Math.min(49, Math.max(-50, Number(e.target.value))) })}
              />
            </label>
            <label className="properties__field">
              <span>Bottom</span>
              <input
                type="number"
                min={-50}
                max={49}
                step={0.5}
                value={dv.cropBottom ?? 0}
                onChange={(e) => patchDcsViewport({ cropBottom: Math.min(49, Math.max(-50, Number(e.target.value))) })}
              />
            </label>
            <label className="properties__field">
              <span>Left</span>
              <input
                type="number"
                min={-50}
                max={49}
                step={0.5}
                value={dv.cropLeft ?? 0}
                onChange={(e) => patchDcsViewport({ cropLeft: Math.min(49, Math.max(-50, Number(e.target.value))) })}
              />
            </label>
          </div>
        </PropertiesSection>

        <PropertiesSection title="Stream">
          <label className="properties__field">
            <span>Mode</span>
            <select value={dv.streamMode ?? 'poll'} onChange={(e) => patchDcsViewport({ streamMode: e.target.value as DcsViewportWidget['streamMode'] })}>
              <option value="poll">Poll (simple, one request per frame)</option>
              <option value="mjpeg">Live (persistent stream)</option>
            </select>
          </label>
          <label className="properties__field">
            <span>FPS</span>
            <input
              type="number"
              min={1}
              max={60}
              value={dv.fps ?? 5}
              // See ScreenCaptureWidget's own FPS field for why clamping
              // moved from onChange to onBlur.
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isNaN(n)) patchDcsViewport({ fps: n })
              }}
              onBlur={(e) => patchDcsViewport({ fps: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
          <label className="properties__field">
            <span>Quality</span>
            <input
              type="number"
              min={10}
              max={100}
              value={dv.quality ?? 70}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isNaN(n)) patchDcsViewport({ quality: n })
              }}
              onBlur={(e) => patchDcsViewport({ quality: Math.min(100, Math.max(10, Number(e.target.value) || 10)) })}
            />
          </label>
          <label className="properties__checkbox">
            <input
              type="checkbox"
              checked={dv.tapToStream ?? true}
              onChange={(e) => patchDcsViewport({ tapToStream: e.target.checked })}
            />
            Tap to start streaming
          </label>
          <p className="properties__hint">
            Loads showing a tap prompt instead of streaming immediately — lets a dashboard with several of these stay
            idle until you actually want a given one live.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Fit">
          <label className="properties__field">
            <span>Fit</span>
            <select value={dv.fit ?? 'cover'} onChange={(e) => patchDcsViewport({ fit: e.target.value as BackgroundFit })}>
              {BACKGROUND_FITS.filter((f) => f.value !== 'tile').map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </PropertiesSection>

        <PropertiesSection title="Adjustments">
          <label className="properties__field">
            <span>Brightness</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={dv.brightness ?? 1}
              onChange={(e) => patchDcsViewport({ brightness: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__field">
            <span>Contrast</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={dv.contrast ?? 1}
              onChange={(e) => patchDcsViewport({ contrast: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__field">
            <span>Saturation</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={dv.saturation ?? 1}
              onChange={(e) => patchDcsViewport({ saturation: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="properties__checkbox">
            <input type="checkbox" checked={dv.sharpen ?? false} onChange={(e) => patchDcsViewport({ sharpen: e.target.checked })} />
            Sharpen
          </label>
          <p className="properties__hint">Costs real CPU on the desktop per captured frame — off by default.</p>
        </PropertiesSection>

        <PropertiesSection title="Border">
          <div className="properties__field">
            <span>Border color</span>
            <ColorPickerButton
              value={dv.borderColor ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchDcsViewport({ borderColor: color, borderColorExpr: undefined })}
              isExpr={isBorderExpr}
              exprValue={dv.borderColorExpr ?? ''}
              onExprChange={(code) => patchDcsViewport({ borderColorExpr: code })}
              onEnterExpr={() => patchDcsViewport({ borderColorExpr: dv.borderColorExpr ?? '' })}
              onClearExpr={() => patchDcsViewport({ borderColorExpr: undefined })}
              opacity={dv.borderOpacity ?? 1}
              onOpacityChange={(v) => patchDcsViewport({ borderOpacity: v })}
            />
          </div>
          <label className="properties__field">
            <span>Border width</span>
            <input
              type="number"
              min={0}
              value={dv.borderWidth ?? 2}
              onChange={(e) => patchDcsViewport({ borderWidth: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </PropertiesSection>

        <PropertiesSection title="Layout">
          <span className="properties__section-label">Position & Size</span>
          <div className="properties__grid2">
            <label className="properties__field">
              <span>X</span>
              <input type="number" value={dv.x} onChange={(e) => patchDcsViewport({ x: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Y</span>
              <input type="number" value={dv.y} onChange={(e) => patchDcsViewport({ y: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>W</span>
              <input type="number" min={minSize} value={dv.w} onChange={(e) => patchDcsViewport({ w: Math.max(minSize, Number(e.target.value)) })} />
            </label>
            <label className="properties__field">
              <span>H</span>
              <input type="number" min={minSize} value={dv.h} onChange={(e) => patchDcsViewport({ h: Math.max(minSize, Number(e.target.value)) })} />
            </label>
          </div>

          <div className="properties__divider" />

          <label className="properties__field">
            <span>Z-index</span>
            <input type="number" value={dv.zIndex ?? 0} onChange={(e) => patchDcsViewport({ zIndex: Math.round(Number(e.target.value)) })} />
          </label>

          <div className="properties__divider" />

          <VisibilityField visible={dv.visible} visibleExpr={dv.visibleExpr} onChange={patchDcsViewport} />
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteDcsViewport}>
          Delete widget
        </button>
        </div>
      </aside>
    )
  }

  // Only reached once gauge/adjuster/encoder/switch/dropdown/screen-capture
  // have returned early above, so widget is known to be a
  // ButtonWidget | MorphButtonWidget here —
  // captured into a const for the same reason as those branches' own capture
  // above (TS doesn't retain narrowing inside nested closures like the
  // functions below).
  const statefulWidget = widget as StatefulWidget
  // Same narrowing-loss reasoning as statefulWidget above, for the new
  // `events` field — EventfulWidget, not StatefulWidget, since events isn't
  // part of the WidgetState/statesEnabled/activeStateExpr machinery.
  const eventfulWidget = widget as EventfulWidget
  // "Can this shape support a slider at all," independent of whether it's
  // currently turned on — gates the Enable-slider checkbox itself. Distinct
  // from isMorphSliderActive (imported below), which also factors in
  // sliderEnabled and is used everywhere that needs "is the slider actually
  // live right now" (the Move action editor, its badge count).
  const morphSliderUnsupported = widget.type === 'morph' && (hasMorphCycle(widget.blocks) || widget.blocks.length < 2)

  function patch(fields: Partial<Widget>): void {
    // fields' shape always matches widget's actual type at each call site
    // (e.g. blocks only patched from the morph branch below) — TS can't
    // verify that through a generic Widget union, hence the cast.
    updateWidgets(widgets.map((w) => (w.id === statefulWidget.id ? ({ ...w, ...fields } as Widget) : w)))
  }

  const stateIndex = statefulWidget.statesEnabled ? Math.min(activeStateIndex, statefulWidget.states.length - 1) : 0
  const activeState = statefulWidget.states[stateIndex] ?? statefulWidget.states[0]

  function patchState(fields: Partial<WidgetState>): void {
    patch({ states: statefulWidget.states.map((s, i) => (i === stateIndex ? { ...s, ...fields } : s)) })
  }

  // Only meaningful when widget.type === 'morph' — every call site is
  // reached exclusively from the morph branch below, where a block is known
  // to be selected.
  function patchBlock(blockId: string, fields: Partial<MorphBlockStateOverride>): void {
    if (statefulWidget.type !== 'morph') return
    const currentWidget = statefulWidget
    patch({
      blocks: currentWidget.blocks.map((b) =>
        b.id === blockId ? { ...b, perState: { ...b.perState, [activeState.id]: { ...b.perState[activeState.id], ...fields } } } : b
      )
    })
  }

  function patchLabel(labelId: string, fields: Partial<WidgetLabel>): void {
    patchState({ labels: activeState.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
  }

  function addLabel(): void {
    const newLabel: WidgetLabel = { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }
    patchState({ labels: [...activeState.labels, newLabel] })
  }

  function removeLabel(labelId: string): void {
    patchState({ labels: activeState.labels.filter((l) => l.id !== labelId) })
  }

  async function confirmRemoveLabel(labelId: string): Promise<void> {
    const ok = await confirm('Remove this label? This cannot be undone.', { confirmLabel: 'Remove' })
    if (ok) removeLabel(labelId)
  }

  function handleAddState(): void {
    const newState: WidgetState = { id: nextId(), name: `State ${statefulWidget.states.length + 1}`, labels: [] }
    patch({ states: [...statefulWidget.states, newState] })
    setActiveStateIndex(statefulWidget.states.length)
  }

  function renameState(index: number, name: string): void {
    patch({ states: statefulWidget.states.map((s, i) => (i === index ? { ...s, name } : s)) })
  }

  function handleToggleStatesEnabled(enabled: boolean): void {
    // Seed a real "Clicked" state the first time states are turned on for
    // this widget (still just a lone Default at that point) — subsequent
    // toggles leave whatever states already exist untouched, including a
    // deliberately-deleted Clicked.
    if (enabled && statefulWidget.states.length === 1) {
      patch({ statesEnabled: true, states: [...statefulWidget.states, deriveClickedState(statefulWidget.states[0], nextId())] })
    } else {
      patch({ statesEnabled: enabled })
    }
  }

  function handleDeleteState(index: number): void {
    if (index === 0) return
    const states = statefulWidget.states.filter((_, i) => i !== index)
    patch({ states })
    setActiveStateIndex((current) => {
      if (current === index) return Math.max(0, index - 1)
      if (current > index) return current - 1
      return current
    })
  }

  async function confirmDeleteState(index: number): Promise<void> {
    const ok = await confirm(`Delete the "${statefulWidget.states[index].name}" state? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (ok) handleDeleteState(index)
  }

  function handleReorderState(dropIndex: number): void {
    const dragIndex = dragStateIndex.current
    dragStateIndex.current = null
    if (dragIndex === null || dragIndex === 0 || dragIndex === dropIndex) return

    const states = [...statefulWidget.states]
    const [moved] = states.splice(dragIndex, 1)
    const target = Math.max(1, dropIndex > dragIndex ? dropIndex - 1 : dropIndex)
    states.splice(target, 0, moved)
    patch({ states })
    setActiveStateIndex(target)
  }

  async function handleResetStates(): Promise<void> {
    const ok = await confirm('Reset states back to just Default and Clicked? Custom states and per-state edits will be lost.', {
      confirmLabel: 'Reset'
    })
    if (!ok) return
    const base = statefulWidget.states[0]
    patch({ states: [base, deriveClickedState(base, nextId())] })
    setActiveStateIndex(0)
  }

  async function handleDelete(): Promise<void> {
    const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
    if (ok) {
      removeWidget(widget!.id)
      selectWidget(null)
    }
  }

  const effectiveColor = activeState.color ?? DEFAULT_WIDGET_COLOR
  const isColorExpr = activeState.colorExpr !== undefined
  const isBorderColorExpr = activeState.borderColorExpr !== undefined
  const isAutoBorderColor = activeState.borderColor == null && !isBorderColorExpr
  const isGlowColorExpr = activeState.glowColorExpr !== undefined
  const minSize = snapToGrid ? gridSize : 1

  return (
    <aside className="properties" style={{ width: propertiesWidth }}>
      {resizeHandle}
      <div className="properties__scroll">
      <div className="properties__header">
        <h2 className="properties__title">Properties</h2>
        <div className="properties__header-actions">
          <button type="button" className="properties__header-button" onClick={expandAllSections}>
            Expand all
          </button>
          <button type="button" className="properties__header-button" onClick={collapseAllSections}>
            Collapse all
          </button>
        </div>
      </div>
      <p className="properties__widget-type">{WIDGET_TYPE_LABELS[statefulWidget.type]}</p>

      <PropertiesSection title="States">
        <label className="properties__toggle">
          <input
            type="checkbox"
            checked={widget.statesEnabled ?? false}
            onChange={(e) => handleToggleStatesEnabled(e.target.checked)}
          />
          <span className="properties__toggle-track" />
          Enable states
        </label>
        <p className="properties__hint">
          {widget.statesEnabled
            ? 'Every state below is independent — labels, color, border, everything except keys and placement.'
            : 'This widget has one look, and its clicked/pressed color is worked out automatically from it.'}
        </p>

        {widget.statesEnabled && (
          <>
            <div className="properties__field">
              <span>States</span>
              <div className="color-picker-button__row">
                <div className="state-tabs-box">
                  <div className="state-tabs">
                    {widget.states.map((s, index) => (
                      <div
                        key={s.id}
                        className={`state-tab${index === stateIndex ? ' state-tab--active' : ''}${index === 0 ? ' state-tab--solo' : ''}`}
                        draggable={index !== 0}
                        onDragStart={() => (dragStateIndex.current = index)}
                        onDragOver={(e) => {
                          if (index !== 0) e.preventDefault()
                        }}
                        onDrop={() => handleReorderState(index)}
                        onClick={() => setActiveStateIndex(index)}
                      >
                        <span className="state-tab__name">{s.name}</span>
                        {index !== 0 && (
                          <button
                            type="button"
                            className="state-tab__remove"
                            title="Delete state"
                            onClick={(e) => {
                              e.stopPropagation()
                              confirmDeleteState(index)
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="state-tab state-tab--add" onClick={handleAddState} title="Add state">
                      +
                    </button>
                  </div>
                </div>
                {widget.activeStateExpr !== undefined ? (
                  <button
                    type="button"
                    className="color-picker-button__clear"
                    title="Remove the state expression"
                    onClick={() => patch({ activeStateExpr: undefined })}
                  >
                    ×
                  </button>
                ) : (
                  <button
                    type="button"
                    className="color-picker-button__fx"
                    title="Pick the active state with an expression"
                    onClick={() => patch({ activeStateExpr: '' })}
                  >
                    ƒx
                  </button>
                )}
              </div>
            </div>

            <button type="button" className="properties__file-button" onClick={handleResetStates}>
              Reset states
            </button>
          </>
        )}

        {widget.statesEnabled && widget.activeStateExpr !== undefined && (
          <div className="color-picker-button__expr-panel">
            <p className="properties__hint">
              Returns the exact name of the state that should be active. Falls back to the first state if it throws, returns
              something else, or names a state that doesn't exist.
            </p>
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor
                value={widget.activeStateExpr}
                onChange={(code) => patch({ activeStateExpr: code })}
                placeholder={ACTIVE_STATE_EXPR_PLACEHOLDER}
                minimal
              />
              <button
                type="button"
                className="color-picker-button__expand"
                title="Expand"
                onClick={() => setActiveStateExprExpanded(true)}
              >
                ⤢
              </button>
            </div>
          </div>
        )}

        {activeStateExprExpanded && (
          <ExpressionEditorModal
            value={widget.activeStateExpr ?? ''}
            onChange={(code) => patch({ activeStateExpr: code })}
            placeholder={ACTIVE_STATE_EXPR_PLACEHOLDER}
            onClose={() => setActiveStateExprExpanded(false)}
          />
        )}

        {widget.statesEnabled && (
          <label className="properties__field">
            <span>State name</span>
            <input
              value={activeState.name}
              disabled={stateIndex === 0 || activeState.isClicked}
              onChange={(e) => renameState(stateIndex, e.target.value)}
            />
          </label>
        )}
      </PropertiesSection>

      <PropertiesSection title="Labels" badge={activeState.labels.length}>
        {activeState.labels.map((label) => (
          <PropertiesSection key={label.id} title={labelSectionTitle(label)} sectionKey={label.id}>
            <LabelFields
              label={label}
              backgroundColor={effectiveColor}
              onChange={(fields) => patchLabel(label.id, fields)}
              onRemove={() => confirmRemoveLabel(label.id)}
            />
          </PropertiesSection>
        ))}
        <button type="button" className="properties__file-button" onClick={addLabel}>
          + Add label
        </button>
      </PropertiesSection>

      <PropertiesSection title="Color">
        {widget.type === 'button' || selectedBlockId === null ? (
          <>
            {/* A plain div, not a <label> — ColorPickerButton's popover nests
                OpacityField, which renders its own <label>, and a <label>
                nested inside another <label> is invalid HTML that browsers
                handle inconsistently (clicks inside the inner one could also
                re-trigger the outer label's default action on its first
                labelable descendant — the trigger button — closing the
                popover right as you release the mouse). */}
            {widget.type === 'morph' && (
              <p className="properties__hint">
                This widget's own color — every base block inherits it while left on Auto. Select a block on the canvas to override
                just that one.
              </p>
            )}
            <div className="properties__field">
              <span>Color</span>
              <ColorPickerButton
                key={`${activeState.id}-color`}
                value={effectiveColor}
                onChange={(color) => patchState({ color, colorExpr: undefined })}
                isExpr={isColorExpr}
                exprValue={activeState.colorExpr ?? ''}
                onExprChange={(code) => patchState({ colorExpr: code })}
                onEnterExpr={() => patchState({ colorExpr: activeState.colorExpr ?? '' })}
                onClearExpr={() => patchState({ colorExpr: undefined })}
                opacity={activeState.backgroundOpacity ?? 1}
                onOpacityChange={(v) => patchState({ backgroundOpacity: v })}
              />
            </div>

            <div className="properties__field">
              <span>Border color</span>
              <ColorPickerButton
                key={`${activeState.id}-border`}
                value={activeState.borderColor ?? pickAutoBorderColor(effectiveColor)}
                onChange={(color) => patchState({ borderColor: color, borderColorExpr: undefined })}
                isExpr={isBorderColorExpr}
                exprValue={activeState.borderColorExpr ?? ''}
                onExprChange={(code) => patchState({ borderColorExpr: code })}
                onEnterExpr={() => patchState({ borderColorExpr: activeState.borderColorExpr ?? '' })}
                onClearExpr={() => patchState({ borderColorExpr: undefined })}
                auto={isAutoBorderColor}
                onAuto={() => patchState({ borderColor: undefined, borderColorExpr: undefined })}
                opacity={activeState.borderOpacity ?? 1}
                onOpacityChange={(v) => patchState({ borderOpacity: v })}
              />
            </div>

            <div className="properties__field">
              <span>Glow color</span>
              <ColorPickerButton
                key={`${activeState.id}-glow`}
                value={activeState.glowColor ?? DEFAULT_WIDGET_COLOR}
                onChange={(color) => patchState({ glowColor: color, glowColorExpr: undefined })}
                isExpr={isGlowColorExpr}
                exprValue={activeState.glowColorExpr ?? ''}
                onExprChange={(code) => patchState({ glowColorExpr: code })}
                onEnterExpr={() => patchState({ glowColorExpr: activeState.glowColorExpr ?? '' })}
                onClearExpr={() => patchState({ glowColorExpr: undefined })}
                auto={activeState.glowColor === undefined && !isGlowColorExpr}
                onAuto={() => patchState({ glowColor: undefined, glowColorExpr: undefined })}
                opacity={activeState.glowOpacity ?? 1}
                onOpacityChange={(v) => patchState({ glowOpacity: v })}
              />
            </div>
          </>
        ) : (
          <p className="properties__hint">Editing this block's own color — see below.</p>
        )}
      </PropertiesSection>

      <PropertiesSection title="Appearance">
        {widget.type === 'button' ? (
          <>
            <span className="properties__section-label">Spacing</span>
            <SidesInputGrid
              top={{ value: activeState.spacingTop ?? 0, min: -1, onChange: (v) => patchState({ spacingTop: v }) }}
              right={{ value: activeState.spacingRight ?? 0, min: -1, onChange: (v) => patchState({ spacingRight: v }) }}
              bottom={{ value: activeState.spacingBottom ?? 0, min: -1, onChange: (v) => patchState({ spacingBottom: v }) }}
              left={{ value: activeState.spacingLeft ?? 0, min: -1, onChange: (v) => patchState({ spacingLeft: v }) }}
            />

            <div className="properties__divider" />

            <span className="properties__section-label">Border radius</span>
            <CornersInputGrid
              topLeft={{ value: activeState.radiusTopLeft ?? 4, min: 0, onChange: (v) => patchState({ radiusTopLeft: v }) }}
              topRight={{ value: activeState.radiusTopRight ?? 4, min: 0, onChange: (v) => patchState({ radiusTopRight: v }) }}
              bottomLeft={{ value: activeState.radiusBottomLeft ?? 4, min: 0, onChange: (v) => patchState({ radiusBottomLeft: v }) }}
              bottomRight={{ value: activeState.radiusBottomRight ?? 4, min: 0, onChange: (v) => patchState({ radiusBottomRight: v }) }}
            />

            <div className="properties__divider" />

            <span className="properties__section-label">Border thickness</span>
            <SidesInputGrid
              top={{ value: activeState.borderWidthTop ?? 1, min: 0, onChange: (v) => patchState({ borderWidthTop: v }) }}
              right={{ value: activeState.borderWidthRight ?? 1, min: 0, onChange: (v) => patchState({ borderWidthRight: v }) }}
              bottom={{ value: activeState.borderWidthBottom ?? 1, min: 0, onChange: (v) => patchState({ borderWidthBottom: v }) }}
              left={{ value: activeState.borderWidthLeft ?? 1, min: 0, onChange: (v) => patchState({ borderWidthLeft: v }) }}
            />
          </>
        ) : (
          (() => {
            const selectedBlock = widget.blocks.find((b) => b.id === selectedBlockId)
            if (!selectedBlock) {
              return <p className="properties__hint">Select a base block on the canvas to edit its spacing/radius/border.</p>
            }
            const merge = blockMerge(widget.blocks, selectedBlock, activeState.id)
            const override = selectedBlock.perState[activeState.id] ?? {}
            return (
              <MorphBlockFields
                block={selectedBlock}
                merge={merge}
                override={override}
                widgetColor={effectiveColor}
                widgetBorderColor={activeState.borderColor ?? pickAutoBorderColor(effectiveColor)}
                widgetBackgroundOpacity={activeState.backgroundOpacity ?? 1}
                widgetBorderOpacity={activeState.borderOpacity ?? 1}
                onChange={(fields) => patchBlock(selectedBlock.id, fields)}
              />
            )
          })()
        )}
      </PropertiesSection>

      {widget.type === 'morph' && (
        <PropertiesSection title="Slider">
          <label className="properties__toggle">
            <input
              type="checkbox"
              checked={widget.sliderEnabled ?? false}
              disabled={morphSliderUnsupported}
              onChange={(e) => patch({ sliderEnabled: e.target.checked })}
            />
            <span className="properties__toggle-track" />
            Enable slider
          </label>
          {morphSliderUnsupported ? (
            <p className="properties__hint">
              {hasMorphCycle(widget.blocks)
                ? "Disabled — this shape has a loop, so there's no single path across it. Remove a block to break the loop."
                : 'Disabled — needs at least two blocks to have a path to slide along.'}
            </p>
          ) : (
            <>
              <p className="properties__hint">
                Adds a drag handle that follows this shape's own longest path end-to-end, reporting how far along it is
                (0–100) — see the Move action below.
              </p>
              {widget.sliderEnabled && (
                <>
                  <ExpressionField
                    label="Rest value (optional)"
                    value={widget.valueExpr ?? ''}
                    onChange={(code) => patch({ valueExpr: code || undefined })}
                    placeholder="return variables.my_variable;"
                  />
                  <p className="properties__hint">
                    Where the handle sits while not being dragged, 0–100 — e.g. reflect a variable back into the visual.
                    Falls back to 0 if unset.
                  </p>
                </>
              )}
            </>
          )}
        </PropertiesSection>
      )}

      {widget.type === 'button' && (
        <PropertiesSection title="Rotation">
          <label className="properties__field">
            <span>Rotate angle</span>
            <div className="properties__file-row">
              {widget.rotateAngleExpr !== undefined ? (
                <span className="properties__hint-inline">Using expression below</span>
              ) : (
                <input type="number" value={widget.rotateAngle ?? 0} onChange={(e) => patch({ rotateAngle: Number(e.target.value) })} />
              )}
              {widget.rotateAngleExpr !== undefined ? (
                <button
                  type="button"
                  className="color-picker-button__clear"
                  title="Use a fixed angle instead"
                  onClick={() => patch({ rotateAngleExpr: undefined })}
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  className="color-picker-button__fx"
                  title="Compute the angle with an expression"
                  onClick={() => patch({ rotateAngleExpr: '' })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {widget.rotateAngleExpr !== undefined && (
            <ExpressionField
              label="Expression"
              value={widget.rotateAngleExpr ?? ''}
              onChange={(code) => patch({ rotateAngleExpr: code })}
              placeholder="return variables.my_variable;"
            />
          )}
          <p className="properties__hint">
            Spins the whole button, including its labels, in place. Falls back to the fixed angle if the expression is unset or
            fails to evaluate.
          </p>
        </PropertiesSection>
      )}

      <PropertiesSection title="Actions" badge={widget.type === 'morph' && isMorphSliderActive(widget) ? 3 : 2}>
        {/* eventfulWidget.events.move doesn't type-check here — Button's and
            Encoder's `events` have no `move` field at all (not even
            optional), so EventfulWidget's own union rejects that access
            outright. widget.type === 'morph' checked fresh inside each of
            these closures (rather than read off eventfulWidget) narrows
            `widget` correctly within that closure's own body — same "check
            it again inside the nested function" pattern patchBlock already
            relies on above. */}
        <EventSequenceEditor
          title="Press"
          steps={eventfulWidget.events.press}
          onChange={(steps) =>
            widget.type === 'morph'
              ? patch({ events: { ...widget.events, press: steps } })
              : patch({ events: { ...eventfulWidget.events, press: steps } })
          }
          dcsBiosActionEnabled={dcsBiosActionEnabled}
        />
        <EventSequenceEditor
          title="Release"
          steps={eventfulWidget.events.release}
          onChange={(steps) =>
            widget.type === 'morph'
              ? patch({ events: { ...widget.events, release: steps } })
              : patch({ events: { ...eventfulWidget.events, release: steps } })
          }
          dcsBiosActionEnabled={dcsBiosActionEnabled}
        />
        {widget.type === 'button' && (
          <>
            <EventSequenceEditor
              title="Double press"
              steps={widget.events.doublePress ?? []}
              onChange={(steps) => patch({ events: { ...widget.events, doublePress: steps } })}
              dcsBiosActionEnabled={dcsBiosActionEnabled}
            />
            <EventSequenceEditor
              title="Triple press"
              steps={widget.events.triplePress ?? []}
              onChange={(steps) => patch({ events: { ...widget.events, triplePress: steps } })}
              dcsBiosActionEnabled={dcsBiosActionEnabled}
            />
          </>
        )}
        {widget.type === 'morph' && isMorphSliderActive(widget) && (
          <EventSequenceEditor
            title="Move (while dragging)"
            steps={widget.events.move ?? []}
            onChange={(steps) => patch({ events: { ...widget.events, move: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
        )}
      </PropertiesSection>

      <PropertiesSection title="Layout">
        <div className="properties__grid2">
          <label className="properties__field">
            <span>X</span>
            <input type="number" value={widget.x} onChange={(e) => patch({ x: Number(e.target.value) })} />
          </label>
          <label className="properties__field">
            <span>Y</span>
            <input type="number" value={widget.y} onChange={(e) => patch({ y: Number(e.target.value) })} />
          </label>
          {widget.type === 'button' ? (
            <>
              <label className="properties__field">
                <span>W</span>
                <input
                  type="number"
                  min={minSize}
                  value={widget.w}
                  onChange={(e) => patch({ w: Math.max(minSize, Number(e.target.value)) })}
                />
              </label>
              <label className="properties__field">
                <span>H</span>
                <input
                  type="number"
                  min={minSize}
                  value={widget.h}
                  onChange={(e) => patch({ h: Math.max(minSize, Number(e.target.value)) })}
                />
              </label>
            </>
          ) : (
            <>
              <label className="properties__field">
                <span>Cell W</span>
                <input
                  type="number"
                  min={minSize}
                  value={widget.cellW}
                  onChange={(e) => patch({ cellW: Math.max(minSize, Number(e.target.value)) })}
                />
              </label>
              <label className="properties__field">
                <span>Cell H</span>
                <input
                  type="number"
                  min={minSize}
                  value={widget.cellH}
                  onChange={(e) => patch({ cellH: Math.max(minSize, Number(e.target.value)) })}
                />
              </label>
            </>
          )}
        </div>
        {widget.type === 'morph' && (
          <p className="properties__hint">
            {widget.blocks.length} block{widget.blocks.length === 1 ? '' : 's'} — select the widget on the canvas and use its +
            handles to add more.
          </p>
        )}

        <div className="properties__divider" />

        <label className="properties__field">
          <span>Z-index</span>
          <div className="color-picker-row">
            <button
              type="button"
              className={`color-picker-row__auto${activeState.zIndex === undefined ? ' color-picker-row__auto--active' : ''}`}
              onClick={() => patchState({ zIndex: undefined })}
            >
              Auto
            </button>
            <input
              type="number"
              value={activeState.zIndex ?? 0}
              onChange={(e) => patchState({ zIndex: Math.round(Number(e.target.value)) })}
            />
          </div>
        </label>
        <p className="properties__hint">Auto follows normal paint order (see Bring to front / Send to back above).</p>

        <div className="properties__divider" />

        <VisibilityField visible={widget.visible} visibleExpr={widget.visibleExpr} onChange={patch} />
      </PropertiesSection>

      <button className="properties__delete" onClick={handleDelete}>
        Delete widget
      </button>
      </div>
    </aside>
  )
}
