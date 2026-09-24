import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBooleanExpr, resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { BarGaugeWidget, ArcGaugeWidget } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'
import { arcBoundsUnit, describeArc, needlePoints, polarToCartesian } from './arcPath'
import { renderTickSet } from './tickSet'

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405
const ARC_RADIUS = 42
const ARC_STROKE_WIDTH = 10
// Arc style's own defaults, distinct from DEFAULT_WIDGET_COLOR — a plain
// medium gray track (vs. the app's dark widget default) and the same blue
// already used everywhere else as the default fill/accent color (see
// handleAddGauge in Palette.tsx), so a fresh arc gauge's needle reads
// clearly against its gray track without the user having to pick a color
// first.
export const ARC_DEFAULT_TRACK_COLOR = '#5c5c5c'
export const ARC_DEFAULT_INDICATOR_COLOR = '#5b8def'
export const ARC_DEFAULT_TICK_COLOR = '#ffffff'

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
  widget: ArcGaugeWidget
  fraction: number
  fillColor: string
  trackColor: string
  variables: VariableMap
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
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
    ...renderTickSet({
      tickSet,
      startAngle,
      endAngle,
      min: widget.min,
      max: widget.max,
      arcRadius: ARC_RADIUS,
      center: { x: 0, y: 0 },
      viewBoxRect,
      w: widget.w,
      h: widget.h,
      trackColor,
      variables,
      debugMode
    })
  }))

  const exprShowIndicator = widget.showIndicatorExpr ? resolveBooleanExpr(widget.showIndicatorExpr, variables) : undefined
  const showIndicator = exprShowIndicator ?? widget.showIndicator ?? false

  const indicatorAngle = startAngle + fraction * (endAngle - startAngle)
  // Deliberately not falling back to fillColor/trackColor — the needle is
  // its own independent color so restyling the arc's fill/track doesn't
  // also silently repaint it.
  const indicatorColor = withOpacity(widget.indicatorColor ?? ARC_DEFAULT_INDICATOR_COLOR, 1)
  const indicatorShape = widget.indicatorShape ?? 'needle'
  const indicatorStart = widget.indicatorStartDistance ?? 0
  const indicatorEnd = widget.indicatorEndDistance ?? ARC_RADIUS * 0.7
  const indicatorSpan = Math.max(0, indicatorEnd - indicatorStart)
  const indicatorHalfWidth = widget.indicatorWidth ?? 2
  const indicatorCenterSize = widget.indicatorCenterSize ?? 4
  const indicatorCenterColor = withOpacity(widget.indicatorCenterColor ?? widget.indicatorColor ?? ARC_DEFAULT_INDICATOR_COLOR, 1)
  const indicatorCenterBorderColor = widget.indicatorCenterBorderColor ?? 'transparent'
  const indicatorCenterBorderWidth = widget.indicatorCenterBorderWidth ?? 0
  // The needle's own drawn origin — indicatorStartDistance out from the true
  // center, along the active angle — NOT necessarily the true center itself
  // (see indicatorStartDistance's own doc comment in shared/types.ts). The
  // hub circle below always draws at the true center regardless.
  const needleOrigin = polarToCartesian(0, 0, indicatorStart, indicatorAngle)

  return (
    <>
      {/* Tick labels painted BEFORE the arc's own SVG (needle included) below
          — rendered as plain absolutely-positioned divs rather than inside
          that SVG (see this function's own leading comment for why), so
          without this ordering they'd sit on top of the needle wherever the
          two overlap instead of the needle sweeping over them, the way a
          real gauge's pointer physically covers the tick marks/numbers
          beneath it. Passive widget (GaugeWidgetContent has no pointer
          handlers at all — see its own comment below), so this is purely a
          paint-order change. */}
      {tickResults.map((r) => (
        <div key={r.id}>{r.labels}</div>
      ))}
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
        {showIndicator && (
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
    </>
  )
}

// Passive — no pointer handlers, no `events` field at all (see EventfulWidget
// in shared/types.ts, which deliberately excludes both gauge types). Shared
// as-is between the editor preview (CanvasWidget) and the client
// (ClientCanvas).
export function BarGaugeWidgetContent({ widget, variables }: { widget: BarGaugeWidget; variables: VariableMap }): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const raw = resolveNumericExpr(widget.valueExpr, variables) ?? widget.min
  const span = widget.max - widget.min
  const fraction = span !== 0 ? Math.min(1, Math.max(0, (raw - widget.min) / span)) : 0

  const resolvedFill = resolveColor(widget.fill, variables)
  const fillColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)

  // Skips withOpacity entirely when unset rather than resolving a literal
  // 'transparent' through it — same reasoning as WidgetLabel.backgroundColor
  // in labels.tsx.
  const backgroundColor = widget.backgroundColor ? withOpacity(widget.backgroundColor, widget.backgroundOpacity ?? 1) : 'transparent'

  const outerStyle: React.CSSProperties = {
    backgroundColor,
    borderRadius: `${widget.radiusTopLeft ?? 4}px ${widget.radiusTopRight ?? 4}px ${widget.radiusBottomRight ?? 4}px ${widget.radiusBottomLeft ?? 4}px`,
    borderStyle: 'solid',
    borderTopWidth: widget.borderWidthTop ?? 1,
    borderRightWidth: widget.borderWidthRight ?? 1,
    borderBottomWidth: widget.borderWidthBottom ?? 1,
    borderLeftWidth: widget.borderWidthLeft ?? 1,
    borderColor,
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
  }

  return (
    <div className="deck-gauge" style={outerStyle}>
      <GaugeBar fraction={fraction} fillColor={fillColor} trackColor={trackColor} orientation={widget.orientation ?? 'horizontal'} />
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
    </div>
  )
}

export function ArcGaugeWidgetContent({ widget, variables }: { widget: ArcGaugeWidget; variables: VariableMap }): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const raw = resolveNumericExpr(widget.valueExpr, variables) ?? widget.min
  const span = widget.max - widget.min
  const fraction = span !== 0 ? Math.min(1, Math.max(0, (raw - widget.min) / span)) : 0

  const resolvedFill = resolveColor(widget.fill, variables)
  const fillColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedTrack = resolveColor(widget.track, variables)
  // Its own default track color (medium gray, ARC_DEFAULT_TRACK_COLOR)
  // rather than the app-wide DEFAULT_WIDGET_COLOR (dark) every other
  // widget's track falls back to — a bare unset track is far more common
  // here (there's no box behind it to blend with) than on a bar gauge,
  // where the dark default already reads fine against the dashboard
  // background.
  const trackColor = withOpacity(resolvedTrack.color ?? ARC_DEFAULT_TRACK_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)

  // Skips withOpacity entirely when unset rather than resolving a literal
  // 'transparent' through it — same reasoning as WidgetLabel.backgroundColor
  // in labels.tsx.
  const backgroundColor = widget.backgroundColor ? withOpacity(widget.backgroundColor, widget.backgroundOpacity ?? 1) : 'transparent'

  const outerStyle: React.CSSProperties = {
    backgroundColor,
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
  }

  return (
    <div className="deck-gauge deck-gauge--arc" style={outerStyle}>
      <GaugeArc widget={widget} fraction={fraction} fillColor={fillColor} trackColor={trackColor} variables={variables} />
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
    </div>
  )
}
