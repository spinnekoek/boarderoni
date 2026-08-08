import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { AdjusterWidget } from '@shared/types'
import { renderWidgetLabels } from './labels'
import { describeArc, polarToCartesian } from './arcPath'

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405
const ARC_RADIUS = 42
const ARC_STROKE_WIDTH = 10

function AdjusterBar({
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
  const handleStyle: React.CSSProperties =
    orientation === 'vertical'
      ? { position: 'absolute', left: '50%', bottom: `${fraction * 100}%`, transform: 'translate(-50%, 50%)' }
      : { position: 'absolute', top: '50%', left: `${fraction * 100}%`, transform: 'translate(-50%, -50%)' }

  return (
    <>
      <div className="deck-adjuster__track" style={{ backgroundColor: trackColor }}>
        <div style={fillStyle} />
      </div>
      <div className="deck-adjuster__handle" style={{ ...handleStyle, backgroundColor: fillColor }} />
    </>
  )
}

// The knob's handle is drawn as an SVG <circle> in the same 0-100 viewBox
// coordinate space as the arc paths (rather than a separately-positioned
// HTML element) — that's what keeps it pixel-aligned with the arc under the
// SVG's own aspect-ratio letterboxing when the widget's box isn't square,
// which a percentage-positioned sibling div couldn't guarantee.
function AdjusterKnob({
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
  const handleAngle = startAngle + fraction * (endAngle - startAngle)
  const handlePos = polarToCartesian(50, 50, ARC_RADIUS, handleAngle)

  return (
    <svg className="deck-gauge__arc" viewBox="0 0 100 100">
      <path d={describeArc(50, 50, ARC_RADIUS, startAngle, endAngle)} stroke={trackColor} strokeWidth={ARC_STROKE_WIDTH} fill="none" strokeLinecap="round" />
      <path d={describeArc(50, 50, ARC_RADIUS, startAngle, handleAngle)} stroke={fillColor} strokeWidth={ARC_STROKE_WIDTH} fill="none" strokeLinecap="round" />
      <circle cx={handlePos.x} cy={handlePos.y} r={7} fill={fillColor} stroke="#14161b" strokeWidth={1} />
    </svg>
  )
}

// Shared between the editor preview (CanvasWidget, interactive=false, no
// pointer props) and the deployed view client (ViewCanvas, interactive=true,
// pointer props wired to useAdjusterDrag's handlers). dragFraction — when
// provided by the drag hook — overrides the resolved rest position so the
// handle tracks the pointer immediately, without waiting on a round trip.
export function AdjusterWidgetContent({
  widget,
  variables,
  interactive,
  dragFraction,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  widget: AdjusterWidget
  variables: VariableMap
  interactive: boolean
  dragFraction?: number
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
}): React.JSX.Element {
  const restValue = widget.valueExpr ? (resolveNumericExpr(widget.valueExpr, variables) ?? widget.min) : widget.min
  const span = widget.max - widget.min
  const restFraction = span !== 0 ? Math.min(1, Math.max(0, (restValue - widget.min) / span)) : 0
  const fraction = dragFraction ?? restFraction

  const resolvedFill = resolveColor(widget.fill, variables)
  const fillColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)

  // Box border/radius only make sense for the 'slider' style — a knob has no
  // rectangular box to round or border, same reasoning as GaugeWidgetContent.
  const outerStyle: React.CSSProperties = {
    ...(widget.style === 'slider' && {
      borderRadius: `${widget.radiusTopLeft ?? 8}px ${widget.radiusTopRight ?? 8}px ${widget.radiusBottomRight ?? 8}px ${widget.radiusBottomLeft ?? 8}px`,
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
    <div
      className={`deck-adjuster${interactive ? '' : ' deck-adjuster--static'}`}
      style={outerStyle}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
    >
      {widget.style === 'knob' ? (
        <AdjusterKnob fraction={fraction} fillColor={fillColor} trackColor={trackColor} startAngle={widget.startAngle ?? DEFAULT_START_ANGLE} endAngle={widget.endAngle ?? DEFAULT_END_ANGLE} />
      ) : (
        <AdjusterBar fraction={fraction} fillColor={fillColor} trackColor={trackColor} orientation={widget.orientation ?? 'vertical'} />
      )}
      {renderWidgetLabels(widget.labels, trackColor, variables)}
    </div>
  )
}
