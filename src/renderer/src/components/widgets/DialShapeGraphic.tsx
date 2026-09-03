import type { DialShapeStyle } from '@shared/types'
import { withOpacity } from '@shared/color'
import { needlePoints, polarToCartesian, roundedPolygonPath, viewBoxToPixel } from './arcPath'

// Box size (viewBox units) for each detent/indicator shape — 'tick'/
// 'triangle' are deliberately non-square (a tick reads as a short radial
// bar, a triangle wants a bit more room than the circle/square's dot) — and
// get rotated to point radially outward (see the `angle` transform at the
// call site) since, unlike a circle/square, which way they're "facing" is
// visible. 'circle'/'square' aren't rotated — a square is axis-aligned on
// purpose, matching a physical panel's detent markings. Exported so
// PropertiesPanel can show the same per-shape defaults in its width/height
// fields instead of duplicating this table, and so DialSwitchWidget's own
// ring-detent rendering (which stays there — it's switch-specific, not
// shared with EncoderWidget) can use the same sizes as the dial-center
// indicator this file renders.
export const DETENT_DOT_RADIUS = 5
export const DETENT_SIZE: Record<NonNullable<DialShapeStyle['indicatorShape']>, { width: number; height: number }> = {
  circle: { width: DETENT_DOT_RADIUS * 2, height: DETENT_DOT_RADIUS * 2 },
  square: { width: DETENT_DOT_RADIUS * 2, height: DETENT_DOT_RADIUS * 2 },
  triangle: { width: DETENT_DOT_RADIUS * 2.4, height: DETENT_DOT_RADIUS * 2.4 },
  tick: { width: DETENT_DOT_RADIUS * 1.6, height: DETENT_DOT_RADIUS * 3.2 },
  // Never actually rendered at this size (see showIndicatorHere/
  // SquareIndicatorOverlay, both of which skip drawing entirely for
  // 'none') — present only so this Record stays total over every
  // indicatorShape value.
  none: { width: 0, height: 0 }
}

// Default corner radius per shape when a DetentStyle's borderRadius is
// unset — matches the fixed values the CSS classes used before border
// radius became configurable. Circle has no entry: its roundness comes from
// CSS border-radius: 50%, which a pixel value can't replicate, so it's left
// alone unless a radius is explicitly set.
export const DEFAULT_DETENT_BORDER_RADIUS: Partial<Record<NonNullable<DialShapeStyle['indicatorShape']>, number>> = {
  square: 2,
  tick: 1,
  triangle: 1
}

// Renders the dial-center indicator marker (square/circle dialShape only) —
// the same shape vocabulary as a DialSwitchWidget ring detent (see
// DETENT_SIZE above), just as a real SVG element (this lives inside the
// caller's <svg>, unlike a ring detent's plain-HTML div) so a 'triangle' can
// get a proper stroked, rounded shape instead of a border-less clip-path
// trick. `rotate`, when non-zero, spins the marker in place around its own
// center so a 'tick'/'triangle' marker points outward — the square
// dialShape's marker never needs this (it already sits in a group rotated
// to point outward), only the circle dialShape's (which isn't rotated, so
// the marker itself has to turn to face out).
export function DetentIndicatorShape({
  shape,
  cx,
  cy,
  width,
  height,
  borderRadius,
  rotate,
  fill,
  stroke,
  strokeWidth
}: {
  shape: NonNullable<DialShapeStyle['indicatorShape']>
  cx: number
  cy: number
  width: number
  height: number
  borderRadius: number
  rotate: number
  fill: string
  stroke: string
  strokeWidth: number
}): React.JSX.Element {
  const transform = rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined
  if (shape === 'circle') {
    return <ellipse cx={cx} cy={cy} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} transform={transform} />
  }
  if (shape === 'triangle') {
    const points = [
      { x: cx, y: cy - height / 2 },
      { x: cx - width / 2, y: cy + height / 2 },
      { x: cx + width / 2, y: cy + height / 2 }
    ]
    // Cheaper plain <polygon> for the common borderRadius=0 case; the
    // rounded-corner <path> only gets built when a radius is actually set.
    if (borderRadius > 0) {
      return <path d={roundedPolygonPath(points, borderRadius)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} transform={transform} />
    }
    return (
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        transform={transform}
      />
    )
  }
  // 'square' and 'tick' are both just a rect — a tick's narrower default
  // width/height (see DETENT_SIZE) is what makes it read as a tick.
  return (
    <rect
      x={cx - width / 2}
      y={cy - height / 2}
      width={width}
      height={height}
      rx={borderRadius}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      transform={transform}
    />
  )
}

