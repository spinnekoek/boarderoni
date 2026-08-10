import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, type VariableMap } from '@shared/expr'
import type { DetentStyle, DialSwitchWidget } from '@shared/types'
import { renderWidgetLabel } from './labels'
import { labelAnchorPoint, needlePoints, polarToCartesian, viewBoxToPixel } from './arcPath'

// The default 2-position dial's own two detents sit at these — mirrored
// left/right of the vertical (top) axis (120 = 360 - 240), connected by the
// short arc along the bottom rather than wrapping the long way over the top.
const DEFAULT_START_ANGLE = 240
const DEFAULT_END_ANGLE = 120
const DETENT_RADIUS = 40
const DETENT_DOT_RADIUS = 5
const NEEDLE_LENGTH = 30
// How far (in the same 0-100 viewBox units as everything else here) a label
// sits from its detent's dot when WidgetLabel.labelDistance is unset — see
// labelAnchorPoint below.
const LABEL_OFFSET = 12

// Box size (viewBox units) for each detent/indicator shape — 'tick'/
// 'triangle' are deliberately non-square (a tick reads as a short radial
// bar, a triangle's clip-path wants a bit more room than the circle/
// square's dot) — and get rotated to point radially outward (see the
// `angle` transform at the call site) since, unlike a circle/square, which
// way they're "facing" is visible. 'circle'/'square' aren't rotated — a
// square is axis-aligned on purpose, matching a physical panel's detent
// markings. Exported so PropertiesPanel can show the same per-shape
// defaults in its width/height fields instead of duplicating this table.
export const DETENT_SIZE: Record<NonNullable<DialSwitchWidget['detentShape']>, { width: number; height: number }> = {
  circle: { width: DETENT_DOT_RADIUS * 2, height: DETENT_DOT_RADIUS * 2 },
  square: { width: DETENT_DOT_RADIUS * 2, height: DETENT_DOT_RADIUS * 2 },
  triangle: { width: DETENT_DOT_RADIUS * 2.4, height: DETENT_DOT_RADIUS * 2.4 },
  tick: { width: DETENT_DOT_RADIUS * 1.6, height: DETENT_DOT_RADIUS * 3.2 }
}

// Default corner radius per shape when DetentStyle.borderRadius is unset —
// matches the fixed values the CSS classes used before border radius became
// configurable. Circle has no entry: its roundness comes from CSS
// border-radius: 50%, which a pixel value can't replicate, so it's left
// alone unless a radius is explicitly set. Triangle has no entry either —
// its clip-path shape doesn't support a border/radius at all.
const DEFAULT_DETENT_BORDER_RADIUS: Partial<Record<NonNullable<DialSwitchWidget['detentShape']>, number>> = {
  square: 2,
  tick: 1
}

// The clock-position angle (0 = up, clockwise) a given position sits at —
// shared with useDialSwitchDrag.ts, which needs the exact same mapping to
// find which position a drag's raw pointer angle is nearest to.
export function angleForPosition(widget: DialSwitchWidget, index: number): number {
  const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
  const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
  const count = widget.positions.length
  return count > 1 ? startAngle + (index / (count - 1)) * (endAngle - startAngle) : startAngle
}

