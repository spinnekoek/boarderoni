import { withOpacity } from '@shared/color'
import type { VariableMap } from '@shared/expr'
import type { GaugeTickSet } from '@shared/types'
import { polarToCartesian, viewBoxRectToPixel } from './arcPath'
import { renderWidgetLabel } from './labels'

// One ring of evenly-spaced tick marks (each optionally labeled with its own
// auto-computed value) across a bounded startAngle..endAngle sweep mapped to
// a min..max value range — shared by GaugeWidget's arc style and
// AdjusterWidget's knob style, the app's only two widgets with that shape of
// bounded range. `center`/`viewBoxRect` are the one thing that differs
// between them: GaugeWidget's arc recomputes its own per-render viewBox (see
// arcBoundsUnit in arcPath.ts) with true center at (0,0), so a partial sweep
// fills the widget instead of sitting tiny in a viewBox sized for the full
// circle it's a slice of; AdjusterWidget's knob uses the plain, fixed
// `viewBox="0 0 100 100"` every other ring/dial widget does, center (50,50)
// — see viewBoxToPixel's own comment. Passing both in as params (rather than
// hardcoding either) is what lets this one function serve both without
// re-deriving the tick distribution math twice.
export function renderTickSet({
  tickSet,
  startAngle,
  endAngle,
  min,
  max,
  arcRadius,
  center,
  viewBoxRect,
  w,
  h,
  trackColor,
  variables,
  debugMode
}: {
  tickSet: GaugeTickSet
  startAngle: number
  endAngle: number
  min: number
  max: number
  arcRadius: number
  center: { x: number; y: number }
  viewBoxRect: { x: number; y: number; width: number; height: number }
  w: number
  h: number
  trackColor: string
  variables: VariableMap
  debugMode: boolean
}): { marks: React.ReactNode[]; labels: React.ReactNode[] } {
  const count = Math.max(2, tickSet.count ?? 5)
  const color = withOpacity(tickSet.color ?? '#ffffff', tickSet.opacity ?? 1)
  const size = tickSet.size ?? 6
  const thickness = tickSet.thickness ?? 2
  const distance = tickSet.distance ?? arcRadius + 4
  // See GaugeTickSet.labelMin/labelMax's own comment — this tick set's own
  // range for the auto-computed label value below ONLY; `t`/`angle` (a
  // tick's actual position) stay driven by the widget's real min/max
  // regardless, since they still have to land where the widget's own
  // fill/needle would for that value.
  const labelMin = tickSet.labelMin ?? min
  const labelMax = tickSet.labelMax ?? max
  const marks: React.ReactNode[] = []
  const labels: React.ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const angle = startAngle + t * (endAngle - startAngle)
    const value = labelMin + t * (labelMax - labelMin)
    const midR = distance + size / 2
    const point = polarToCartesian(center.x, center.y, midR, angle)
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
      const labelPoint = polarToCartesian(center.x, center.y, distance + size + (tickSet.labelDistance ?? 6), angle)
      const pixel = viewBoxRectToPixel(labelPoint.x, labelPoint.y, viewBoxRect, w, h)
      // $value/$index only need adding to the variables map actually handed
      // to this tick's own label — merging them in unconditionally would
      // work identically (textExpr is undefined otherwise, so they'd just
      // go unused), but skipping it when there's no expression to read them
      // avoids a wasted object spread on every tick of every tick set that
      // isn't using this.
      const tickVariables = tickSet.labelTextExpr !== undefined ? { ...variables, $value: value, $index: i } : variables
      labels.push(
        <div key={i} className="deck-gauge__tick-label" style={{ left: pixel.x, top: pixel.y }}>
          {renderWidgetLabel(
            {
              id: `${tickSet.id}-${i}`,
              text: value.toFixed(tickSet.labelDecimals ?? 0),
              textExpr: tickSet.labelTextExpr,
              textColor: tickSet.labelColor,
              fontFamily: tickSet.labelFontFamily,
              fontSize: tickSet.labelFontSize,
              align: 'center',
              verticalAlign: 'center'
            },
            trackColor,
            tickVariables,
            debugMode
          )}
        </div>
      )
    }
  }
  return { marks, labels }
}
