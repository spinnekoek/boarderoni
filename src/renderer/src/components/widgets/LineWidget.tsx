import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import { resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { LineWidget } from '@shared/types'

export function LineWidgetContent({
  widget,
  variables,
  applyRotation = true
}: {
  widget: LineWidget
  variables: VariableMap
  // The editor (CanvasWidget.tsx) rotates its own outer selection/resize box
  // to match instead of leaving it axis-aligned around a visually rotated
  // line — badly mismatched for something this oblong (see its own comment)
  // — so it passes false here and applies the identical angle up there
  // itself, rather than this component rotating AGAIN inside an
  // already-rotated wrapper. The client (ClientCanvas.tsx) has no such
  // box to keep in sync, so it leaves this at the default.
  applyRotation?: boolean
}): React.JSX.Element {
  const resolved = resolveColor(widget, variables)
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle
  const thickness = Math.min(widget.lineWidth ?? widget.h, widget.h)
  return (
    <div
      className="deck-line"
      style={{
        left: 0,
        top: '50%',
        width: '100%',
        height: thickness,
        marginTop: -(thickness / 2),
        backgroundColor: resolved.color ?? DEFAULT_WIDGET_COLOR,
        opacity: resolved.opacity,
        // Rotates around the drawn bar's own center, which — since it's
        // centered within h and spans the full w — coincides with the
        // widget's own box center, same pivot every other rotated widget
        // uses.
        transform: applyRotation && rotateAngle ? `rotate(${rotateAngle}deg)` : undefined,
        ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
      }}
    />
  )
}