// Renders the dial-center indicator marker (square/circle dialShape only) —
// the same shape vocabulary as a ring detent (see DETENT_SIZE above), just
// as real SVG elements (this lives inside the <svg>, unlike the ring
// detents' plain-HTML divs) so a 'triangle' gets a proper stroked <polygon>
// instead of the ring detent's border-less clip-path trick. `rotate`, when
// non-zero, spins the marker in place around its own center so a
// 'tick'/'triangle' marker points outward — the square dialShape's marker
// never needs this (it already sits in a group rotated to point outward,
// see the 'square' branch below), only the circle dialShape's (which isn't
// rotated, so the marker itself has to turn to face out).
function DetentIndicatorShape({
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
  shape: NonNullable<DialSwitchWidget['indicatorShape']>
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
    const points = `${cx},${cy - height / 2} ${cx - width / 2},${cy + height / 2} ${cx + width / 2},${cy + height / 2}`
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} transform={transform} />
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

// Shared between the editor preview (CanvasWidget, interactive=false, no
// onSelect/pointer props) and the deployed view client (ViewCanvas,
// interactive=true — see DialSwitchView in ViewCanvas.tsx, which wires
// EITHER onSelect (tap mode, useSwitchPosition's select directly) OR the
// pointer props (drag mode, useDialSwitchDrag) depending on
// widget.interactionMode, never both). `activeIndex` is resolved by the
// caller (either from widget.activePositionExpr or a client-local tap/drag,
// see useSwitchPosition.ts) — `dragIndex`, only set mid-drag, previews
// whichever position the drag would currently commit, overriding
// `activeIndex` for the needle and the "active" detent highlight so you can
// see what releasing would select before you do.
export function DialSwitchWidgetContent({
  widget,
  variables,
  interactive,
  activeIndex,
  dragIndex,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  widget: DialSwitchWidget
  variables: VariableMap
  interactive: boolean
  activeIndex: number
  dragIndex?: number
  onSelect?: (index: number) => void
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
}): React.JSX.Element {
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedFill = resolveColor(widget.fill, variables)
  const needleColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)

  const effectiveIndex = dragIndex ?? activeIndex
  const needleAngle = angleForPosition(widget, effectiveIndex)
  const dragMode = widget.interactionMode === 'drag'
  const detentShape = widget.detentShape ?? 'circle'
  const detentRadius = widget.detentRadius ?? DETENT_RADIUS
  const rotateDetent = detentShape === 'tick' || detentShape === 'triangle'
  // DETENT_SIZE is in the same 0-100 viewBox units as everything else here —
  // same scale-to-actual-pixels conversion viewBoxToPixel applies to
  // positions, applied here to size so a detent shrinks/grows with the
  // widget's own w/h instead of staying a fixed CSS pixel size (which is
  // what the SVG dial/needle/track already do for free, just by being SVG).
  const scale = Math.min(widget.w, widget.h) / 100
  const detentStyle: DetentStyle | undefined = widget.detentStyle
  const baseDetentSize = {
    width: detentStyle?.width ?? DETENT_SIZE[detentShape].width,
    height: detentStyle?.height ?? DETENT_SIZE[detentShape].height
  }
  const detentSize = { width: baseDetentSize.width * scale, height: baseDetentSize.height * scale }
  const detentBorderWidth = (detentStyle?.borderWidth ?? 0) * scale
  const defaultDetentBorderRadius = DEFAULT_DETENT_BORDER_RADIUS[detentShape]
  const detentBorderRadius =
    detentStyle?.borderRadius !== undefined
      ? detentStyle.borderRadius * scale
      : defaultDetentBorderRadius !== undefined
        ? defaultDetentBorderRadius * scale
        : undefined

  // dialShape draws INSIDE the <svg viewBox="0 0 100 100"> below, so — unlike
  // the plain-HTML detent dots above, which need the manual viewBoxToPixel/
  // scale dance — its sizes are already viewBox units the browser scales for
  // free, same as NEEDLE_LENGTH/strokeWidth on the existing needle.
  const dialShape = widget.dialShape ?? 'needle'
  const squareWidth = widget.squareWidth ?? 24
  const squareHeight = widget.squareHeight ?? 24
  const squareBorderWidth = widget.squareBorderWidth ?? 0
  const squareBorderRadius = widget.squareBorderRadius ?? 2
  // Falls back to the needle/pointer color (widget.fill) rather than a fixed
  // default, so switching dialShape doesn't drop you into an invisible shape
  // that happens to match the dial face's own color.
  const squareColor = widget.squareColor ?? needleColor
  const squareBorderColor = widget.squareBorderColor ?? 'transparent'
  const circleSize = widget.circleSize ?? 20
  const circleBorderWidth = widget.circleBorderWidth ?? 0
  const circleColor = widget.circleColor ?? needleColor
  const circleBorderColor = widget.circleBorderColor ?? 'transparent'
  const circleIndicatorPoint = polarToCartesian(50, 50, circleSize / 2, needleAngle)

  const shapeColor = dialShape === 'square' ? squareColor : circleColor
  const indicatorShape = widget.indicatorShape ?? 'circle'
  const indicatorBaseSize = DETENT_SIZE[indicatorShape]
  const indicatorWidth = widget.indicatorStyle?.width ?? indicatorBaseSize.width
  const indicatorHeight = widget.indicatorStyle?.height ?? indicatorBaseSize.height
  const indicatorBorderWidth = widget.indicatorStyle?.borderWidth ?? 0
  const indicatorBorderRadius = widget.indicatorStyle?.borderRadius ?? DEFAULT_DETENT_BORDER_RADIUS[indicatorShape] ?? 0
  // Auto-lightened, like a switch position's own active-color default (see
  // pickAutoActiveColor below) — reads clearly against the shape by default
  // instead of collapsing into the same color until explicitly overridden.
  const indicatorColor = widget.indicatorColor ?? pickAutoActiveColor(shapeColor)
  const indicatorBorderColor = widget.indicatorStyle?.borderColor ?? 'transparent'

  return (
    <div
      className={`deck-dial-switch${interactive ? '' : ' deck-dial-switch--static'}${dragMode && interactive ? ' deck-dial-switch--drag' : ''}`}
      style={widget.zIndex !== undefined ? { zIndex: widget.zIndex } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg className="deck-dial-switch__dial" viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={45} fill={trackColor} stroke={borderColor} strokeWidth={2} />
        {dialShape === 'needle' && (
          <>
            <polygon points={needlePoints(50, 50, needleAngle, NEEDLE_LENGTH, 2, 10)} fill={needleColor} />
            <circle cx={50} cy={50} r={4} fill={needleColor} />
          </>
        )}
        {dialShape === 'square' && (
          // Unrotated, the rect's top edge points up (angle 0) — same
          // convention as the tick/triangle detents — so rotating the whole
          // group by needleAngle makes that edge point at the active detent.
          // The indicator marker rides along on that same edge, at its
          // midpoint, so it never needs its own rotation (it's already
          // "facing" the right way in the group's local, unrotated frame).
          <g transform={`rotate(${needleAngle} 50 50)`}>
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
            <DetentIndicatorShape
              shape={indicatorShape}
              cx={50}
              cy={50 - squareHeight / 2}
              width={indicatorWidth}
              height={indicatorHeight}
              borderRadius={indicatorBorderRadius}
              rotate={0}
              fill={indicatorColor}
              stroke={indicatorBorderColor}
              strokeWidth={indicatorBorderWidth}
            />
          </g>
        )}
        {dialShape === 'circle' && (
          <>
            <circle cx={50} cy={50} r={circleSize / 2} fill={circleColor} stroke={circleBorderColor} strokeWidth={circleBorderWidth} />
            <DetentIndicatorShape
              shape={indicatorShape}
              cx={circleIndicatorPoint.x}
              cy={circleIndicatorPoint.y}
              width={indicatorWidth}
              height={indicatorHeight}
              borderRadius={indicatorBorderRadius}
              rotate={indicatorShape === 'tick' || indicatorShape === 'triangle' ? needleAngle : 0}
              fill={indicatorColor}
              stroke={indicatorBorderColor}
              strokeWidth={indicatorBorderWidth}
            />
          </>
        )}
      </svg>
      {widget.positions.map((position, index) => {
        const angle = angleForPosition(widget, index)
        const dotVb = polarToCartesian(50, 50, detentRadius, angle)
        const dot = viewBoxToPixel(dotVb.x, dotVb.y, widget.w, widget.h)
        const resolvedColor = resolveColor(position, variables)
        const unselectedColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
        const active = index === effectiveIndex
        // Only resolved for the active detent — no reason to evaluate
        // activeColor/activeOpacity's expression for every other one on
        // each render.
        let displayColor = unselectedColor
        let dotOpacity = resolvedColor.opacity ?? position.backgroundOpacity ?? 1
        if (active) {
          const resolvedActive = resolveColor({ color: position.activeColor, colorExpr: position.activeColorExpr }, variables)
          displayColor = resolvedActive.color ?? pickAutoActiveColor(unselectedColor)
          dotOpacity = resolvedActive.opacity ?? position.activeOpacity ?? dotOpacity
        }
        const dotColor = withOpacity(displayColor, dotOpacity)
        // Only wired in tap mode (onSelect is only ever passed then) — in
        // drag mode the outer container above owns the whole gesture, and a
        // per-dot click here would fire alongside/instead of it.
        const handleSelect = interactive && onSelect ? () => onSelect(index) : undefined
        return (
          // The dot and each label are independently-positioned elements,
          // not parent/child — each centered (translate -50%,-50%) on its
          // own computed point, so a label's own size (it can wrap to two
          // lines for a long name) never drags the dot's center off the
          // ring the way nesting them in one flex block used to. Every
          // label in this position gets its own wrapper (not one shared
          // one) since each now has its own independent labelAnchor.
          <div key={position.id}>
            <div
              className={`deck-dial-switch__detent deck-dial-switch__detent--${detentShape}`}
              style={{
                left: dot.x,
                top: dot.y,
                width: detentSize.width,
                height: detentSize.height,
                background: dotColor,
                transform: rotateDetent ? `translate(-50%, -50%) rotate(${angle}deg)` : undefined,
                ...(detentShape !== 'triangle' && (detentBorderWidth > 0 || detentBorderRadius !== undefined)
                  ? {
                      boxSizing: 'border-box' as const,
                      borderRadius: detentBorderRadius,
                      borderWidth: detentBorderWidth,
                      borderStyle: detentBorderWidth > 0 ? ('solid' as const) : undefined,
                      borderColor: detentStyle?.borderColor
                    }
                  : undefined)
              }}
              onClick={handleSelect}
            />
            {position.labels.map((positionLabel) => {
              const labelVb = labelAnchorPoint(
                dotVb,
                angle,
                detentRadius,
                positionLabel.labelDistance ?? LABEL_OFFSET,
                positionLabel.labelAnchor,
                LABEL_OFFSET
              )
              const label = viewBoxToPixel(labelVb.x, labelVb.y, widget.w, widget.h)
              return (
                <div key={positionLabel.id} className="deck-dial-switch__detent-label" style={{ left: label.x, top: label.y }} onClick={handleSelect}>
                  {renderWidgetLabel(positionLabel, trackColor, variables)}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
