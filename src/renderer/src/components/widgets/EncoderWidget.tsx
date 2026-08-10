import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { EncoderWidget } from '@shared/types'
import { renderWidgetLabels } from './labels'
import { needlePoints } from './arcPath'

const GRIP_RADIUS = 34

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
  const restSpin = widget.valueExpr ? (resolveNumericExpr(widget.valueExpr, variables) ?? 0) : 0
  const spin = dragSpinDegrees ?? restSpin

  const resolvedFill = resolveColor(widget.fill, variables)
  const fillColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)

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
        <circle cx={50} cy={50} r={45} fill={trackColor} stroke={borderColor} strokeWidth={2} />
        <polygon points={needlePoints(50, 50, spin, GRIP_RADIUS, 3, 12)} fill={fillColor} />
        <circle cx={50} cy={50} r={5} fill={fillColor} />
      </svg>
      {renderWidgetLabels(widget.labels, trackColor, variables)}
    </div>
  )
}
