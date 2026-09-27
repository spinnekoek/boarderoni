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
  const thickness = widget.lineWidth ?? widget.h
  const capStyle = widget.capStyle ?? 'butt'
  const fillColor = resolved.color ?? DEFAULT_WIDGET_COLOR
  // Centered via a rounded plain-pixel top, not `top: '50%'` + a
  // `marginTop` of -(thickness/2) — that halves-a-pixel offset is
  // fractional for any odd thickness (1px, the most common hairline
  // value, gives -0.5px), which is invisible on its own (a vertically
  // sub-pixel line just blurs slightly) but turns into a HORIZONTAL
  // sub-pixel drift once rotateAngle rotates the bar 90° to draw a
  // vertical tick — exactly the "two 1px marks off by half a pixel"
  // symptom this replaced. Rounding here keeps the pre-rotation offset a
  // whole number, so a 90°/180°/270° rotation (an exact integer
  // coordinate mapping) can't reintroduce a fraction on the other axis.
  const centerOffset = Math.round((widget.h - thickness) / 2)
  const commonStyle: React.CSSProperties = {
    top: centerOffset,
    opacity: resolved.opacity,
    // Rotates around the drawn bar's own center, which — since it's
    // centered within h and spans the full w — coincides with the widget's
    // own box center, same pivot every other rotated widget uses.
    transform: applyRotation && rotateAngle ? `rotate(${rotateAngle}deg)` : undefined,
    ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
  }

  if (capStyle === 'angled') {
    // tan() blows up approaching ±90° (the cut would run parallel to the
    // bar, drawing nothing) — clamped well short of that rather than
    // letting a stray large value flip the polygon inside-out.
    const capAngleStart = Math.min(80, Math.max(-80, widget.capAngleStart ?? 45))
    const capAngleEnd = Math.min(80, Math.max(-80, widget.capAngleEnd ?? 45))
    // The cut runs the bar's FULL thickness (one corner anchored at the
    // bottom edge, the other free at the top — see the polygon points
    // below), so the horizontal run for a given angle-from-perpendicular is
    // thickness * tan(angle), not thickness/2 * tan(angle) (that halved
    // factor was left over from an earlier symmetric-about-midline design
    // this one replaced, and made every angle render at roughly half its
    // configured value — 45° drew more like 27°).
    const startOffset = thickness * Math.tan((capAngleStart * Math.PI) / 180)
    const endOffset = thickness * Math.tan((capAngleEnd * Math.PI) / 180)
    // Both top corners shift by their OWN end's offset in the SAME
    // direction (added, not mirrored) — the bottom edge stays fixed at
    // 0..w. That's what makes equal start/end angles shear into a true
    // parallelogram (both cuts parallel, like a candy-stripe/chevron
    // divider) instead of a symmetric trapezoid (which is what mirroring
    // the two corners toward each other would draw instead). A plain CSS
    // clip-path can't draw a corner past the underlying rectangle's own
    // 0..w bound — it just clips at the edge itself, no paintable area sits
    // beyond it to reveal — so an SVG polygon is used instead: its own
    // viewBox/left/width are grown here by however far a corner needs to
    // extend past 0 or w, so the polygon draws exactly where the math says
    // regardless of sign.
    const leftExtra = Math.max(0, -startOffset)
    const rightExtra = Math.max(0, endOffset)
    const svgLeft = -leftExtra
    const svgWidth = widget.w + leftExtra + rightExtra
    const points = `${startOffset},0 ${widget.w + endOffset},0 ${widget.w},${thickness} 0,${thickness}`
    return (
      <svg
        className="deck-line"
        style={{
          left: svgLeft,
          width: svgWidth,
          height: thickness,
          // When capAngleStart/capAngleEnd differ (leftExtra !== rightExtra),
          // this box's own center is off-center from the widget's TRUE
          // center (its own box grew asymmetrically to fit the negative
          // offset — see the comment above). Left at the CSS default (50%
          // 50%, this element's own center), applyRotation's transform would
          // rotate around the wrong point whenever this component applies
          // rotation itself (the client — see LineWidgetContent's own
          // applyRotation comment; the editor's outer wrapper rotates
          // instead, around the correct point, which is why this only ever
          // showed up on the client). Pinned explicitly to the widget's true
          // center in this box's own local coordinates instead.
          transformOrigin: `${leftExtra + widget.w / 2}px 50%`,
          ...commonStyle
        }}
        viewBox={`${svgLeft} 0 ${svgWidth} ${thickness}`}
        preserveAspectRatio="none"
      >
        <polygon points={points} fill={fillColor} />
      </svg>
    )
  }

  return (
    <div
      className="deck-line"
      style={{
        left: 0,
        width: '100%',
        height: thickness,
        backgroundColor: fillColor,
        borderRadius: capStyle === 'round' ? thickness / 2 : undefined,
        ...commonStyle
      }}
    />
  )
}
