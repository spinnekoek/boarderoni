import { useState } from 'react'
import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { RockerSwitchWidget, SwitchPosition } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'

// Shared between the editor preview (CanvasWidget, interactive=false, no
// onSelect) and the deployed view client (ViewCanvas, interactive=true,
// onSelect wired to useSwitchPosition's select — see RockerSwitchView in
// ViewCanvas.tsx). `activeIndex` is resolved by the caller (either from
// widget.activePositionExpr or a client-local tap, see useSwitchPosition.ts)
// — this component just renders whichever index it's given.
export function RockerSwitchWidgetContent({
  widget,
  variables,
  interactive,
  activeIndex,
  onSelect,
  onRelease,
  selectedPositionId,
  onPositionSelect,
  applyRotation = true
}: {
  widget: RockerSwitchWidget
  variables: VariableMap
  interactive: boolean
  // null (only reachable via RockerSwitchWidget.settleToInactive — see
  // useSwitchPosition.ts) means no position is currently active; every
  // segment renders unselected/unhighlighted.
  activeIndex: number | null
  // Fires on press (pointerdown), not release — a physical switch throws the
  // instant it's touched, not when you let go. See onRelease below for the
  // settleToInactive counterpart.
  onSelect?: (index: number) => void
  // RockerSwitchWidget.settleToInactive only (useSwitchPosition.ts's
  // settleInactive) — fires once on release of whichever segment was
  // actually pressed, never from a bare hover-out with nothing pressed (see
  // handleSegmentRelease below). Unused/no-op for every other switch type.
  onRelease?: () => void
  // Editor-only (interactive=false), same click-through-to-drill-down idea
  // MorphButtonWidgetContent's selectedBlockId/onBlockSelect use — see
  // CanvasWidget.tsx, which gates onPositionSelect on this widget already
  // being the sole selection so a first click still just selects the whole
  // widget, same as clicking anywhere else on it.
  selectedPositionId?: string | null
  onPositionSelect?: (position: SwitchPosition) => void
  // See ButtonWidgetContent's identical prop for why — CanvasWidget.tsx
  // rotates the outer selection/resize wrapper itself and passes false here
  // to avoid rotating twice.
  applyRotation?: boolean
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const orientation = widget.orientation ?? 'vertical'
  const flexDirection = orientation === 'vertical' ? 'column' : 'row'
  // Live "currently being pressed" preview, independent of activeIndex
  // itself. onSelect below already fires on the same pointerdown that sets
  // this, so for a non-settling switch this just mirrors activeIndex a
  // frame early. It matters for settleToInactive (see its own comment in
  // shared/types.ts): activeIndex has no resting "on" value there at all, so
  // without this a press wouldn't visibly highlight anything — holding a
  // segment down shows it active for as long as it's held, then it clears on
  // release (see handleSegmentRelease), matching a momentary rocker's
  // physical feel.
  const [pressedIndex, setPressedIndex] = useState<number | null>(null)

  // Guards onRelease so it only ever fires for the segment that was actually
  // pressed — onPointerLeave (below) fires from a bare hover-out too, with
  // no button down at all, so a naive unconditional call here would send a
  // spurious settleInactive trigger just from moving the mouse across an
  // unpressed switch. The functional setState form reads the just-committed
  // pressedIndex rather than whatever this render's `index` closed over,
  // which matters since onPointerUp/Cancel/Leave can all reach here.
  function handleSegmentRelease(index: number): void {
    setPressedIndex((current) => {
      if (current === index) onRelease?.()
      return null
    })
  }
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle

  return (
    <div
      className={`deck-rocker-switch${interactive ? '' : ' deck-rocker-switch--static'}`}
      style={widget.zIndex !== undefined ? { zIndex: widget.zIndex } : undefined}
    >
      <div
        className={`deck-rocker-switch__body deck-rocker-switch__body--${orientation}`}
        style={{
          flexDirection,
          background: trackColor,
          borderRadius: `${widget.radiusTopLeft ?? 6}px ${widget.radiusTopRight ?? 6}px ${widget.radiusBottomRight ?? 6}px ${widget.radiusBottomLeft ?? 6}px`,
          borderStyle: 'solid',
          borderTopWidth: widget.borderWidthTop ?? 1,
          borderRightWidth: widget.borderWidthRight ?? 1,
          borderBottomWidth: widget.borderWidthBottom ?? 1,
          borderLeftWidth: widget.borderWidthLeft ?? 1,
          borderColor,
          // Spins the shape/segments/position-labels together, in place —
          // widget.labels (rendered below, outside this div) stay upright.
          transform: applyRotation && rotateAngle ? `rotate(${rotateAngle}deg)` : undefined
        }}
      >
        {(widget.positions ?? []).map((position, index) => {
          const resolvedColor = resolveColor(position, variables)
          const unselectedColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
          const active = index === (pressedIndex ?? activeIndex)
          // Only resolved for the active position — no reason to evaluate
          // activeColor/activeOpacity's expression for every other one on
          // each render.
          let displayColor = unselectedColor
          let opacity = resolvedColor.opacity ?? position.backgroundOpacity ?? 1
          if (active) {
            const resolvedActive = resolveColor({ color: position.activeColor, colorExpr: position.activeColorExpr }, variables)
            displayColor = resolvedActive.color ?? pickAutoActiveColor(unselectedColor)
            opacity = resolvedActive.opacity ?? position.activeOpacity ?? opacity
          }
          const segmentColor = withOpacity(displayColor, opacity)
          const selected = !interactive && position.id === selectedPositionId
          return (
            <div
              key={position.id}
              className={`deck-rocker-switch__segment${selected ? ' deck-rocker-switch__segment--selected' : ''}`}
              style={{ background: segmentColor }}
              // Deliberately doesn't stop this from also bubbling up to the
              // outer canvas-widget div's own onPointerDown (widget-level
              // select/drag) — see CanvasWidget.tsx's isSoleSelection check,
              // which relies on that handler having already run (bubble
              // order: this fires first, then the ancestor) for a click that
              // both selects the widget AND lands on a position to correctly
              // not also drill into it in the same click. onSelect fires
              // here, on press, not from a click/pointerup handler — see its
              // own doc comment above.
              onPointerDown={
                interactive
                  ? () => {
                      setPressedIndex(index)
                      onSelect?.(index)
                    }
                  : () => onPositionSelect?.(position)
              }
              onPointerUp={interactive ? () => handleSegmentRelease(index) : undefined}
              onPointerCancel={interactive ? () => handleSegmentRelease(index) : undefined}
              onPointerLeave={interactive ? () => handleSegmentRelease(index) : undefined}
            >
              {renderWidgetLabels(position.labels, segmentColor, variables, debugMode)}
            </div>
          )
        })}
      </div>
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
    </div>
  )
}
