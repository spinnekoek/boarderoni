import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { AdjusterKnobWidget, AdjusterSliderWidget } from '@shared/types'

type AdjusterWidget = AdjusterSliderWidget | AdjusterKnobWidget
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'
import { describeArc } from './arcPath'
import { renderTickSet } from './tickSet'
import { DialShapeGraphic, SquareIndicatorOverlay } from './DialShapeGraphic'

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405
const ARC_RADIUS = 42
const ARC_STROKE_WIDTH = 10

function AdjusterBar({
  fraction,
  fillColor,
  trackColor,
  orientation,
  widget
}: {
  fraction: number
  fillColor: string
  trackColor: string
  orientation: 'horizontal' | 'vertical'
  widget: AdjusterSliderWidget
}): React.JSX.Element {
  const fillStyle: React.CSSProperties =
    orientation === 'vertical'
      ? { position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fraction * 100}%`, backgroundColor: fillColor }
      : { position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fraction * 100}%`, backgroundColor: fillColor }
  const handleStyle: React.CSSProperties =
    orientation === 'vertical'
      ? { position: 'absolute', left: '50%', bottom: `${fraction * 100}%`, transform: 'translate(-50%, 50%)' }
      : { position: 'absolute', top: '50%', left: `${fraction * 100}%`, transform: 'translate(-50%, -50%)' }

  const handleShape = widget.handleShape ?? 'circle'
  const handleSize = widget.handleSize ?? 14
  // Independent width/height only apply to a square handle — a circle is
  // defined by one diameter (handleSize) and has no corners for handleRadius
  // to round.
  const handleWidth = handleShape === 'square' ? (widget.handleWidth ?? handleSize) : handleSize
  const handleHeight = handleShape === 'square' ? (widget.handleHeight ?? handleSize) : handleSize
  const handleColor = withOpacity(widget.handleColor ?? fillColor, widget.handleOpacity ?? 1)
  const handleBorderWidth = widget.handleBorderWidth ?? 0
  const handleBorderColor = withOpacity(widget.handleBorderColor ?? 'transparent', widget.handleBorderOpacity ?? 1)

  return (
    <>
      <div className="deck-adjuster__track" style={{ backgroundColor: trackColor }}>
        <div style={fillStyle} />
      </div>
      {handleShape !== 'none' && (
        <div
          className="deck-adjuster__handle"
          style={{
            ...handleStyle,
            width: handleWidth,
            height: handleHeight,
            borderRadius: handleShape === 'circle' ? '50%' : (widget.handleRadius ?? 0),
            backgroundColor: handleColor,
            borderStyle: handleBorderWidth > 0 ? 'solid' : undefined,
            borderWidth: handleBorderWidth > 0 ? handleBorderWidth : undefined,
            borderColor: handleBorderWidth > 0 ? handleBorderColor : undefined
          }}
        />
      )}
    </>
  )
}

