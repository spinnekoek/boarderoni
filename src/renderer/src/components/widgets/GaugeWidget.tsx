import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { GaugeTickSet, GaugeWidget } from '@shared/types'
import { renderWidgetLabel, renderWidgetLabels } from './labels'
import { arcBoundsUnit, describeArc, needlePoints, polarToCartesian, viewBoxRectToPixel } from './arcPath'

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

// One tick set's own marks (SVG <rect>s, joining the arc's own <svg>) plus
// its labels (plain HTML overlays, positioned via viewBoxRectToPixel against
// that same <svg>'s dynamic viewBox) — same two-rendering-systems split
// every other ring/dial widget's labels already use. Each mark is an
// unrotated rect (top edge pointing "up", i.e. away from center) then
// rotated to its own angle, exactly the same construction DialShapeGraphic's
// 'tick' detent shape uses, so a gauge's ticks read as the same visual
// vocabulary. `count` is clamped to at least 2 so a single-tick set can't
// divide by zero placing it (both ends always get a tick; anything beyond 2
// fills in evenly between them).
function gaugeTicks({
  tickSet,
  startAngle,
  endAngle,
  min,
  max,
  arcRadius,
  w,
  h,
  viewBoxRect,
  trackColor,
  variables
}: {
  tickSet: GaugeTickSet
  startAngle: number
  endAngle: number
  min: number
  max: number
  arcRadius: number
  w: number
  h: number
  viewBoxRect: { x: number; y: number; width: number; height: number }
  trackColor: string
  variables: VariableMap
}): { marks: React.ReactNode[]; labels: React.ReactNode[] } {
  const count = Math.max(2, tickSet.count ?? 5)
  const color = withOpacity(tickSet.color ?? DEFAULT_WIDGET_COLOR, tickSet.opacity ?? 1)
  const size = tickSet.size ?? 6
  const thickness = tickSet.thickness ?? 2
  const distance = tickSet.distance ?? arcRadius + 4
  const marks: React.ReactNode[] = []
  const labels: React.ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const angle = startAngle + t * (endAngle - startAngle)
    const value = min + t * (max - min)
    const midR = distance + size / 2
    const point = polarToCartesian(0, 0, midR, angle)
    marks.push(
      <rect
        key={i}
        x={point.x - thickness / 2}
        y={point.y - size / 2}
        width={thickness}
        height={size}
        fill={color}
        stroke={tickSet.borderColor}
        strokeWidth={tickSet.borderWidth ?? 0}
        transform={`rotate(${angle} ${point.x} ${point.y})`}
      />
    )
    if (tickSet.showLabels) {
      const labelPoint = polarToCartesian(0, 0, distance + size + (tickSet.labelDistance ?? 6), angle)
      const pixel = viewBoxRectToPixel(labelPoint.x, labelPoint.y, viewBoxRect, w, h)
      labels.push(
        <div key={i} className="deck-gauge__tick-label" style={{ left: pixel.x, top: pixel.y }}>
          {renderWidgetLabel(
            {
              id: `${tickSet.id}-${i}`,
              text: value.toFixed(tickSet.labelDecimals ?? 0),
              textColor: tickSet.labelColor,
              fontSize: tickSet.labelFontSize,
              align: 'center',
              verticalAlign: 'center'
            },
            trackColor,
            variables
          )}
        </div>
      )
    }
  }
  return { marks, labels }
}

