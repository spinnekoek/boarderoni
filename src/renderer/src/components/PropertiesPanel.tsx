import { useRef } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useConfirmStore } from '../confirmStore'
import { nextId } from '../id'
import { FONT_OPTIONS, resolveFont } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, pickLegibleTextColor } from '@shared/color'
import { DEFAULT_WIDGET_FONT_SIZE, DEFAULT_WIDGET_PADDING } from '@shared/constants'
import { deriveClickedState } from '@shared/states'
import { ANCHOR_OPTIONS } from '../background'
import { KeyCapture } from './KeyCapture'
import { ColorPicker } from './ColorPicker'
import type { BackgroundFit, HorizontalAlign, VerticalAlign, Widget, WidgetLabel, WidgetState } from '@shared/types'

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
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const setActiveStateIndex = useDashboardStore((s) => s.setActiveStateIndex)
  const confirm = useConfirmStore((s) => s.confirm)

  const propertiesWidth = useEditorSettings((s) => s.propertiesWidth)
  const setPropertiesWidth = useEditorSettings((s) => s.setPropertiesWidth)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const resizeState = useRef<ResizeState | null>(null)
  const dragStateIndex = useRef<number | null>(null)

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
    updateWidgets(widgets.map((w) => (w.id === widget!.id ? { ...w, ...fields } : w)))
  }

  const stateIndex = widget.statesEnabled ? Math.min(activeStateIndex, widget.states.length - 1) : 0
  const activeState = widget.states[stateIndex] ?? widget.states[0]

  function patchState(fields: Partial<WidgetState>): void {
    patch({ states: widget!.states.map((s, i) => (i === stateIndex ? { ...s, ...fields } : s)) })
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
  const isAutoBorderColor = activeState.borderColor == null
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
        </div>
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

      <label className="properties__field">
        <span>Color</span>
        <ColorPicker value={effectiveColor} onChange={(color) => patchState({ color })} />
      </label>
      <OpacityField
        label="Background opacity"
        value={activeState.backgroundOpacity ?? 1}
        onChange={(v) => patchState({ backgroundOpacity: v })}
      />

      <label className="properties__field">
        <span>Border color</span>
        <div className="color-picker-row">
          <button
            type="button"
            className={`color-picker-row__auto${isAutoBorderColor ? ' color-picker-row__auto--active' : ''}`}
            onClick={() => patchState({ borderColor: undefined })}
          >
            Auto
          </button>
          <ColorPicker
            value={activeState.borderColor ?? pickAutoBorderColor(effectiveColor)}
            onChange={(color) => patchState({ borderColor: color })}
            auto={isAutoBorderColor}
          />
        </div>
      </label>
      <OpacityField label="Border opacity" value={activeState.borderOpacity ?? 1} onChange={(v) => patchState({ borderOpacity: v })} />

      <div className="properties__divider" />

      <span className="properties__section-label">Spacing</span>
      <div className="properties__grid2">
        <label className="properties__field">
          <span>Top</span>
          <input
            type="number"
            min={-1}
            value={activeState.spacingTop ?? 0}
            onChange={(e) => patchState({ spacingTop: Math.max(-1, Math.round(Number(e.target.value))) })}
          />
        </label>
        <label className="properties__field">
          <span>Right</span>
          <input
            type="number"
            min={-1}
            value={activeState.spacingRight ?? 0}
            onChange={(e) => patchState({ spacingRight: Math.max(-1, Math.round(Number(e.target.value))) })}
          />
        </label>
        <label className="properties__field">
          <span>Bottom</span>
          <input
            type="number"
            min={-1}
            value={activeState.spacingBottom ?? 0}
            onChange={(e) => patchState({ spacingBottom: Math.max(-1, Math.round(Number(e.target.value))) })}
          />
        </label>
        <label className="properties__field">
          <span>Left</span>
          <input
            type="number"
            min={-1}
            value={activeState.spacingLeft ?? 0}
            onChange={(e) => patchState({ spacingLeft: Math.max(-1, Math.round(Number(e.target.value))) })}
          />
        </label>
      </div>

      <div className="properties__divider" />

      <span className="properties__section-label">Border radius</span>
      <div className="properties__grid2">
        <label className="properties__field">
          <span>Top left</span>
          <input
            type="number"
            min={0}
            value={activeState.radiusTopLeft ?? 4}
            onChange={(e) => patchState({ radiusTopLeft: Math.max(0, Math.round(Number(e.target.value))) })}
          />
        </label>
        <label className="properties__field">
          <span>Top right</span>
          <input
            type="number"
            min={0}
            value={activeState.radiusTopRight ?? 4}
            onChange={(e) => patchState({ radiusTopRight: Math.max(0, Math.round(Number(e.target.value))) })}
          />
        </label>
        <label className="properties__field">
          <span>Bottom left</span>
          <input
            type="number"
            min={0}
            value={activeState.radiusBottomLeft ?? 4}
            onChange={(e) => patchState({ radiusBottomLeft: Math.max(0, Math.round(Number(e.target.value))) })}
          />
        </label>
        <label className="properties__field">
          <span>Bottom right</span>
          <input
            type="number"
            min={0}
            value={activeState.radiusBottomRight ?? 4}
            onChange={(e) => patchState({ radiusBottomRight: Math.max(0, Math.round(Number(e.target.value))) })}
          />
        </label>
      </div>

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

      <button type="button" className="properties__file-button" onClick={handleResetStates}>
        Reset states
      </button>

      <button className="properties__delete" onClick={handleDelete}>
        Delete widget
      </button>
    </aside>
  )
}