// The dial-center indicator marker's fully-resolved position/size/color —
// shared by DialShapeGraphic's own rendering (every shape except 'square')
// AND by a caller's separate rendering of a 'square' indicator as a plain
// HTML div (see DialSwitchWidgetContent/EncoderWidgetContent — an SVG <rect>
// can't express independent per-side border width/radius the way CSS can,
// so 'square' is the one shape that renders outside this component). Both
// paths need the exact same point/size/color math, so it lives here once.
export interface ResolvedDialIndicator {
  shape: NonNullable<DialShapeStyle['indicatorShape']>
  // Absolute position in the shared 0-100 viewBox space (already includes
  // both dialDistance and indicatorDistance — see the angle/distance
  // comment on DialShapeGraphic's own `angle` prop).
  point: { x: number; y: number }
  width: number
  height: number
  color: string
  borderColor: string
  borderWidth: number
  borderRadius: number
}

export function resolveDialIndicator(style: DialShapeStyle, angle: number, shapeColor: string): ResolvedDialIndicator {
  const dialShape = style.dialShape ?? 'needle'
  const dialDistance = style.dialDistance ?? 0
  const squareHeight = style.squareHeight ?? 24
  const circleSize = style.circleSize ?? 20
  const indicatorDistance = style.indicatorDistance ?? (dialShape === 'square' ? squareHeight / 2 : circleSize / 2)
  const point = polarToCartesian(50, 50, dialDistance + indicatorDistance, angle)
  const shape = style.indicatorShape ?? 'circle'
  const baseSize = DETENT_SIZE[shape]
  return {
    shape,
    point,
    width: style.indicatorStyle?.width ?? baseSize.width,
    height: style.indicatorStyle?.height ?? baseSize.height,
    borderWidth: style.indicatorStyle?.borderWidth ?? 0,
    borderRadius: style.indicatorStyle?.borderRadius ?? DEFAULT_DETENT_BORDER_RADIUS[shape] ?? 0,
    // Defaults to the dial shape's own color, so an untouched indicator
    // reads as part of the shape rather than a separately-colored overlay.
    color: style.indicatorColor ?? shapeColor,
    borderColor: style.indicatorStyle?.borderColor ?? 'transparent'
  }
}

