import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, type VariableMap } from '@shared/expr'
import type { RockerSwitchWidget, SwitchPosition } from '@shared/types'
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
  selectedPositionId,
  onPositionSelect
}: {
  widget: RockerSwitchWidget
  variables: VariableMap
  interactive: boolean
  activeIndex: number
  onSelect?: (index: number) => void
  // Editor-only (interactive=false), same click-through-to-drill-down idea
  // MorphButtonWidgetContent's selectedBlockId/onBlockSelect use — see
  // CanvasWidget.tsx, which gates onPositionSelect on this widget already
  // being the sole selection so a first click still just selects the whole
  // widget, same as clicking anywhere else on it.
  selectedPositionId?: string | null
  onPositionSelect?: (position: SwitchPosition) => void
}): React.JSX.Element {
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const orientation = widget.orientation ?? 'vertical'
  const flexDirection = orientation === 'vertical' ? 'column' : 'row'

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
          borderColor
        }}
      >
        {widget.positions.map((position, index) => {
          const resolvedColor = resolveColor(position, variables)
          const unselectedColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
          const active = index === activeIndex
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
              onClick={interactive ? () => onSelect?.(index) : undefined}
              // Deliberately doesn't stop this from also bubbling up to the
              // outer canvas-widget div's own onPointerDown (widget-level
              // select/drag) — see CanvasWidget.tsx's isSoleSelection check,
              // which relies on that handler having already run (bubble
              // order: this fires first, then the ancestor) for a click that
              // both selects the widget AND lands on a position to correctly
              // not also drill into it in the same click.
              onPointerDown={!interactive ? () => onPositionSelect?.(position) : undefined}
            >
              {renderWidgetLabels(position.labels, segmentColor, variables)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
