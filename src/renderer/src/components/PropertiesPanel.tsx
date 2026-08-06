import { useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useConfirmStore } from '../confirmStore'
import { nextId } from '../id'
import { FONT_OPTIONS, resolveFont } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, pickLegibleTextColor } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import { deriveClickedState } from '@shared/states'
import { blockMerge, type BlockMerge } from '@shared/morph'
import { toVariableMap, tryEvaluateExpression } from '@shared/expr'
import { ANCHOR_OPTIONS } from '../background'
import { KeyCapture } from './KeyCapture'
import { ColorPicker } from './ColorPicker'
import { ColorPickerButton } from './ColorPickerButton'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import type {
  BackgroundFit,
  HorizontalAlign,
  MorphBlock,
  MorphBlockStateOverride,
  SendDcsCommandAction,
  VerticalAlign,
  Widget,
  WidgetLabel,
  WidgetState
} from '@shared/types'
import type { DcsBiosCommandCatalogEntry, DcsBiosInputInterface } from '@shared/dcsBiosTypes'

const ACTIVE_STATE_EXPR_PLACEHOLDER = "return variables.BATTERY_SW === 0 ? 'Default' : 'Active';"

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

function LabelFields({
  label,
  backgroundColor,
  onChange,
  onRemove
}: {
  label: WidgetLabel
  backgroundColor: string
  onChange: (fields: Partial<WidgetLabel>) => void
  onRemove: () => void
}): React.JSX.Element {
  const isTextColorExpr = label.textColorExpr !== undefined
  const isAutoTextColor = label.textColor == null && !isTextColorExpr
  const isTextExpr = label.textExpr !== undefined

  return (
    <>
      <label className="properties__field">
        <span>Text</span>
        {isTextExpr ? (
          <textarea
            className="properties__code"
            rows={4}
            placeholder={'return "Count: " + variables.my_variable;'}
            value={label.textExpr}
            onChange={(e) => onChange({ textExpr: e.target.value })}
          />
        ) : (
          <input value={label.text} onChange={(e) => onChange({ text: e.target.value })} />
        )}
      </label>
      <button
        type="button"
        className="properties__file-button"
        onClick={() => onChange({ textExpr: isTextExpr ? undefined : '' })}
      >
        {isTextExpr ? 'Use static text' : 'Use expression'}
      </button>

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
        <input
          type="number"
          min={0}
          value={label.padding ?? DEFAULT_WIDGET_PADDING}
          onChange={(e) => onChange({ padding: Math.max(0, Number(e.target.value)) })}
        />
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

      <button type="button" className="properties__file-remove" onClick={onRemove}>
        Remove label
      </button>
    </>
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

export function PropertiesPanel(): React.JSX.Element {
  const dashboard = useDashboardStore((s) => s.dashboard)
  const widgets = dashboard.widgets
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

  const propertiesWidth = useEditorSettings((s) => s.propertiesWidth)
  const setPropertiesWidth = useEditorSettings((s) => s.setPropertiesWidth)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const resizeState = useRef<ResizeState | null>(null)
  const dragStateIndex = useRef<number | null>(null)
  const [activeStateExprExpanded, setActiveStateExprExpanded] = useState(false)

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
        <div className="properties__file-row">
          <button type="button" className="properties__file-button" onClick={() => bringToFront(selectedWidgetIds)}>
            Bring to front
          </button>
          <button type="button" className="properties__file-button" onClick={() => sendToBack(selectedWidgetIds)}>
            Send to back
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

        <label className="properties__field">
          <span>Background color</span>
          <ColorPicker value={dashboard.backgroundColor} onChange={(color) => updateDashboardMeta({ backgroundColor: color })} />
        </label>

        <div className="properties__divider" />

        <details className="properties__advanced">
          <summary>Background image</summary>

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
        </details>
      </aside>
    )
  }

  function patch(fields: Partial<Widget>): void {
    // fields' shape always matches widget's actual type at each call site
    // (e.g. blocks only patched from the morph branch below) — TS can't
    // verify that through a generic Widget union, hence the cast.
    updateWidgets(widgets.map((w) => (w.id === widget!.id ? ({ ...w, ...fields } as Widget) : w)))
  }

  const stateIndex = widget.statesEnabled ? Math.min(activeStateIndex, widget.states.length - 1) : 0
  const activeState = widget.states[stateIndex] ?? widget.states[0]

  function patchState(fields: Partial<WidgetState>): void {
    patch({ states: widget!.states.map((s, i) => (i === stateIndex ? { ...s, ...fields } : s)) })
  }

  // Only meaningful when widget.type === 'morph' — every call site is
  // reached exclusively from the morph branch below, where a block is known
  // to be selected.
  function patchBlock(blockId: string, fields: Partial<MorphBlockStateOverride>): void {
    if (widget!.type !== 'morph') return
    const currentWidget = widget!
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
    const newState: WidgetState = { id: nextId(), name: `State ${widget!.states.length + 1}`, labels: [] }
    patch({ states: [...widget!.states, newState] })
    setActiveStateIndex(widget!.states.length)
  }

  function renameState(index: number, name: string): void {
    patch({ states: widget!.states.map((s, i) => (i === index ? { ...s, name } : s)) })
  }

  function handleToggleStatesEnabled(enabled: boolean): void {
    // Seed a real "Clicked" state the first time states are turned on for
    // this widget (still just a lone Default at that point) — subsequent
    // toggles leave whatever states already exist untouched, including a
    // deliberately-deleted Clicked.
    if (enabled && widget!.states.length === 1) {
      patch({ statesEnabled: true, states: [...widget!.states, deriveClickedState(widget!.states[0], nextId())] })
    } else {
      patch({ statesEnabled: enabled })
    }
  }

  function handleDeleteState(index: number): void {
    if (index === 0) return
    const states = widget!.states.filter((_, i) => i !== index)
    patch({ states })
    setActiveStateIndex((current) => {
      if (current === index) return Math.max(0, index - 1)
      if (current > index) return current - 1
      return current
    })
  }

  async function confirmDeleteState(index: number): Promise<void> {
    const ok = await confirm(`Delete the "${widget!.states[index].name}" state? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (ok) handleDeleteState(index)
  }

  function handleReorderState(dropIndex: number): void {
    const dragIndex = dragStateIndex.current
    dragStateIndex.current = null
    if (dragIndex === null || dragIndex === 0 || dragIndex === dropIndex) return

    const states = [...widget!.states]
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
    const base = widget!.states[0]
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

      <div className="properties__file-row">
        <button type="button" className="properties__file-button" onClick={() => bringToFront(selectedWidgetIds)}>
          Bring to front
        </button>
        <button type="button" className="properties__file-button" onClick={() => sendToBack(selectedWidgetIds)}>
          Send to back
        </button>
      </div>
      <div className="properties__divider" />

      <label className="properties__checkbox">
        <input
          type="checkbox"
          checked={widget.statesEnabled ?? false}
          onChange={(e) => handleToggleStatesEnabled(e.target.checked)}
        />
        Enable states
      </label>
      <p className="properties__hint">
        {widget.statesEnabled
          ? 'Every state below is independent — labels, color, border, everything except keys and placement.'
          : 'This widget has one look, and its clicked/pressed color is worked out automatically from it.'}
      </p>

      {widget.statesEnabled && (
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
          <div className="state-tabs__spacer" />
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

      <div className="properties__divider" />

      {activeState.labels.map((label, index) => (
        <div key={label.id}>
          <details className="properties__advanced" open>
            <summary>Label {index + 1}</summary>
            <LabelFields
              label={label}
              backgroundColor={effectiveColor}
              onChange={(fields) => patchLabel(label.id, fields)}
              onRemove={() => confirmRemoveLabel(label.id)}
            />
          </details>
          <div className="properties__divider" />
        </div>
      ))}
      <button type="button" className="properties__file-button" onClick={addLabel}>
        + Add label
      </button>

      <div className="properties__divider" />

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

      <div className="properties__divider" />

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

      <label className="properties__field">
        <span>Action</span>
        <select
          value={widget.action.kind}
          onChange={(e) => {
            const kind = e.target.value
            if (kind === 'keypress') patch({ action: { kind: 'keypress', keys: [] } })
            else if (kind === 'update-state') patch({ action: { kind: 'update-state', code: '' } })
            else patch({ action: { kind: 'send-dcs-command', aircraft: '', identifier: '', interface: 'action', argument: '' } })
          }}
        >
          <option value="keypress">Keypress</option>
          <option value="update-state">Update state</option>
          {(dcsBiosActionEnabled || widget.action.kind === 'send-dcs-command') && (
            <option value="send-dcs-command">Send DCS command</option>
          )}
        </select>
      </label>

      {widget.action.kind === 'keypress' ? (
        <>
          <label className="properties__field">
            <span>Keys</span>
            <div className="properties__file-row">
              <KeyCapture keys={widget.action.keys} onChange={(keys) => patch({ action: { kind: 'keypress', keys } })} />
              <button
                type="button"
                className="properties__file-remove"
                disabled={widget.action.keys.length === 0}
                onClick={() => patch({ action: { kind: 'keypress', keys: [] } })}
              >
                Unbind
              </button>
            </div>
          </label>
          <p className="properties__hint">Click the box, then press the key combo to bind. Click away to finish.</p>
        </>
      ) : widget.action.kind === 'update-state' ? (
        <>
          <label className="properties__field">
            <span>Code</span>
            <textarea
              className="properties__code"
              rows={6}
              placeholder={'return { my_variable: (variables.my_variable ?? 0) + 1 };'}
              value={widget.action.code}
              onChange={(e) => patch({ action: { kind: 'update-state', code: e.target.value } })}
            />
          </label>
          <p className="properties__hint">
            JS function body — <code>variables</code> holds every variable&rsquo;s current value. Return an object of{' '}
            <code>{'{ name: newValue }'}</code> pairs to update them (unknown names get created).
          </p>
        </>
      ) : (
        // Narrowed by the two kind checks above, but TS doesn't retain that
        // narrowing inside the onPatch closure below (a callback could in
        // principle run after `widget` changes) — the cast reflects what's
        // already true at this point in the ternary, not a real unsafe leap.
        <SendDcsCommandActionEditor
          action={widget.action as SendDcsCommandAction}
          onPatch={(fields) => patch({ action: { ...(widget.action as SendDcsCommandAction), ...fields } })}
        />
      )}

      <div className="properties__divider" />

      <details className="properties__advanced">
        <summary>Advanced</summary>
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
      </details>

      <div className="properties__divider" />

      <button type="button" className="properties__file-button" onClick={handleResetStates}>
        Reset states
      </button>

      <button className="properties__delete" onClick={handleDelete}>
        Delete widget
      </button>
    </aside>
  )
}
