import { useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useConfirmStore } from '../confirmStore'
import { nextId, isSectionOpen, setSectionOpen } from '../id'
import { FONT_OPTIONS, resolveFont } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, pickAutoBorderColor, pickLegibleTextColor } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import { deriveClickedState } from '@shared/states'
import { blockMerge, type BlockMerge } from '@shared/morph'
import { toVariableMap, tryEvaluateExpression } from '@shared/expr'
import { getSubDeckWidgets } from '@shared/subDecks'
import { ANCHOR_OPTIONS } from '../background'
import { KeyCapture } from './KeyCapture'
import { ColorPickerButton } from './ColorPickerButton'
import { DETENT_SIZE } from './widgets/DialSwitchWidget'
import { isMiddlePosition as isMiddleTogglePosition, toggleNameForIndex } from './widgets/ToggleSwitchWidget'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import type {
  ActionStep,
  AdjusterWidget,
  BackgroundFit,
  DelayStep,
  DetentStyle,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  EventfulWidget,
  GaugeWidget,
  HorizontalAlign,
  KeypressAction,
  MorphBlock,
  MorphBlockStateOverride,
  NavigateSubDeckAction,
  OpenOverlayAction,
  OverlayEdge,
  RockerSwitchWidget,
  ScreenCaptureWidget,
  SendDcsCommandAction,
  SequenceStep,
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
import type { DcsBiosCommandCatalogEntry, DcsBiosInputInterface } from '@shared/dcsBiosTypes'

const ACTIVE_STATE_EXPR_PLACEHOLDER = "return variables.BATTERY_SW === 0 ? 'Default' : 'Active';"
const ACTIVE_POSITION_EXPR_PLACEHOLDER = "return variables.GEAR_HANDLE === 1 ? 'Down' : 'Up';"
const LABEL_TEXT_EXPR_PLACEHOLDER = 'return "Count: " + variables.my_variable + " {{icon:fa-image}}";'

// Header shown at the top of the properties panel for whichever widget is
// selected, so switching between widgets (especially two that look similar
// mid-edit, like a rocker switch and an adjuster slider) is never ambiguous
// about which kind of widget you're looking at.
const WIDGET_TYPE_LABELS: Record<Widget['type'], string> = {
  button: 'Button',
  morph: 'Morph button',
  gauge: 'Gauge',
  adjuster: 'Adjuster',
  encoder: 'Encoder',
  'switch-rocker': 'Rocker switch',
  'switch-dial': 'Dial switch',
  'switch-toggle': 'Toggle switch',
  dropdown: 'Dropdown',
  'screen-capture': 'Screen capture'
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
  children
}: {
  title: string
  badge?: number
  // Persistence key for remembering this section's open/closed state (see
  // id.ts's isSectionOpen/setSectionOpen) — defaults to `title`. Per-label
  // sections pass the label's own id instead: several labels can share the
  // same title ("Untitled label") but shouldn't share open state.
  sectionKey?: string
  children: React.ReactNode
}): React.JSX.Element {
  const key = sectionKey ?? title
  const [open, setOpen] = useState(() => isSectionOpen(key))
  return (
    <details
      className="properties-section"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open
        setOpen(next)
        setSectionOpen(key, next)
      }}
    >
      <summary>
        {title}
        {badge ? ` (${badge})` : ''}
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