// Shared between DialSwitchWidget's own dial and EncoderWidget's grip — both
// widget types extend DialShapeStyle (see shared/types.ts) and pass their
// own resolved colors/needle sizing in, so this renders identically to how
// DialSwitchWidget always has, with EncoderWidget gaining the exact same
// square/circle/indicator options for free. Must be rendered as a direct
// child of the caller's own `<svg viewBox="0 0 100 100">` (the caller draws
// the dial face/track circle itself, before this).
export function DialShapeGraphic({
  style,
  angle,
  fillColor,
  trackColor,
  needleLength,
  needleHalfWidth,
  needleTipLength,
  needleCenterRadius
}: {
  style: DialShapeStyle
  // The active pointer angle — DialSwitchWidget's needleAngle (derived from
  // the active position) or EncoderWidget's spin (derived from valueExpr/
  // drag) — degrees, 0 up, clockwise, same convention as polarToCartesian.
  angle: number
  // Fallback color for the needle, and for the square/circle shape's own
  // color when squareColor/circleColor is unset — same "don't drop into an
  // invisible shape that happens to match the dial face" reasoning as
  // before this was configurable.
  fillColor: string
  // Fallback color for a circle indent when circleIndentColor is unset.
  trackColor: string
  needleLength: number
  needleHalfWidth: number
  needleTipLength: number
  needleCenterRadius: number
}): React.JSX.Element {
  const dialShape = style.dialShape ?? 'needle'
  // Nothing to draw at all — no shape, no indicator marker either (there's
  // no shape left for one to sit on/point from). Every branch below is
  // already a literal equality check against 'needle'/'square'/'circle' with
  // no wildcard fallback, so this early return is about intent/avoiding
  // wasted work, not correctness — none of them would fire for 'none'
  // anyway.
  if (dialShape === 'none') return <></>
  // Distance from the widget's true center to the shape's OWN center — see
  // DialShapeStyle.dialDistance. Deliberately no clamp: negative flips the
  // shape to the opposite side of center.
  const dialDistance = style.dialDistance ?? 0
  const squareWidth = style.squareWidth ?? 24
  const squareHeight = style.squareHeight ?? 24
  const squareBorderWidth = style.squareBorderWidth ?? 0
  const squareBorderRadius = style.squareBorderRadius ?? 2
  const squareColor = style.squareColor ?? fillColor
  const squareBorderColor = style.squareBorderColor ?? 'transparent'
  const circleSize = style.circleSize ?? 20
  const circleBorderWidth = style.circleBorderWidth ?? 0
  const circleColor = style.circleColor ?? fillColor
  const circleBorderColor = style.circleBorderColor ?? 'transparent'
  const circleIndentCount = style.circleIndentCount ?? 0
  const circleIndentSize = style.circleIndentSize ?? circleSize / 6
  const circleIndentColor = withOpacity(style.circleIndentColor ?? trackColor, style.circleIndentOpacity ?? 1)
  const circleIndentDistance = style.circleIndentDistance ?? circleSize / 2
  const circleIndentShape = style.circleIndentShape ?? 'circle'
  const dialCenter = polarToCartesian(50, 50, dialDistance, angle)

  const shapeColor = dialShape === 'square' ? squareColor : circleColor
  const indicator = resolveDialIndicator(style, angle, shapeColor)
  // A 'square' indicator can't be drawn as a plain SVG <rect> (no per-side
  // border width/radius) — the caller renders it as an HTML div instead
  // (using `indicator`'s own position/size, computed above), so this
  // component skips it entirely to avoid drawing it twice.
  const showIndicatorHere = (dialShape === 'square' || dialShape === 'circle') && indicator.shape !== 'square' && indicator.shape !== 'none'

  return (
    <>
      {dialShape === 'needle' && (
        <>
          <polygon points={needlePoints(50, 50, angle, needleLength, needleHalfWidth, needleTipLength)} fill={fillColor} />
          <circle cx={50} cy={50} r={needleCenterRadius} fill={fillColor} />
        </>
      )}
      {dialShape === 'square' && (
        // Unrotated, the rect's top edge points up (angle 0) — same
        // convention as the tick/triangle detents — so rotating the whole
        // group by `angle` makes that edge point at the active detent.
        <g transform={`rotate(${angle} 50 50) translate(0 ${-dialDistance})`}>
          <rect
            x={50 - squareWidth / 2}
            y={50 - squareHeight / 2}
            width={squareWidth}
            height={squareHeight}
            rx={squareBorderRadius}
            fill={squareColor}
            stroke={squareBorderColor}
            strokeWidth={squareBorderWidth}
          />
        </g>
      )}
      {dialShape === 'circle' && (
        <>
          <circle cx={dialCenter.x} cy={dialCenter.y} r={circleSize / 2} fill={circleColor} stroke={circleBorderColor} strokeWidth={circleBorderWidth} />
          {Array.from({ length: circleIndentCount }, (_, i) => {
            const indentAngle = angle + (i * 360) / circleIndentCount
            const indentPoint = polarToCartesian(dialCenter.x, dialCenter.y, circleIndentDistance, indentAngle)
            return (
              <DetentIndicatorShape
                key={i}
                shape={circleIndentShape}
                cx={indentPoint.x}
                cy={indentPoint.y}
                width={circleIndentSize * 2}
                height={circleIndentSize * 2}
                borderRadius={DEFAULT_DETENT_BORDER_RADIUS[circleIndentShape] ?? 0}
                rotate={circleIndentShape === 'tick' || circleIndentShape === 'triangle' ? indentAngle : 0}
                fill={circleIndentColor}
                stroke="transparent"
                strokeWidth={0}
              />
            )
          })}
        </>
      )}
      {showIndicatorHere && (
        <DetentIndicatorShape
          shape={indicator.shape}
          cx={indicator.point.x}
          cy={indicator.point.y}
          width={indicator.width}
          height={indicator.height}
          borderRadius={indicator.borderRadius}
          rotate={indicator.shape === 'tick' || indicator.shape === 'triangle' ? angle : 0}
          fill={indicator.color}
          stroke={indicator.borderColor}
          strokeWidth={indicator.borderWidth}
        />
      )}
    </>
  )
}

