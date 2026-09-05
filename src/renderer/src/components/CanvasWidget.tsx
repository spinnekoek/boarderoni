import { useMemo, useRef, useState } from 'react'
import { useDashboardStore, useGridSize } from '../store'
import { getSubDeckWidgets } from '@shared/subDecks'
import { useEditorSettings } from '../settingsStore'
import { useWidgetDrag } from '../useWidgetDrag'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import { GaugeWidgetContent } from './widgets/GaugeWidget'
import { AdjusterWidgetContent } from './widgets/AdjusterWidget'
import { EncoderWidgetContent } from './widgets/EncoderWidget'
import { RockerSwitchWidgetContent } from './widgets/RockerSwitchWidget'
import { DialSwitchWidgetContent } from './widgets/DialSwitchWidget'
import { ToggleSwitchWidgetContent } from './widgets/ToggleSwitchWidget'
import { DropdownWidgetContent } from './widgets/DropdownWidget'
import { ScreenCaptureWidgetContent } from './widgets/ScreenCaptureWidget'
import { DcsViewportWidgetContent } from './widgets/DcsViewportWidget'
import { LabelWidgetContent } from './widgets/LabelWidget'
import { LineWidgetContent } from './widgets/LineWidget'
import { resolveActivePositionIndex } from '@shared/switchPosition'
import { resolveNumericExpr, resolveWidgetVisible, type VariableMap } from '@shared/expr'
import { getEffectiveStates } from '@shared/states'
import type { BoxWidget } from '@shared/types'

interface ResizeState {
  startX: number
  startY: number
  origW: number
  origH: number
  origX: number
  origY: number
}

