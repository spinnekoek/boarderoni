import { useRef } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useConfirmStore } from '../confirmStore'
import { nextId } from '../id'
import { FONT_OPTIONS, resolveFont } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, pickLegibleTextColor } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import { ANCHOR_OPTIONS } from '../background'
import { KeyCapture } from './KeyCapture'
import { ColorPicker } from './ColorPicker'
import type { BackgroundFit, HorizontalAlign, VerticalAlign, Widget, WidgetLabel } from '@shared/types'

const HORIZONTAL_ALIGNS: { value: HorizontalAlign; label: string }[] = [
  { value: 'left', label: 'L' },
  { value: 'center', label: 'C' },
  { value: 'right', label: 'R' }
]
const VERTICAL_ALIGNS: { value: VerticalAlign; label: string }[] = [
  { value: 'top', label: 'T' },
  { value: 'center', label: 'M' },
  { value: 'bottom', label: 'B' }
]

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

function OpacityField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): React.JSX.Element {
  return (
    <label className="properties__field">
      <span>
        {label} <span className="properties__hint-inline">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
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
  const isAutoTextColor = label.textColor == null

  return (
    <>
      <label className="properties__field">
        <span>Text</span>
        <input value={label.text} onChange={(e) => onChange({ text: e.target.value })} />
      </label>

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

      <label className="properties__field">
        <span>Text color</span>
        <div className="color-picker-row">
          <button
            type="button"
            className={`color-picker-row__auto${isAutoTextColor ? ' color-picker-row__auto--active' : ''}`}
            onClick={() => onChange({ textColor: undefined })}
          >
            Auto
          </button>
          <ColorPicker
            value={label.textColor ?? pickLegibleTextColor(backgroundColor)}
            onChange={(color) => onChange({ textColor: color })}
            auto={isAutoTextColor}
          />
        </div>
      </label>
      <OpacityField label="Text opacity" value={label.textOpacity ?? 1} onChange={(v) => onChange({ textOpacity: v })} />

      <label className="properties__field">
        <span>Align</span>
        <div className="align-buttons">
          {HORIZONTAL_ALIGNS.map(({ value, label: alignLabel }) => (
            <button
              key={value}
              type="button"
              className={`align-button${(label.align ?? 'center') === value ? ' align-button--active' : ''}`}
              onClick={() => onChange({ align: value })}
              title={`Align ${value}`}
            >
              {alignLabel}
            </button>
          ))}
        </div>
        <div className="align-buttons">
          {VERTICAL_ALIGNS.map(({ value, label: alignLabel }) => (
            <button
              key={value}
              type="button"
              className={`align-button${(label.verticalAlign ?? 'center') === value ? ' align-button--active' : ''}`}
              onClick={() => onChange({ verticalAlign: value })}
              title={`Align ${value}`}
            >
              {alignLabel}
            </button>
          ))}
        </div>
      </label>

      <button type="button" className="properties__file-remove" onClick={onRemove}>
        Remove label
      </button>
    </>
  )
}

export function PropertiesPanel(): React.JSX.Element {
  const dashboard = useDashboardStore((s) => s.dashboard)
  const widgets = dashboard.widgets
  const selectedWidgetId = useDashboardStore((s) => s.selectedWidgetId)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const uploadBackgroundImage = useDashboardStore((s) => s.uploadBackgroundImage)
  const clearBackgroundImage = useDashboardStore((s) => s.clearBackgroundImage)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const confirm = useConfirmStore((s) => s.confirm)

  const propertiesWidth = useEditorSettings((s) => s.propertiesWidth)
  const setPropertiesWidth = useEditorSettings((s) => s.setPropertiesWidth)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const resizeState = useRef<ResizeState | null>(null)

  const widget = widgets.find((w) => w.id === selectedWidgetId) ?? null

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
    updateWidgets(widgets.map((w) => (w.id === widget!.id ? { ...w, ...fields } : w)))
  }

  function patchLabel(labelId: string, fields: Partial<WidgetLabel>): void {
    patch({ labels: widget!.labels.map((l) => (l.id === labelId ? { ...l, ...fields } : l)) })
  }

  function addLabel(): void {
    const newLabel: WidgetLabel = { id: nextId(), text: 'New Label', align: 'center', verticalAlign: 'center' }
    patch({ labels: [...widget!.labels, newLabel] })
  }

  function removeLabel(labelId: string): void {
    patch({ labels: widget!.labels.filter((l) => l.id !== labelId) })
  }

  async function handleDelete(): Promise<void> {
    const ok = await confirm('Delete this widget? This cannot be undone.', { confirmLabel: 'Delete' })
    if (ok) {
      removeWidget(widget!.id)
      selectWidget(null)
    }
  }

  const effectiveColor = widget.color ?? DEFAULT_WIDGET_COLOR
  const isAutoBorderColor = widget.borderColor == null
  const minSize = snapToGrid ? gridSize : 1

  return (
    <aside className="properties" style={{ width: propertiesWidth }}>
      {resizeHandle}
      <h2 className="properties__title">Properties</h2>

      {widget.labels.map((label, index) => (
        <div key={label.id}>
          <details className="properties__advanced" open>
            <summary>Label {index + 1}</summary>
            <LabelFields
              label={label}
              backgroundColor={effectiveColor}
              onChange={(fields) => patchLabel(label.id, fields)}
              onRemove={() => removeLabel(label.id)}
            />
          </details>
          <div className="properties__divider" />
        </div>
      ))}
      <button type="button" className="properties__file-button" onClick={addLabel}>
        + Add label
      </button>

      <div className="properties__divider" />

      <label className="properties__field">
        <span>Color</span>
        <ColorPicker value={effectiveColor} onChange={(color) => patch({ color })} />
      </label>
      <OpacityField label="Background opacity" value={widget.backgroundOpacity ?? 1} onChange={(v) => patch({ backgroundOpacity: v })} />

      <label className="properties__field">
        <span>Border color</span>
        <div className="color-picker-row">
          <button
            type="button"
            className={`color-picker-row__auto${isAutoBorderColor ? ' color-picker-row__auto--active' : ''}`}
            onClick={() => patch({ borderColor: undefined })}
          >
            Auto
          </button>
          <ColorPicker
            value={widget.borderColor ?? pickAutoBorderColor(effectiveColor)}
            onChange={(color) => patch({ borderColor: color })}
            auto={isAutoBorderColor}
          />
        </div>
      </label>
      <OpacityField label="Border opacity" value={widget.borderOpacity ?? 1} onChange={(v) => patch({ borderOpacity: v })} />

      <div className="properties__divider" />

      <label className="properties__field">
        <span>Keys</span>
        <KeyCapture keys={widget.action.keys} onChange={(keys) => patch({ action: { ...widget.action, keys } })} />
      </label>
      <p className="properties__hint">Click the box, then press the key combo to bind. Click away to finish.</p>

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
        </div>
      </details>

      <div className="properties__divider" />

      <button className="properties__delete" onClick={handleDelete}>
        Delete widget
      </button>
    </aside>
  )
}
