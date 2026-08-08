import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, type VariableMap } from '@shared/expr'
import type { RockerSwitchWidget } from '@shared/types'
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
  onSelect
}: {
  widget: RockerSwitchWidget
  variables: VariableMap
  interactive: boolean
  activeIndex: number
  onSelect?: (index: number) => void
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
          const segmentColor = withOpacity(
            resolvedColor.color ?? DEFAULT_WIDGET_COLOR,
            resolvedColor.opacity ?? position.backgroundOpacity ?? 1
          )
          const active = index === activeIndex
          return (
            <div
              key={position.id}
              className={`deck-rocker-switch__segment${active ? ' deck-rocker-switch__segment--active' : ''}`}
              style={{ background: segmentColor }}
              onClick={interactive ? () => onSelect?.(index) : undefined}
            >
              {renderWidgetLabels(position.labels, segmentColor, variables)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