export function CanvasWidget({
  widget,
  zoom,
  variables,
  onContextMenu
}: {
  widget: BoxWidget
  zoom: number
  variables: VariableMap
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const { selected, selectedWidgetIds, handlePointerDown, handlePointerMove, handlePointerUp } = useWidgetDrag(widget, zoom)
  const deckId = useDashboardStore((s) => s.deckId)
  const rootWidgets = useDashboardStore((s) => s.dashboard.widgets)
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks)
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  const widgets = useMemo(
    () => getSubDeckWidgets({ widgets: rootWidgets, subDecks }, editingSubDeckId),
    [rootWidgets, subDecks, editingSubDeckId]
  )
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const selectedBlockId = useDashboardStore((s) => s.selectedBlockId)
  const selectBlock = useDashboardStore((s) => s.selectBlock)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useGridSize()
  const isSoleSelection = selected && selectedWidgetIds.length === 1

  // Follow whichever tab is active in the properties panel — but only while
  // this is the sole selected widget, so an unselected (or multi-selected)
  // widget always shows its resting Default look. Only meaningful for a
  // button (gauge/adjuster have no states at all).
  const isSolePreviewTarget = widget.type === 'button' && selected && selectedWidgetIds.length === 1 && (widget.statesEnabled ?? false)
  const livePressed = useDashboardStore((s) => (widget.type === 'button' ? (s.livePressedWidgetIds[widget.id] ?? false) : false))
  // widget.states/positions are typed as always-present non-empty arrays,
  // but a corrupted/hand-edited save can violate that — fall back to `?? []`
  // everywhere below rather than letting a stale/malformed deck blank the
  // whole app (see ErrorBoundary's own comment for what happens without this).
  // Not the sole preview target: prefer showing a real device's own live
  // press (widget:live-press — see its own comment in shared/types.ts) over
  // the resting look, so a button held down on a tablet shows Clicked here
  // too instead of only on the device itself. Falls back through
  // getEffectiveStates (same activeStateExpr resolution ViewCanvas.tsx uses
  // for the deployed view) rather than always states[0], so a live-switching
  // state expression shows its effect here too instead of only once deployed.
  const previewState =
    widget.type === 'button'
      ? isSolePreviewTarget
        ? ((widget.states ?? [])[activeStateIndex] ?? widget.states?.[0])
        : (() => {
            const [defaultState, clickedState] = getEffectiveStates(widget, variables)
            return (livePressed ? clickedState : null) ?? defaultState ?? widget.states?.[0]
          })()
      : null
  const resizeState = useRef<ResizeState | null>(null)
  const [resizing, setResizing] = useState(false)

  // A line's own selection/resize box rotates to match its visual angle
  // (see LineWidgetContent's applyRotation prop) instead of staying
  // axis-aligned — every other rotatable widget type is roughly as wide as
  // it is tall, so an unrotated bounding box around a rotated one is a
  // minor visual mismatch; a line is extremely oblong (long and thin), so
  // the same mismatch would leave a "wide" selection box around a visually
  // "tall" line at 90°. handleResizePointerMove below counter-rotates the
  // pointer delta to match, same projection technique as
  // useToggleSwitchDrag.ts's own projectedDelta.
  const lineRotateAngle =
    widget.type === 'line'
      ? widget.rotateAngleExpr
        ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle)
        : widget.rotateAngle
      : undefined

  // The editor always shows every widget regardless of visible/visibleExpr
  // (see WidgetVisibility in shared/types.ts) — hiding it here would make
  // it unselectable/uneditable the moment it's toggled off. Dimming it
  // instead gives the same live feedback (and, since this evaluates the
  // exact same expression the deployed view does, the same console.log
  // reaching the debug panel that every other expression field already
  // gets here).
  const visible = resolveWidgetVisible(widget, variables)

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function patch(fields: Partial<BoxWidget>): void {
    // All three BoxWidget members share x/y/w/h, so this merge is safe
    // regardless of which one `widget` actually is — the cast just reflects
    // that TS can't narrow `fields`' shape back to whichever member matched
    // `w.id`.
    updateWidgets(widgets.map((w) => (w.id === widget.id ? ({ ...w, ...fields } as typeof w) : w)))
  }

  function handleResizePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: widget.w, origH: widget.h, origX: widget.x, origY: widget.y }
    setResizing(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see useWidgetDrag's handlePointerDown
    }
  }

  function handleResizePointerMove(e: React.PointerEvent): void {
    e.stopPropagation()
    const resize = resizeState.current
    if (!resize) return
    const rawDx = (e.clientX - resize.startX) / zoom
    const rawDy = (e.clientY - resize.startY) / zoom

    // Not tied to label content — text is allowed to overflow a widget
    // that's smaller than it needs (see .deck-button__label). The floor here
    // is purely about the grid: snapped widgets shouldn't shrink below one
    // grid cell, but with snapping off there's no such constraint.
    const minSize = snapToGrid ? gridSize : 1

    // Line widgets only ever drag their own length — h is a fixed thickness
    // set in the properties panel, not something the resize handle touches
    // (see the handle's own --horizontal CSS variant below). Use rotateAngle
    // to point it anywhere other than horizontal instead of a 2D resize.
    // Since the whole box is now visually rotated to match (lineRotateAngle
    // above), the raw screen-space pointer delta no longer IS the length
    // delta once rotated — project it onto the box's own rotated axis first,
    // same rotation-matrix technique useToggleSwitchDrag.ts's own
    // projectedDelta uses for the identical reason.
    if (widget.type === 'line') {
      const rad = ((lineRotateAngle ?? 0) * Math.PI) / 180
      const dx = rawDx * Math.cos(rad) + rawDy * Math.sin(rad)
      const w = Math.max(minSize, snap(resize.origW + dx))

      // Growing w always extends the box rightward in its own unrotated
      // layout — left/top/width/height are laid out BEFORE the rotate()
      // transform is applied, so at any angle other than 0, "rightward in
      // local space" is a diagonal shift on screen, not an extension along
      // the visually rotated line. Shifting x/y by half the actual (post
      // snap/clamp) length change, projected the same rotated-axis way, re-
      // anchors the OTHER end (the one not being dragged) back to where it
      // started — see this function's own investigation for the derivation.
      const halfDelta = (w - resize.origW) / 2
      const x = resize.origX + halfDelta * (Math.cos(rad) - 1)
      const y = resize.origY + halfDelta * Math.sin(rad)
      patch({ w, x, y })
      return
    }

    const w = Math.max(minSize, snap(resize.origW + rawDx))
    const h = Math.max(minSize, snap(resize.origH + rawDy))
    patch({ w, h })
  }

  function handleResizePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = null
    setResizing(false)
  }

  return (
    <div
      className={`canvas-widget${selected ? ' canvas-widget--selected' : ''}${visible ? '' : ' canvas-widget--hidden'}`}
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.w,
        height: widget.h,
        transform: lineRotateAngle ? `rotate(${lineRotateAngle}deg)` : undefined
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={onContextMenu}
    >
      {widget.type === 'button' && previewState && (
        <ButtonWidgetContent widget={widget} state={previewState} interactive={false} variables={variables} />
      )}
      {widget.type === 'gauge' && <GaugeWidgetContent widget={widget} variables={variables} />}
      {widget.type === 'label' && <LabelWidgetContent widget={widget} variables={variables} />}
      {widget.type === 'line' && <LineWidgetContent widget={widget} variables={variables} applyRotation={false} />}
      {widget.type === 'screen-capture' && <ScreenCaptureWidgetContent widget={widget} variables={variables} deckId={deckId} />}
      {widget.type === 'dcs-viewport' && <DcsViewportWidgetContent widget={widget} variables={variables} deckId={deckId} />}
      {widget.type === 'adjuster' && <AdjusterWidgetContent widget={widget} variables={variables} interactive={false} />}
      {widget.type === 'encoder' && <EncoderWidgetContent widget={widget} variables={variables} interactive={false} />}
      {widget.type === 'switch-rocker' && (
        <RockerSwitchWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? (widget.settleToInactive ? null : 0)}
          selectedPositionId={isSoleSelection ? selectedBlockId : null}
          onPositionSelect={(position) => {
            // First click on the widget selects the whole thing (same as
            // anywhere else on it) and stops here; a second click, now that
            // it's already the sole selection, drills into that position —
            // same two-step as MorphCanvasWidget's onBlockSelect.
            if (!isSoleSelection) return
            selectBlock(selectedBlockId === position.id ? null : position.id)
          }}
        />
      )}
      {widget.type === 'switch-dial' && (
        <DialSwitchWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? 0}
        />
      )}
      {widget.type === 'switch-toggle' && (
        <ToggleSwitchWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? 0}
          selectedPositionId={isSoleSelection ? selectedBlockId : null}
          onPositionSelect={(position) => {
            // Unlike RockerSwitchWidget's two-step select-then-drill above,
            // a toggle's zones are big and few enough that clicking one
            // should jump straight to that position in the properties
            // panel even on the very first click — no need to already be
            // the sole selection (the widget-level pointerdown this bubbles
            // up to, see useWidgetDrag, selects the widget in the same
            // event regardless).
            selectBlock(isSoleSelection && selectedBlockId === position.id ? null : position.id)
          }}
        />
      )}
      {widget.type === 'dropdown' && (
        <DropdownWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? 0}
        />
      )}
      {resizing && (
        <div
          className="canvas-widget__size-label"
          // Counter-rotates back upright against the outer box's own
          // lineRotateAngle (see its comment above) — inherited rotation
          // would otherwise turn this sideways/upside-down right along with
          // the box at anything but 0deg.
          style={{ transform: `scale(${1 / zoom}) rotate(${-(lineRotateAngle ?? 0)}deg)` }}
        >
          {Math.round(widget.w)} × {Math.round(widget.h)}
        </div>
      )}
      {selected && selectedWidgetIds.length === 1 && (
        <div
          className={`canvas-widget__resize-handle${widget.type === 'line' ? ' canvas-widget__resize-handle--horizontal' : ''}`}
          // Counter-scales against the canvas's own zoom (see
          // .canvas-widget__size-label's identical trick above) so the
          // handle stays a constant screen size instead of ballooning when
          // zoomed into a small widget.
          style={{ transform: `scale(${1 / zoom})` }}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        />
      )}
    </div>
  )
}