function LabelFields({
  label,
  backgroundColor,
  onChange,
  onRemove,
  showAnchor = false
}: {
  label: WidgetLabel
  backgroundColor: string
  onChange: (fields: Partial<WidgetLabel>) => void
  onRemove: () => void
  // Dial switch position labels only — see WidgetLabel.labelAnchor.
  showAnchor?: boolean
}): React.JSX.Element {
  const isTextColorExpr = label.textColorExpr !== undefined
  const isAutoTextColor = label.textColor == null && !isTextColorExpr
  const isTextExpr = label.textExpr !== undefined
  const [textExprExpanded, setTextExprExpanded] = useState(false)

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
            <button type="button" className="color-picker-button__fx" title="Use an expression" onClick={() => onChange({ textExpr: '' })}>
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
          {FONT_OPTIONS.map((f) => (
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

      <label className="properties__field">
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
      </label>

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
          {(label.labelAnchor ?? 'auto') === 'auto' && (
            <label className="properties__field">
              <span>Label distance</span>
              <input
                type="number"
                min={0}
                value={label.labelDistance ?? 12}
                onChange={(e) => onChange({ labelDistance: Math.max(0, Number(e.target.value)) })}
              />
            </label>
          )}
        </>
      )}

      <button type="button" className="properties__file-remove" onClick={onRemove}>
        Remove label
      </button>
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
  triangleBorderSupported = false
}: {
  shape: NonNullable<DialSwitchWidget['detentShape']>
  onShapeChange: (shape: NonNullable<DialSwitchWidget['detentShape']>) => void
  style: DetentStyle | undefined
  onStyleChange: (style: DetentStyle) => void
  // A ring detent is a plain HTML div using CSS clip-path for its triangle —
  // clip-path crops a border away too, so there's nothing to configure there.
  // The dial-center indicator's triangle, though, is a real SVG <polygon>
  // (see DetentIndicatorShape in DialSwitchWidget.tsx), which genuinely
  // supports a stroke — that caller passes this true to keep width/color
  // available for its triangle too.
  triangleBorderSupported?: boolean
}): React.JSX.Element {
  const defaultSize = DETENT_SIZE[shape]
  const defaultBorderRadius = shape === 'square' ? 2 : 1
  const showBorder = shape !== 'triangle' || triangleBorderSupported
  // A polygon has no rx equivalent, and a circle's roundness already comes
  // from being a circle — radius only means something for square/tick.
  const showBorderRadius = shape === 'square' || shape === 'tick'

  return (
    <>
      <div className="properties__grid2">
        <label className="properties__field">
          <span>Shape</span>
          <select value={shape} onChange={(e) => onShapeChange(e.target.value as NonNullable<DialSwitchWidget['detentShape']>)}>
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
      {showBorder ? (
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
      ) : (
        <p className="properties__hint">A triangle's clip-path can't take a border here.</p>
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
  dcsBiosActionEnabled
}: {
  action: WidgetAction
  onChange: (action: WidgetAction) => void
  dcsBiosActionEnabled: boolean
}): React.JSX.Element {
  // Own selector rather than a threaded prop — ActionFields is nested
  // several components deep (SequenceStepFields/EventSequenceEditor/every
  // widget's own properties section), so a prop would need plumbing
  // through all of them just for this one default/picker.
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks) ?? []

  return (
    <>
      <label className="properties__field">
        <span>Action</span>
        <select
          value={action.kind}
          onChange={(e) => {
            const kind = e.target.value
            if (kind === 'keypress') onChange({ kind: 'keypress', keys: [] })
            else if (kind === 'update-state') onChange({ kind: 'update-state', code: '' })
            else if (kind === 'send-dcs-command') onChange({ kind: 'send-dcs-command', aircraft: '', identifier: '', interface: 'action', argument: '' })
            else if (kind === 'navigate-subdeck') onChange({ kind: 'navigate-subdeck', target: { type: 'main-deck' } })
            else if (kind === 'open-overlay')
              onChange({ kind: 'open-overlay', subDeckId: subDecks[0]?.id ?? '', edge: 'right', size: 320, sizeUnit: 'px' })
            else onChange({ kind: 'close-overlay' })
          }}
        >
          <option value="keypress">Keypress</option>
          <option value="update-state">Update state</option>
          {(dcsBiosActionEnabled || action.kind === 'send-dcs-command') && <option value="send-dcs-command">Send DCS command</option>}
          <option value="navigate-subdeck">Navigate to screen</option>
          <option value="open-overlay">Open overlay</option>
          <option value="close-overlay">Close overlay</option>
        </select>
      </label>

      {action.kind === 'keypress' ? (
        <>
          <label className="properties__field">
            <span>Keys</span>
            <div className="properties__file-row">
              <KeyCapture keys={action.keys} onChange={(keys) => onChange({ ...action, keys })} />
              <button
                type="button"
                className="properties__file-remove"
                disabled={action.keys.length === 0}
                onClick={() => onChange({ ...action, keys: [] })}
              >
                Unbind
              </button>
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
            <textarea
              className="properties__code"
              rows={6}
              placeholder={'return { my_variable: (variables.my_variable ?? 0) + 1 };'}
              value={action.code}
              onChange={(e) => onChange({ kind: 'update-state', code: e.target.value })}
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
      ) : (
        // Narrowed by every kind check above, but TS doesn't retain that
        // narrowing inside the onChange closure below (a callback could in
        // principle run after `action` changes) — the cast reflects what's
        // already true at this point in the ternary, not a real unsafe leap.
        <SendDcsCommandActionEditor
          action={action as SendDcsCommandAction}
          onPatch={(fields) => onChange({ ...(action as SendDcsCommandAction), ...fields })}
        />
      )}
    </>
  )
}

// One step within an event's sequence — either a plain WidgetAction (via
// ActionFields, unchanged) or a Delay step (a single ms field). Both share
// the same remove control; only the action variant needs the full
// ActionFields sub-editor.
function SequenceStepFields({
  step,
  onChange,
  onRemove,
  dcsBiosActionEnabled
}: {
  step: SequenceStep
  onChange: (step: SequenceStep) => void
  onRemove: () => void
  dcsBiosActionEnabled: boolean
}): React.JSX.Element {
  if (step.kind === 'delay') {
    return (
      <div className="sequence-step__row">
        <label className="properties__field">
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
  return (
    <div className="sequence-step__row sequence-step__row--action">
      <div className="sequence-step__fields">
        <ActionFields action={step.action} onChange={(action) => onChange({ ...step, action })} dcsBiosActionEnabled={dcsBiosActionEnabled} />
      </div>
      <button type="button" className="properties__file-remove" onClick={onRemove}>
        Remove step
      </button>
    </div>
  )
}

// One interaction event's reorderable SequenceStep[] — self-contained
// drag-reorder state (dragStepIndex), same interaction pattern as the
// widget-states tabs' dragStateIndex/handleReorderState below, scoped per
// instance rather than shared, since Press/Release/Move each reorder
// independently.
function EventSequenceEditor({
  title,
  steps,
  onChange,
  dcsBiosActionEnabled
}: {
  title: string
  steps: SequenceStep[]
  onChange: (steps: SequenceStep[]) => void
  dcsBiosActionEnabled: boolean
}): React.JSX.Element {
  const dragStepIndex = useRef<number | null>(null)

  function patchStep(index: number, step: SequenceStep): void {
    onChange(steps.map((s, i) => (i === index ? step : s)))
  }
  function removeStep(index: number): void {
    onChange(steps.filter((_, i) => i !== index))
  }
  function addActionStep(): void {
    onChange([...steps, { kind: 'action', id: nextId(), action: { kind: 'keypress', keys: [] } } satisfies ActionStep])
  }
  function addDelayStep(): void {
    onChange([...steps, { kind: 'delay', id: nextId(), delayMs: 250 } satisfies DelayStep])
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
    <PropertiesSection title={title} badge={steps.length}>
      {steps.length === 0 && <p className="properties__hint">No actions on this event.</p>}
      {steps.map((step, index) => (
        <div
          key={step.id}
          className="sequence-step"
          draggable
          onDragStart={() => (dragStepIndex.current = index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleReorderStep(index)}
        >
          <SequenceStepFields
            step={step}
            onChange={(s) => patchStep(index, s)}
            onRemove={() => removeStep(index)}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
        </div>
      ))}
      <div className="properties__file-row">
        <button type="button" className="properties__file-button" onClick={addActionStep}>
          + Add action
        </button>
        <button type="button" className="properties__file-button" onClick={addDelayStep}>
          + Add delay
        </button>
      </div>
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

function groupCommandsByCategory(entries: DcsBiosCommandCatalogEntry[]): { category: string; entries: DcsBiosCommandCatalogEntry[] }[] {
  const byCategory = new Map<string, DcsBiosCommandCatalogEntry[]>()
  for (const entry of entries) {
    const list = byCategory.get(entry.category)
    if (list) list.push(entry)
    else byCategory.set(entry.category, [entry])
  }
  return Array.from(byCategory, ([category, categoryEntries]) => ({ category, entries: categoryEntries })).sort((a, b) =>
    a.category.localeCompare(b.category)
  )
}

// Editor for a ButtonWidget's SendDcsCommandAction — aircraft picker, then a
// searchable single-select command browser (same category-grouped list
// pattern as EventsModal's field browser, just single-select since a button
// fires exactly one command), then a value box with the same fx/expression
// toggle every other bindable value in this app uses (see MappingRow in
// EventsModal.tsx). A "Test" button sends the CURRENTLY configured value
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
  onPatch
}: {
  action: SendDcsCommandAction
  onPatch: (fields: Partial<SendDcsCommandAction>) => void
}): React.JSX.Element {
  const dcsBiosAircraft = useDashboardStore((s) => s.dcsBiosAircraft)
  const requestDcsBiosAircraftList = useDashboardStore((s) => s.requestDcsBiosAircraftList)
  const dcsBiosCommandCatalogs = useDashboardStore((s) => s.dcsBiosCommandCatalogs)
  const requestDcsBiosCommandCatalog = useDashboardStore((s) => s.requestDcsBiosCommandCatalog)
  const sendDcsBiosCommand = useDashboardStore((s) => s.sendDcsBiosCommand)
  const dcsBiosSendCommandResult = useDashboardStore((s) => s.dcsBiosSendCommandResult)
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []

  const [browserOpen, setBrowserOpen] = useState(false)
  const [search, setSearch] = useState('')

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
    return catalogEntries.filter(
      (e) => e.label.toLowerCase().includes(needle) || e.identifier.toLowerCase().includes(needle) || e.category.toLowerCase().includes(needle)
    )
  }, [catalogEntries, search])
  const groups = useMemo(() => groupCommandsByCategory(filtered), [filtered])
  const hasSearch = search.trim().length > 0

  const isExpr = action.argumentExpr !== undefined
  const draftRef = useRef(action.argumentExpr ?? '')
  useEffect(() => {
    if (action.argumentExpr) draftRef.current = action.argumentExpr
  }, [action.argumentExpr])

  function pickAircraft(aircraft: string): void {
    onPatch({ aircraft, identifier: '', interface: 'action', argument: '' })
    setBrowserOpen(false)
  }

  function pickCommand(entry: DcsBiosCommandCatalogEntry): void {
    onPatch({ identifier: entry.identifier, interface: entry.interface, argument: defaultArgumentFor(entry), argumentExpr: undefined })
    setBrowserOpen(false)
  }

  function handleTest(): void {
    if (isExpr && action.argumentExpr) {
      const result = tryEvaluateExpression(action.argumentExpr, toVariableMap(variables))
      if (result.ok) sendDcsBiosCommand(action.identifier, String(result.value))
      return
    }
    sendDcsBiosCommand(action.identifier, action.argument)
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
          <button type="button" className="properties__file-button" onClick={() => setBrowserOpen((o) => !o)}>
            {selected ? `${selected.label} — ${interfaceLabel(selected.interface)}` : 'Pick a command…'}
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
                <input value={action.argument} onChange={(e) => onPatch({ argument: e.target.value })} />
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
                  title="Compute the value with an expression"
                  onClick={() => onPatch({ argumentExpr: draftRef.current })}
                >
                  ƒx
                </button>
              )}
            </div>
          </label>
          {selected && <p className="properties__hint">{commandValueHint(selected)}</p>}

          {isExpr && (
            <label className="properties__field">
              <span>Expression</span>
              <textarea
                className="properties__code"
                rows={3}
                placeholder={"return variables.my_variable > 0 ? 'ON' : 'OFF';"}
                value={action.argumentExpr ?? ''}
                onChange={(e) => onPatch({ argumentExpr: e.target.value })}
              />
            </label>
          )}

          <div className="properties__file-row">
            <button type="button" className="properties__file-button" onClick={handleTest}>
              Test
            </button>
            {dcsBiosSendCommandResult && (
              <span className={dcsBiosSendCommandResult.ok ? 'properties__hint-inline' : 'dcsbios-settings__error'}>
                {dcsBiosSendCommandResult.ok ? 'Sent' : `Failed: ${dcsBiosSendCommandResult.error}`}
              </span>
            )}
          </div>
        </>
      )}
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
  dcsBiosActionEnabled,
  activePositionIndex,
  setActivePositionIndex,
  onActivePositionIdChange,
  dragPositionIndex,
  activePositionExprExpanded,
  setActivePositionExprExpanded,
  confirm,
  showLabelAnchor = false,
  showPositionName = true,
  maxPositions
}: {
  positions: SwitchPosition[]
  activePositionExpr?: string
  onPatchPositions: (positions: SwitchPosition[]) => void
  onPatchActivePositionExpr: (expr: string | undefined) => void
  dcsBiosActionEnabled: boolean
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

        <span className="properties__section-label">Labels</span>
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

      <PropertiesSection title="Actions" badge={positions.length}>
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
          />
        ))}
      </PropertiesSection>
    </>
  )
}