// The knob's handle indicator is drawn via the same DialShapeGraphic every
// other dial widget (EncoderWidget, DialSwitchWidget) uses, in the same
// 0-100 viewBox coordinate space as the arc paths (rather than a
// separately-positioned HTML element) — that's what keeps it pixel-aligned
// with the arc under the SVG's own aspect-ratio letterboxing when the
// widget's box isn't square, which a percentage-positioned sibling div
// couldn't guarantee. Ticks (widget.tickSets) reuse the exact same
// renderTickSet GaugeWidget's arc style does — this knob has the same
// bounded startAngle..endAngle/min..max shape an arc gauge does, just without
// its own per-render viewBox (see renderTickSet's own comment for why
// center/viewBoxRect differ between the two callers).
function AdjusterKnob({
  widget,
  fraction,
  fillColor,
  trackColor,
  trackBaseColor,
  borderColor,
  variables,
  debugMode
}: {
  widget: AdjusterKnobWidget
  fraction: number
  fillColor: string
  trackColor: string
  // The raw, pre-opacity `track.color` (or DEFAULT_WIDGET_COLOR) — what
  // bezelColor/innerBezelColor fall back to when unset, same "resolve a
  // fresh hex through withOpacity with THIS field's own opacity, not the
  // already-composited trackColor string" convention ToggleSwitchWidget's
  // own innerBezelColor follows (see its own resolvedTrack.color fallback).
  trackBaseColor: string
  borderColor: string
  variables: VariableMap
  debugMode: boolean
}): React.JSX.Element {
  const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
  const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
  const handleAngle = startAngle + fraction * (endAngle - startAngle)
  const shapeColor = (widget.dialShape ?? 'needle') === 'square' ? (widget.squareColor ?? fillColor) : (widget.circleColor ?? fillColor)
  const bezelRadius = widget.bezelRadius ?? ARC_RADIUS - ARC_STROKE_WIDTH
  const bezelColor = withOpacity(widget.bezelColor ?? trackBaseColor, widget.bezelOpacity ?? 1)
  const bezelBorderWidth = widget.bezelBorderWidth ?? 0
  const innerBezelColor = withOpacity(widget.innerBezelColor ?? trackBaseColor, widget.innerBezelOpacity ?? 1)
  const innerBezelRadius = widget.innerBezelRadius ?? 0
  const innerBezelBorderWidth = widget.innerBezelBorderWidth ?? 0
  const innerBezelBorderColor = withOpacity(widget.innerBezelBorderColor ?? 'transparent', 1)

  const tickSets = widget.tickSets ?? []
  const tickResults = tickSets.map((tickSet) => ({
    id: tickSet.id,
    ...renderTickSet({
      tickSet,
      startAngle,
      endAngle,
      min: widget.min,
      max: widget.max,
      arcRadius: ARC_RADIUS,
      center: { x: 50, y: 50 },
      viewBoxRect: { x: 0, y: 0, width: 100, height: 100 },
      w: widget.w,
      h: widget.h,
      trackColor,
      variables,
      debugMode
    })
  }))

  return (
    <>
      {tickResults.map((r) => (
        <div key={r.id}>{r.labels}</div>
      ))}
      <svg className="deck-gauge__arc" viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={bezelRadius} fill={bezelColor} stroke={borderColor} strokeWidth={bezelBorderWidth} />
        {innerBezelRadius > 0 && (
          <circle
            cx={50}
            cy={50}
            r={innerBezelRadius}
            fill={innerBezelColor}
            stroke={innerBezelBorderWidth > 0 ? innerBezelBorderColor : undefined}
            strokeWidth={innerBezelBorderWidth > 0 ? innerBezelBorderWidth : undefined}
          />
        )}
        <path d={describeArc(50, 50, ARC_RADIUS, startAngle, endAngle)} stroke={trackColor} strokeWidth={ARC_STROKE_WIDTH} fill="none" strokeLinecap="round" />
        <path d={describeArc(50, 50, ARC_RADIUS, startAngle, handleAngle)} stroke={fillColor} strokeWidth={ARC_STROKE_WIDTH} fill="none" strokeLinecap="round" />
        {tickResults.map((r) => (
          <g key={r.id}>{r.marks}</g>
        ))}
        <DialShapeGraphic
          style={widget}
          angle={handleAngle}
          fillColor={fillColor}
          trackColor={trackColor}
          needleLength={ARC_RADIUS}
          needleHalfWidth={3}
          needleTipLength={12}
          needleCenterRadius={5}
        />
      </svg>
      <SquareIndicatorOverlay style={widget} angle={handleAngle} shapeColor={shapeColor} w={widget.w} h={widget.h} />
    </>
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
  onPointerUp,
  applyRotation = true
}: {
  widget: AdjusterWidget
  variables: VariableMap
  interactive: boolean
  dragFraction?: number
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  // See ButtonWidgetContent's identical prop for why — CanvasWidget.tsx
  // rotates the outer selection/resize wrapper itself and passes false here
  // to avoid rotating twice.
  applyRotation?: boolean
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
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
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle

  // Box border/radius only make sense for AdjusterSliderWidget — a knob has
  // no rectangular box to round or border, same reasoning as
  // BarGaugeWidgetContent/ArcGaugeWidgetContent's own split.
  const outerStyle: React.CSSProperties = {
    ...(widget.type === 'adjuster-slider' && {
      borderRadius: `${widget.radiusTopLeft ?? 8}px ${widget.radiusTopRight ?? 8}px ${widget.radiusBottomRight ?? 8}px ${widget.radiusBottomLeft ?? 8}px`,
      borderStyle: 'solid',
      borderTopWidth: widget.borderWidthTop ?? 1,
      borderRightWidth: widget.borderWidthRight ?? 1,
      borderBottomWidth: widget.borderWidthBottom ?? 1,
      borderLeftWidth: widget.borderWidthLeft ?? 1,
      borderColor
    }),
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex }),
    transform: applyRotation && rotateAngle ? `rotate(${rotateAngle}deg)` : undefined
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
      {widget.type === 'adjuster-knob' ? (
        <AdjusterKnob
          widget={widget}
          fraction={fraction}
          fillColor={fillColor}
          trackColor={trackColor}
          trackBaseColor={resolvedTrack.color ?? DEFAULT_WIDGET_COLOR}
          borderColor={borderColor}
          variables={variables}
          debugMode={debugMode}
        />
      ) : (
        <AdjusterBar
          fraction={fraction}
          fillColor={fillColor}
          trackColor={trackColor}
          orientation={widget.orientation ?? 'vertical'}
          widget={widget}
        />
      )}
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
    </div>
  )
}
