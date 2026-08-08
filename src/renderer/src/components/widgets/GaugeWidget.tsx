import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { GaugeWidget } from '@shared/types'
import { renderWidgetLabels } from './labels'
import { describeArc } from './arcPath'

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405
const ARC_RADIUS = 42
const ARC_STROKE_WIDTH = 10

function GaugeBar({
  fraction,
  fillColor,
  trackColor,
  orientation
}: {
  fraction: number
  fillColor: string
  trackColor: string
  orientation: 'horizontal' | 'vertical'
}): React.JSX.Element {
  const fillStyle: React.CSSProperties =
    orientation === 'vertical'
      ? { position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fraction * 100}%`, backgroundColor: fillColor }
      : { position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fraction * 100}%`, backgroundColor: fillColor }

  return (
    <div className="deck-gauge__track" style={{ backgroundColor: trackColor }}>
      <div style={fillStyle} />
    </div>
  )
}

function GaugeArc({
  fraction,
  fillColor,
  trackColor,
  startAngle,
  endAngle
}: {
  fraction: number
  fillColor: string
  trackColor: string
  startAngle: number
  endAngle: number
}): React.JSX.Element {
  return (
    <svg className="deck-gauge__arc" viewBox="0 0 100 100">
      <path d={describeArc(50, 50, ARC_RADIUS, startAngle, endAngle)} stroke={trackColor} strokeWidth={ARC_STROKE_WIDTH} fill="none" strokeLinecap="round" />
      <path
        d={describeArc(50, 50, ARC_RADIUS, startAngle, startAngle + fraction * (endAngle - startAngle))}
        stroke={fillColor}
        strokeWidth={ARC_STROKE_WIDTH}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Passive — no pointer handlers, no `onTrigger`. Shared as-is between the
// editor preview (CanvasWidget) and the deployed view client (ViewCanvas).
export function GaugeWidgetContent({ widget, variables }: { widget: GaugeWidget; variables: VariableMap }): React.JSX.Element {
  const raw = resolveNumericExpr(widget.valueExpr, variables) ?? widget.min
  const span = widget.max - widget.min
  const fraction = span !== 0 ? Math.min(1, Math.max(0, (raw - widget.min) / span)) : 0

  const resolvedFill = resolveColor(widget.fill, variables)
  const fillColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)

  // Box border/radius only make sense for the 'bar' style — an arc has no
  // rectangular box to round or border, so 'arc' renders with none at all
  // rather than a stray rounded-rect outline sitting behind the circle.
  const outerStyle: React.CSSProperties = {
    ...(widget.style === 'bar' && {
      borderRadius: `${widget.radiusTopLeft ?? 4}px ${widget.radiusTopRight ?? 4}px ${widget.radiusBottomRight ?? 4}px ${widget.radiusBottomLeft ?? 4}px`,
      borderStyle: 'solid',
      borderTopWidth: widget.borderWidthTop ?? 1,
      borderRightWidth: widget.borderWidthRight ?? 1,
      borderBottomWidth: widget.borderWidthBottom ?? 1,
      borderLeftWidth: widget.borderWidthLeft ?? 1,
      borderColor
    }),
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
  }

  return (
    <div className="deck-gauge" style={outerStyle}>
      {widget.style === 'arc' ? (
        <GaugeArc fraction={fraction} fillColor={fillColor} trackColor={trackColor} startAngle={widget.startAngle ?? DEFAULT_START_ANGLE} endAngle={widget.endAngle ?? DEFAULT_END_ANGLE} />
      ) : (
        <GaugeBar fraction={fraction} fillColor={fillColor} trackColor={trackColor} orientation={widget.orientation ?? 'horizontal'} />
      )}
      {renderWidgetLabels(widget.labels, trackColor, variables)}
    </div>
  )
}