export function PropertiesPanel(): React.JSX.Element {
  const dashboard = useDashboardStore((s) => s.dashboard)
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  const widgets = getSubDeckWidgets(dashboard, editingSubDeckId)
  const selectedWidgetIds = useDashboardStore((s) => s.selectedWidgetIds)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const uploadBackgroundImage = useDashboardStore((s) => s.uploadBackgroundImage)
  const clearBackgroundImage = useDashboardStore((s) => s.clearBackgroundImage)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const removeWidgets = useDashboardStore((s) => s.removeWidgets)
  const bringToFront = useDashboardStore((s) => s.bringToFront)
  const sendToBack = useDashboardStore((s) => s.sendToBack)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const selectedBlockId = useDashboardStore((s) => s.selectedBlockId)
  const selectBlock = useDashboardStore((s) => s.selectBlock)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const setActiveStateIndex = useDashboardStore((s) => s.setActiveStateIndex)
  const confirm = useConfirmStore((s) => s.confirm)

  // Gates the "Send DCS command" action-kind option — defaults to enabled
  // while the real setting is still loading (opt-out, not opt-in, matching
  // appSettings.ts's own default), rather than flashing the option away and
  // back once the fetch resolves.
  const enabledDataSources = useDashboardStore((s) => s.enabledDataSources)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  useEffect(() => {
    if (enabledDataSources === null) requestAppSettings()
  }, [enabledDataSources, requestAppSettings])
  const dcsBiosActionEnabled = enabledDataSources === null || enabledDataSources.includes('dcsbios')

  // Same "fetch once if null" shape as enabledDataSources above, for
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
  const gridSize = useEditorSettings((s) => s.gridSize)
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__hint">
          {selectedWidgetIds.length} widgets selected — select just one to edit its properties.
        </p>
        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>
        <div className="properties__divider" />
        <button className="properties__delete" onClick={handleDeleteMany}>
          Delete {selectedWidgetIds.length} widgets
        </button>
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__hint">No widget selected — showing desktop properties.</p>

        <label className="properties__field">
          <span>Deck name</span>
          <input value={dashboard.name} onChange={(e) => updateDashboardMeta({ name: e.target.value })} />
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
      </aside>
    )
  }

  if (widget.type === 'gauge') {
    // Captured into a const rather than relying on control-flow narrowing of
    // `widget` persisting into the nested closures below — same reasoning as
    // ActionFields' own cast comment above (TS doesn't reliably retain a
    // narrowed type inside a closure that could in principle run later).
    const gauge = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = gauge.fill.colorExpr !== undefined
    const isTrackExpr = gauge.track.colorExpr !== undefined
    const isBorderExpr = gauge.borderColorExpr !== undefined

    function patchGauge(fields: Partial<GaugeWidget>): void {
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[gauge.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Style & Value">
          <label className="properties__field">
            <span>Style</span>
            <select value={gauge.style} onChange={(e) => patchGauge({ style: e.target.value as GaugeWidget['style'] })}>
              <option value="bar">Bar</option>
              <option value="arc">Arc</option>
            </select>
          </label>

          {gauge.style === 'bar' ? (
            <label className="properties__field">
              <span>Orientation</span>
              <select value={gauge.orientation ?? 'horizontal'} onChange={(e) => patchGauge({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </label>
          ) : (
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
          )}

          <div className="properties__grid2">
            <label className="properties__field">
              <span>Min</span>
              <input type="number" value={gauge.min} onChange={(e) => patchGauge({ min: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Max</span>
              <input type="number" value={gauge.max} onChange={(e) => patchGauge({ max: Number(e.target.value) })} />
            </label>
          </div>

          <label className="properties__field">
            <span>Value</span>
            <textarea
              className="properties__code"
              rows={3}
              placeholder="return variables.my_variable ?? 0;"
              value={gauge.valueExpr}
              onChange={(e) => patchGauge({ valueExpr: e.target.value })}
            />
          </label>
          <p className="properties__hint">
            JS function body — <code>variables</code> holds every variable&rsquo;s current value. Must return a number; anything else
            falls back to Min.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Colors">
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

          {gauge.style === 'bar' && (
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
          )}
        </PropertiesSection>

        <PropertiesSection title="Border shape">
          {gauge.style === 'bar' ? (
            <>
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
            </>
          ) : (
            <p className="properties__hint">Border radius/thickness/color only apply to the Bar style.</p>
          )}
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

        <PropertiesSection title="Position & Size">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteGauge}>
          Delete widget
        </button>
      </aside>
    )
  }

  if (widget.type === 'adjuster') {
    const adjuster = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = adjuster.fill.colorExpr !== undefined
    const isTrackExpr = adjuster.track.colorExpr !== undefined
    const isBorderExpr = adjuster.borderColorExpr !== undefined

    function patchAdjuster(fields: Partial<AdjusterWidget>): void {
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[adjuster.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Style & Value">
          <label className="properties__field">
            <span>Style</span>
            <select value={adjuster.style} onChange={(e) => patchAdjuster({ style: e.target.value as AdjusterWidget['style'] })}>
              <option value="slider">Slider</option>
              <option value="knob">Knob</option>
            </select>
          </label>

          {adjuster.style === 'slider' ? (
            <label className="properties__field">
              <span>Orientation</span>
              <select value={adjuster.orientation ?? 'vertical'} onChange={(e) => patchAdjuster({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </label>
          ) : (
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
          )}

          <div className="properties__grid2">
            <label className="properties__field">
              <span>Min</span>
              <input type="number" value={adjuster.min} onChange={(e) => patchAdjuster({ min: Number(e.target.value) })} />
            </label>
            <label className="properties__field">
              <span>Max</span>
              <input type="number" value={adjuster.max} onChange={(e) => patchAdjuster({ max: Number(e.target.value) })} />
            </label>
          </div>

          <label className="properties__field">
            <span>Rest value (optional)</span>
            <textarea
              className="properties__code"
              rows={2}
              placeholder="return variables.my_variable;"
              value={adjuster.valueExpr ?? ''}
              onChange={(e) => patchAdjuster({ valueExpr: e.target.value || undefined })}
            />
          </label>
          <p className="properties__hint">
            Where the handle sits while not being dragged — e.g. reflect a variable back into the visual. Falls back to Min if unset.
          </p>
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

          {adjuster.style === 'slider' && (
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
          )}
        </PropertiesSection>

        <PropertiesSection title="Border shape">
          {adjuster.style === 'slider' ? (
            <>
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
            </>
          ) : (
            <p className="properties__hint">Border radius/thickness/color only apply to the Slider style.</p>
          )}
        </PropertiesSection>

        <PropertiesSection title="Actions" badge={3}>
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

        <PropertiesSection title="Position & Size">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteAdjuster}>
          Delete widget
        </button>
      </aside>
    )
  }

  if (widget.type === 'encoder') {
    const encoder = widget
    const minSize = snapToGrid ? gridSize : 1
    const isFillExpr = encoder.fill.colorExpr !== undefined
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[encoder.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Step">
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

          <label className="properties__field">
            <span>Rest value (optional)</span>
            <textarea
              className="properties__code"
              rows={2}
              placeholder="return variables.my_variable;"
              value={encoder.valueExpr ?? ''}
              onChange={(e) => patchEncoder({ valueExpr: e.target.value || undefined })}
            />
          </label>
          <p className="properties__hint">
            Where the grip points (in degrees, 0 = up) while not being dragged — e.g. reflect a variable back into the visual. Pair
            with a Turn CW/CCW action below that nudges that same variable by the step size. Falls back to 0 if unset.
          </p>
        </PropertiesSection>

        <PropertiesSection title="Colors">
          <div className="properties__field">
            <span>Grip color</span>
            <ColorPickerButton
              value={encoder.fill.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(color) => patchEncoder({ fill: { ...encoder.fill, color, colorExpr: undefined } })}
              isExpr={isFillExpr}
              exprValue={encoder.fill.colorExpr ?? ''}
              onExprChange={(code) => patchEncoder({ fill: { ...encoder.fill, colorExpr: code } })}
              onEnterExpr={() => patchEncoder({ fill: { ...encoder.fill, colorExpr: encoder.fill.colorExpr ?? '' } })}
              onClearExpr={() => patchEncoder({ fill: { ...encoder.fill, colorExpr: undefined } })}
              opacity={encoder.fill.backgroundOpacity ?? 1}
              onOpacityChange={(v) => patchEncoder({ fill: { ...encoder.fill, backgroundOpacity: v } })}
            />
          </div>

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

        <PropertiesSection title="Actions" badge={4}>
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

        <PropertiesSection title="Position & Size">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteEncoder}>
          Delete widget
        </button>
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sw.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Style">
          <label className="properties__field">
            <span>Orientation</span>
            <select value={sw.orientation ?? 'vertical'} onChange={(e) => patchSwitch({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </label>
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

          <div className="properties__divider" />

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

        <SwitchPositionsEditor
          positions={sw.positions}
          activePositionExpr={sw.activePositionExpr}
          onPatchPositions={(positions) => patchSwitch({ positions })}
          onPatchActivePositionExpr={(activePositionExpr) => patchSwitch({ activePositionExpr })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          activePositionIndex={effectiveActivePositionIndex}
          setActivePositionIndex={setActivePositionIndex}
          onActivePositionIdChange={selectBlock}
          dragPositionIndex={dragPositionIndex}
          activePositionExprExpanded={activePositionExprExpanded}
          setActivePositionExprExpanded={setActivePositionExprExpanded}
          confirm={confirm}
        />

        <PropertiesSection title="Advanced">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteSwitch}>
          Delete widget
        </button>
      </aside>
    )
  }

  if (widget.type === 'switch-toggle') {
    const sw = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = sw.track.colorExpr !== undefined
    const isFillExpr = sw.fill.colorExpr !== undefined
    const isBorderExpr = sw.borderColorExpr !== undefined
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sw.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Style">
          <label className="properties__field">
            <span>Orientation</span>
            <select value={sw.orientation ?? 'vertical'} onChange={(e) => patchSwitch({ orientation: e.target.value as 'horizontal' | 'vertical' })}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
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
        </PropertiesSection>

        {sw.positions.length === 3 && (
          <PropertiesSection title="Momentary">
            <p className="properties__hint">
              A momentary Top/Bottom position only stays selected while pressed (or dragged onto, in drag mode) — release it and it
              springs back to Middle, firing Middle's own action too.
            </p>
            {sw.positions.map((position, index) => {
              if (isMiddleTogglePosition(index, sw.positions.length)) return null
              return (
                <label key={position.id} className="properties__checkbox">
                  <input
                    type="checkbox"
                    checked={position.momentary ?? false}
                    onChange={(e) =>
                      patchSwitch({ positions: sw.positions.map((p, i) => (i === index ? { ...p, momentary: e.target.checked } : p)) })
                    }
                  />
                  {position.name}
                </label>
              )
            })}
          </PropertiesSection>
        )}

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
        </PropertiesSection>

        <PropertiesSection title="Lever">
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
        </PropertiesSection>

        {sw.positions.length === 3 && (
          <PropertiesSection title="Circle (middle position)">
            <label className="properties__field">
              <span>Circle size</span>
              <input
                type="number"
                min={1}
                value={sw.circleRadius ?? 9}
                onChange={(e) => patchSwitch({ circleRadius: Math.max(1, Number(e.target.value)) })}
              />
            </label>
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

        <SwitchPositionsEditor
          positions={sw.positions}
          activePositionExpr={sw.activePositionExpr}
          onPatchPositions={(positions) =>
            patchSwitch({ positions: positions.map((p, i) => ({ ...p, name: toggleNameForIndex(i, positions.length) })) })
          }
          onPatchActivePositionExpr={(activePositionExpr) => patchSwitch({ activePositionExpr })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
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

        <PropertiesSection title="Advanced">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteSwitch}>
          Delete widget
        </button>
      </aside>
    )
  }

  if (widget.type === 'switch-dial') {
    const sw = widget
    const minSize = snapToGrid ? gridSize : 1
    const isTrackExpr = sw.track.colorExpr !== undefined
    const isFillExpr = sw.fill.colorExpr !== undefined
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sw.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Style">
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

          <PropertiesSection title="Detents">
            <DetentShapeEditor
              shape={sw.detentShape ?? 'circle'}
              onShapeChange={(shape) => patchSwitch({ detentShape: shape === 'circle' ? undefined : shape })}
              style={sw.detentStyle}
              onStyleChange={(detentStyle) => patchSwitch({ detentStyle })}
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

          <PropertiesSection title="Dial shape">
            <label className="properties__field">
              <span>Shape</span>
              <select
                value={sw.dialShape ?? 'needle'}
                onChange={(e) => patchSwitch({ dialShape: e.target.value === 'needle' ? undefined : (e.target.value as DialSwitchWidget['dialShape']) })}
              >
                <option value="needle">Needle</option>
                <option value="square">Square</option>
                <option value="circle">Circle</option>
              </select>
            </label>

            {(sw.dialShape ?? 'needle') === 'needle' && (
              <div className="properties__field">
                <span>Needle color</span>
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
            )}

            {sw.dialShape === 'square' && (
              <>
                <div className="properties__grid2">
                  <label className="properties__field">
                    <span>Square width</span>
                    <input
                      type="number"
                      min={1}
                      value={sw.squareWidth ?? 24}
                      onChange={(e) => patchSwitch({ squareWidth: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Square height</span>
                    <input
                      type="number"
                      min={1}
                      value={sw.squareHeight ?? 24}
                      onChange={(e) => patchSwitch({ squareHeight: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                </div>
                <div className="properties__grid2">
                  <label className="properties__field">
                    <span>Square border width</span>
                    <input
                      type="number"
                      min={0}
                      value={sw.squareBorderWidth ?? 0}
                      onChange={(e) => patchSwitch({ squareBorderWidth: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Square border radius</span>
                    <input
                      type="number"
                      min={0}
                      value={sw.squareBorderRadius ?? 2}
                      onChange={(e) => patchSwitch({ squareBorderRadius: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>
                <div className="properties__field">
                  <span>Square color</span>
                  <ColorPickerButton
                    value={sw.squareColor ?? sw.fill.color ?? DEFAULT_WIDGET_COLOR}
                    onChange={(color) => patchSwitch({ squareColor: color })}
                    auto={sw.squareColor === undefined}
                    onAuto={() => patchSwitch({ squareColor: undefined })}
                  />
                </div>
                <div className="properties__field">
                  <span>Square border color</span>
                  <ColorPickerButton
                    value={sw.squareBorderColor ?? DEFAULT_WIDGET_COLOR}
                    onChange={(color) => patchSwitch({ squareBorderColor: color })}
                  />
                </div>
              </>
            )}

            {sw.dialShape === 'circle' && (
              <>
                <div className="properties__grid2">
                  <label className="properties__field">
                    <span>Circle size</span>
                    <input
                      type="number"
                      min={1}
                      value={sw.circleSize ?? 20}
                      onChange={(e) => patchSwitch({ circleSize: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Circle border width</span>
                    <input
                      type="number"
                      min={0}
                      value={sw.circleBorderWidth ?? 0}
                      onChange={(e) => patchSwitch({ circleBorderWidth: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>
                <div className="properties__field">
                  <span>Circle color</span>
                  <ColorPickerButton
                    value={sw.circleColor ?? sw.fill.color ?? DEFAULT_WIDGET_COLOR}
                    onChange={(color) => patchSwitch({ circleColor: color })}
                    auto={sw.circleColor === undefined}
                    onAuto={() => patchSwitch({ circleColor: undefined })}
                  />
                </div>
                <div className="properties__field">
                  <span>Circle border color</span>
                  <ColorPickerButton
                    value={sw.circleBorderColor ?? DEFAULT_WIDGET_COLOR}
                    onChange={(color) => patchSwitch({ circleBorderColor: color })}
                  />
                </div>
                <div className="properties__grid2">
                  <label className="properties__field">
                    <span>Indent count</span>
                    <input
                      type="number"
                      min={0}
                      value={sw.circleIndentCount ?? 0}
                      onChange={(e) => patchSwitch({ circleIndentCount: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="properties__field">
                    <span>Indent size</span>
                    <input
                      type="number"
                      min={0}
                      value={sw.circleIndentSize ?? Math.round(((sw.circleSize ?? 20) / 6) * 10) / 10}
                      onChange={(e) => patchSwitch({ circleIndentSize: Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                </div>
                <div className="properties__field">
                  <span>Indent color</span>
                  <ColorPickerButton
                    value={sw.circleIndentColor ?? sw.track.color ?? DEFAULT_WIDGET_COLOR}
                    onChange={(color) => patchSwitch({ circleIndentColor: color })}
                    auto={sw.circleIndentColor === undefined}
                    onAuto={() => patchSwitch({ circleIndentColor: undefined })}
                  />
                </div>
              </>
            )}
          </PropertiesSection>

          {(sw.dialShape === 'square' || sw.dialShape === 'circle') && (
            <PropertiesSection title="Indicator">
              <DetentShapeEditor
                shape={sw.indicatorShape ?? 'circle'}
                onShapeChange={(shape) => patchSwitch({ indicatorShape: shape === 'circle' ? undefined : shape })}
                style={sw.indicatorStyle}
                onStyleChange={(indicatorStyle) => patchSwitch({ indicatorStyle })}
                triangleBorderSupported
              />
              <div className="properties__field">
                <span>Indicator color</span>
                <ColorPickerButton
                  value={
                    sw.indicatorColor ??
                    ((sw.dialShape === 'square' ? sw.squareColor : sw.circleColor) ?? sw.fill.color ?? DEFAULT_WIDGET_COLOR)
                  }
                  onChange={(color) => patchSwitch({ indicatorColor: color })}
                  auto={sw.indicatorColor === undefined}
                  onAuto={() => patchSwitch({ indicatorColor: undefined })}
                />
              </div>
              <label className="properties__field">
                <span>Indicator distance</span>
                <input
                  type="number"
                  min={0}
                  value={sw.indicatorDistance ?? (sw.dialShape === 'square' ? (sw.squareHeight ?? 24) / 2 : (sw.circleSize ?? 20) / 2)}
                  onChange={(e) => patchSwitch({ indicatorDistance: Math.max(0, Number(e.target.value)) })}
                />
              </label>
            </PropertiesSection>
          )}

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
        </PropertiesSection>

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

        <SwitchPositionsEditor
          positions={sw.positions}
          activePositionExpr={sw.activePositionExpr}
          onPatchPositions={(positions) => patchSwitch({ positions })}
          onPatchActivePositionExpr={(activePositionExpr) => patchSwitch({ activePositionExpr })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
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

        <PropertiesSection title="Advanced">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteSwitch}>
          Delete widget
        </button>
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[dd.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Style">
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

          <div className="properties__divider" />

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

        <PropertiesSection title="Actions" badge={2}>
          <EventSequenceEditor
            title="Press"
            steps={dd.events.press}
            onChange={(steps) => patchDropdown({ events: { ...dd.events, press: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <EventSequenceEditor
            title="Release"
            steps={dd.events.release}
            onChange={(steps) => patchDropdown({ events: { ...dd.events, release: steps } })}
            dcsBiosActionEnabled={dcsBiosActionEnabled}
          />
          <p className="properties__hint">
            Press/Release fire on every hold, wherever it ends. Each position below has its own separate action (see "Positions" →
            "Actions") that only fires if you release on it — dragging off the end instead fires Release but not that position&rsquo;s
            action.
          </p>
        </PropertiesSection>

        <SwitchPositionsEditor
          positions={dd.positions}
          activePositionExpr={dd.activePositionExpr}
          onPatchPositions={(positions) => patchDropdown({ positions })}
          onPatchActivePositionExpr={(activePositionExpr) => patchDropdown({ activePositionExpr })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
          activePositionIndex={activePositionIndex}
          setActivePositionIndex={setActivePositionIndex}
          dragPositionIndex={dragPositionIndex}
          activePositionExprExpanded={activePositionExprExpanded}
          setActivePositionExprExpanded={setActivePositionExprExpanded}
          confirm={confirm}
        />

        <PropertiesSection title="Advanced">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteDropdown}>
          Delete widget
        </button>
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
        <h2 className="properties__title">Properties</h2>
        <p className="properties__widget-type">{WIDGET_TYPE_LABELS[sc.type]}</p>

        <div className="properties__layer-row">
          <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
            <span aria-hidden="true">⬆</span> Bring to front
          </button>
          <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
            <span aria-hidden="true">⬇</span> Send to back
          </button>
        </div>

        <PropertiesSection title="Region">
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
              max={15}
              value={sc.fps ?? 5}
              onChange={(e) => patchScreenCapture({ fps: Math.min(15, Math.max(1, Number(e.target.value))) })}
            />
          </label>
          <label className="properties__field">
            <span>Quality</span>
            <input
              type="number"
              min={10}
              max={100}
              value={sc.quality ?? 70}
              onChange={(e) => patchScreenCapture({ quality: Math.min(100, Math.max(10, Number(e.target.value))) })}
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

        <PropertiesSection title="Advanced">
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
        </PropertiesSection>

        <button className="properties__delete" onClick={handleDeleteScreenCapture}>
          Delete widget
        </button>
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
  const minSize = snapToGrid ? gridSize : 1

  return (
    <aside className="properties" style={{ width: propertiesWidth }}>
      {resizeHandle}
      <h2 className="properties__title">Properties</h2>
      <p className="properties__widget-type">{WIDGET_TYPE_LABELS[statefulWidget.type]}</p>

      <div className="properties__layer-row">
        <button type="button" className="properties__layer-button" onClick={() => bringToFront(selectedWidgetIds)}>
          <span aria-hidden="true">⬆</span> Bring to front
        </button>
        <button type="button" className="properties__layer-button" onClick={() => sendToBack(selectedWidgetIds)}>
          <span aria-hidden="true">⬇</span> Send to back
        </button>
      </div>

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

      <PropertiesSection title="Actions" badge={2}>
        <EventSequenceEditor
          title="Press"
          steps={eventfulWidget.events.press}
          onChange={(steps) => patch({ events: { press: steps, release: eventfulWidget.events.release } })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
        />
        <EventSequenceEditor
          title="Release"
          steps={eventfulWidget.events.release}
          onChange={(steps) => patch({ events: { press: eventfulWidget.events.press, release: steps } })}
          dcsBiosActionEnabled={dcsBiosActionEnabled}
        />
      </PropertiesSection>

      <PropertiesSection title="Position & Size">
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
      </PropertiesSection>

      <button className="properties__delete" onClick={handleDelete}>
        Delete widget
      </button>
    </aside>
  )
}