// The 'square' indicator's counterpart to DialShapeGraphic itself — renders
// as a plain HTML div (not SVG, see resolveDialIndicator's own doc comment
// for why) as a sibling of the caller's `<svg>`, not inside it. Shared by
// DialSwitchWidgetContent and EncoderWidgetContent so neither has to
// duplicate this positioning/border math. Returns null when there's nothing
// to draw (dialShape is 'needle', or the indicator isn't 'square'), so a
// caller can render it unconditionally.
export function SquareIndicatorOverlay({
  style,
  angle,
  shapeColor,
  w,
  h
}: {
  style: DialShapeStyle
  angle: number
  shapeColor: string
  w: number
  h: number
}): React.JSX.Element | null {
  const dialShape = style.dialShape ?? 'needle'
  if ((dialShape !== 'square' && dialShape !== 'circle') || (style.indicatorShape ?? 'circle') !== 'square') return null
  const indicator = resolveDialIndicator(style, angle, shapeColor)
  const scale = Math.min(w, h) / 100
  const pixelPoint = viewBoxToPixel(indicator.point.x, indicator.point.y, w, h)
  const sb = style.indicatorSquareBorder
  // Matches a square dialShape's own group rotation (its indicator inherits
  // the shape's rotated frame) vs a circle dialShape's (whose square
  // indicator never rotates) — see DialShapeGraphic's `showIndicatorHere`
  // branch for the equivalent reasoning on the SVG-rendered shapes.
  const rotate = dialShape === 'square' ? angle : 0
  return (
    <div
      className="deck-dial-shape__square-indicator"
      style={{
        left: pixelPoint.x,
        top: pixelPoint.y,
        width: indicator.width * scale,
        height: indicator.height * scale,
        transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
        background: indicator.color,
        boxSizing: 'border-box',
        borderStyle: 'solid',
        borderColor: indicator.borderColor,
        borderTopWidth: (sb?.widthTop ?? indicator.borderWidth) * scale,
        borderRightWidth: (sb?.widthRight ?? indicator.borderWidth) * scale,
        borderBottomWidth: (sb?.widthBottom ?? indicator.borderWidth) * scale,
        borderLeftWidth: (sb?.widthLeft ?? indicator.borderWidth) * scale,
        borderRadius: `${(sb?.radiusTopLeft ?? indicator.borderRadius) * scale}px ${(sb?.radiusTopRight ?? indicator.borderRadius) * scale}px ${(sb?.radiusBottomRight ?? indicator.borderRadius) * scale}px ${(sb?.radiusBottomLeft ?? indicator.borderRadius) * scale}px`
      }}
    />
  )
}