// Arc style's own SVG + tick label overlays. Unlike every other ring/dial
// widget (always `viewBox="0 0 100 100"`, see viewBoxToPixel in arcPath.ts),
// this one computes its viewBox per-render from the actual swept arc's own
// bounding box (arcBoundsUnit) — a partial sweep (e.g. a single quarter)
// then fills the whole widget instead of sitting tiny inside a viewBox sized
// for the full circle it's a slice of, and the true center (0,0) lands
// wherever that bounding box puts it, which is naturally the corner
// opposite the missing sweep. Tick marks/labels are positioned relative to
// that same true center/radius but deliberately excluded from the bounding-
// box math itself (only the bare arc stroke's own margin is included) — see
// GaugeWidget.tickSets's own comment — so they can extend past the widget's
// edges rather than shrinking the arc to make room for them; `.deck-gauge__
// arc`/`.deck-gauge--arc` (styles.css) leave overflow visible so that
// overflow actually shows instead of clipping.
function GaugeArc({
  widget,
  fraction,
  fillColor,
  trackColor,
  variables
}: {
  widget: GaugeWidget
  fraction: number
  fillColor: string
  trackColor: string
  variables: VariableMap
}): React.JSX.Element {
  const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
  const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
  const bounds = arcBoundsUnit(startAngle, endAngle)
  const margin = ARC_STROKE_WIDTH / 2
  const minX = bounds.minX * ARC_RADIUS - margin
  const maxX = bounds.maxX * ARC_RADIUS + margin
  const minY = bounds.minY * ARC_RADIUS - margin
  const maxY = bounds.maxY * ARC_RADIUS + margin
  const viewBoxRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

  const tickSets = widget.tickSets ?? []
  const tickResults = tickSets.map((tickSet) => ({
    id: tickSet.id,
    ...gaugeTicks({
      tickSet,
      startAngle,
      endAngle,
      min: widget.min,
      max: widget.max,
      arcRadius: ARC_RADIUS,
      w: widget.w,
      h: widget.h,
      viewBoxRect,
      trackColor,
      variables
    })
  }))

  const indicatorAngle = startAngle + fraction * (endAngle - startAngle)
  // Deliberately not falling back to fillColor/trackColor — the needle is
  // its own independent color so restyling the arc's fill/track doesn't
  // also silently repaint it.
  const indicatorColor = withOpacity(widget.indicatorColor ?? DEFAULT_WIDGET_COLOR, 1)
  const indicatorShape = widget.indicatorShape ?? 'needle'
  const indicatorStart = widget.indicatorStartDistance ?? 0
  const indicatorEnd = widget.indicatorEndDistance ?? ARC_RADIUS * 0.7
  const indicatorSpan = Math.max(0, indicatorEnd - indicatorStart)
  const indicatorHalfWidth = widget.indicatorWidth ?? 2
  const indicatorCenterSize = widget.indicatorCenterSize ?? 4
  const indicatorCenterColor = withOpacity(widget.indicatorCenterColor ?? widget.indicatorColor ?? DEFAULT_WIDGET_COLOR, 1)
  const indicatorCenterBorderColor = widget.indicatorCenterBorderColor ?? 'transparent'
  const indicatorCenterBorderWidth = widget.indicatorCenterBorderWidth ?? 0
  // The needle's own drawn origin — indicatorStartDistance out from the true
  // center, along the active angle — NOT necessarily the true center itself
  // (see indicatorStartDistance's own doc comment in shared/types.ts). The
  // hub circle below always draws at the true center regardless.
  const needleOrigin = polarToCartesian(0, 0, indicatorStart, indicatorAngle)

  return (
    <>
      <svg className="deck-gauge__arc" viewBox={`${viewBoxRect.x} ${viewBoxRect.y} ${viewBoxRect.width} ${viewBoxRect.height}`}>
        <path d={describeArc(0, 0, ARC_RADIUS, startAngle, endAngle)} stroke={trackColor} strokeWidth={ARC_STROKE_WIDTH} fill="none" strokeLinecap="round" />
        <path
          d={describeArc(0, 0, ARC_RADIUS, startAngle, startAngle + fraction * (endAngle - startAngle))}
          stroke={fillColor}
          strokeWidth={ARC_STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
        />
        {tickResults.map((r) => (
          <g key={r.id}>{r.marks}</g>
        ))}
        {widget.showIndicator && (
          <>
            {indicatorShape === 'needle' ? (
              <polygon
                points={needlePoints(
                  needleOrigin.x,
                  needleOrigin.y,
                  indicatorAngle,
                  indicatorSpan,
                  indicatorHalfWidth,
                  Math.min(indicatorSpan * 0.3, indicatorSpan)
                )}
                fill={indicatorColor}
              />
            ) : (
              <rect
                x={-indicatorHalfWidth}
                y={-indicatorEnd}
                width={indicatorHalfWidth * 2}
                height={indicatorSpan}
                fill={indicatorColor}
                transform={`rotate(${indicatorAngle} 0 0)`}
              />
            )}
            {indicatorCenterSize > 0 && (
              <circle
                cx={0}
                cy={0}
                r={indicatorCenterSize}
                fill={indicatorCenterColor}
                stroke={indicatorCenterBorderColor}
                strokeWidth={indicatorCenterBorderWidth}
              />
            )}
          </>
        )}
      </svg>
      {tickResults.map((r) => (
        <div key={r.id}>{r.labels}</div>
      ))}
    </>
  )
}

// Passive — no pointer handlers, no `events` field at all (see EventfulWidget
// in shared/types.ts, which deliberately excludes GaugeWidget). Shared as-is
// between the editor preview (CanvasWidget) and the deployed view client
// (ViewCanvas).
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
  // Skips withOpacity entirely when unset rather than resolving a literal
  // 'transparent' through it — same reasoning as WidgetLabel.backgroundColor
  // in labels.tsx.
  const backgroundColor = widget.backgroundColor ? withOpacity(widget.backgroundColor, widget.backgroundOpacity ?? 1) : 'transparent'

  const outerStyle: React.CSSProperties = {
    backgroundColor,
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
    <div className={`deck-gauge${widget.style === 'arc' ? ' deck-gauge--arc' : ''}`} style={outerStyle}>
      {widget.style === 'arc' ? (
        <GaugeArc widget={widget} fraction={fraction} fillColor={fillColor} trackColor={trackColor} variables={variables} />
      ) : (
        <GaugeBar fraction={fraction} fillColor={fillColor} trackColor={trackColor} orientation={widget.orientation ?? 'horizontal'} />
      )}
      {renderWidgetLabels(widget.labels, trackColor, variables)}
    </div>
  )
}
