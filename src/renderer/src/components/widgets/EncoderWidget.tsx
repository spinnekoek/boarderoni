import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { EncoderTickSet, EncoderWidget } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'
import { polarToCartesian } from './arcPath'
import { DialShapeGraphic, SquareIndicatorOverlay } from './DialShapeGraphic'

// The grip's needle length/tip when dialShape is left unset (the default,
// preserving this widget's original look byte-for-byte) — see
// DialShapeGraphic's own needleLength/needleHalfWidth/needleTipLength props.
// DialSwitchWidget uses its own, shorter set (30/2/10) for the same reason.
const GRIP_RADIUS = 34
// Matches the dial face <circle r={...}> below — EncoderTickSet.distance's
// own default (just outside it) is expressed relative to this, same
// convention as GaugeWidget's own arcRadius + 4 default for its ticks.
const DIAL_RADIUS = 45
const DEFAULT_TICK_COUNT = 12
const DEFAULT_TICK_COLOR = '#ffffff'

// One EncoderTickSet's own marks, evenly spaced around the full 360° dial —
// see that type's own comment in shared/types.ts for why this is a trimmed
// sibling of GaugeWidget's gaugeTicks (marks only, no labels, no bounded
// sweep to distribute across). Same rendering approach as gaugeTicks' own
// marks: a small rect at each tick's own radial position, rotated to point
// outward from center.
function encoderTicks(tickSet: EncoderTickSet): React.ReactNode[] {
  const count = Math.max(1, Math.round(tickSet.count ?? DEFAULT_TICK_COUNT))
  const color = withOpacity(tickSet.color ?? DEFAULT_TICK_COLOR, tickSet.opacity ?? 1)
  const size = tickSet.size ?? 6
  const thickness = tickSet.thickness ?? 2
  const distance = tickSet.distance ?? DIAL_RADIUS + 4
  const marks: React.ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 360
    const midR = distance + size / 2
    const point = polarToCartesian(50, 50, midR, angle)
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
  }
  return marks
}

// Shared between the editor preview (CanvasWidget, interactive=false, no
// pointer props, dragSpinDegrees always undefined) and the deployed view
// client (ViewCanvas, interactive=true, pointer props wired to
// useEncoderDrag's handlers). dragSpinDegrees — supplied by the drag hook
// while dragging (and briefly after, until the server catches up, same
// convention as AdjusterWidget's dragFraction) — overrides the resolved rest
// angle so the grip tracks the pointer immediately. At rest, the grip sits at
// widget.valueExpr's resolved angle (0 if unset/unresolved) — same mechanism
// as AdjusterWidget's own valueExpr, just in degrees instead of a min..max
// value, since this widget has no fixed range.
export function EncoderWidgetContent({
  widget,
  variables,
  interactive,
  dragSpinDegrees,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  widget: EncoderWidget
  variables: VariableMap
  interactive: boolean
  dragSpinDegrees?: number
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const restSpin = widget.valueExpr ? (resolveNumericExpr(widget.valueExpr, variables) ?? 0) : 0
  const spin = dragSpinDegrees ?? restSpin

  const resolvedFill = resolveColor(widget.fill, variables)
  const fillColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  // Passed to SquareIndicatorOverlay below — see its own doc comment (in
  // DialShapeGraphic.tsx) for why a 'square' indicator renders as an HTML
  // div instead of joining DialShapeGraphic's own SVG output.
  const shapeColor = (widget.dialShape ?? 'needle') === 'square' ? (widget.squareColor ?? fillColor) : (widget.circleColor ?? fillColor)

  return (
    <div
      className={`deck-encoder${interactive ? '' : ' deck-encoder--static'}`}
      style={widget.zIndex !== undefined ? { zIndex: widget.zIndex } : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
    >
      <svg className="deck-encoder__dial" viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={DIAL_RADIUS} fill={trackColor} stroke={borderColor} strokeWidth={2} />
        {/* Painted before the grip/needle below, same order GaugeArc uses for
            its own tick marks — so the grip visually sweeps over them, like
            a real knob's pointer covering the ticks it passes. */}
        {(widget.tickSets ?? []).map((tickSet) => (
          <g key={tickSet.id}>{encoderTicks(tickSet)}</g>
        ))}
        <DialShapeGraphic
          style={widget}
          angle={spin}
          fillColor={fillColor}
          trackColor={trackColor}
          needleLength={GRIP_RADIUS}
          needleHalfWidth={3}
          needleTipLength={12}
          needleCenterRadius={5}
        />
      </svg>
      <SquareIndicatorOverlay style={widget} angle={spin} shapeColor={shapeColor} w={widget.w} h={widget.h} />
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
    </div>
  )
}
