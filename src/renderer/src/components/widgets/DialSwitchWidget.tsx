import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { DetentStyle, DialSwitchWidget } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabel, renderWidgetLabels } from './labels'
import { labelAnchorPoint, polarToCartesian, roundedPolygonPath, viewBoxToPixel } from './arcPath'
import { DEFAULT_DETENT_BORDER_RADIUS, DETENT_SIZE, DialShapeGraphic, SquareIndicatorOverlay } from './DialShapeGraphic'

// The default 2-position dial's own two detents sit at these — mirrored
// left/right of the vertical (top) axis (120 = 360 - 240), connected by the
// short arc along the bottom rather than wrapping the long way over the top.
const DEFAULT_START_ANGLE = 240
const DEFAULT_END_ANGLE = 120
const DETENT_RADIUS = 40
const NEEDLE_LENGTH = 30
// How far (in the same 0-100 viewBox units as everything else here) a label
// sits from its detent's dot when WidgetLabel.labelDistance is unset — see
// labelAnchorPoint below.
const LABEL_OFFSET = 12

// The clock-position angle (0 = up, clockwise) a given position sits at —
// shared with useDialSwitchDrag.ts, which needs the exact same mapping to
// find which position a drag's raw pointer angle is nearest to.
export function angleForPosition(widget: DialSwitchWidget, index: number): number {
  const startAngle = widget.startAngle ?? DEFAULT_START_ANGLE
  const endAngle = widget.endAngle ?? DEFAULT_END_ANGLE
  const count = widget.positions?.length ?? 0
  return count > 1 ? startAngle + (index / (count - 1)) * (endAngle - startAngle) : startAngle
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
  const debugMode = useEditorSettings((s) => s.debugMode)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedFill = resolveColor(widget.fill, variables)
  const needleColor = withOpacity(resolvedFill.color ?? DEFAULT_WIDGET_COLOR, resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle

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
  // Same border width/radius as detentBorderRadius/detentBorderWidth above,
  // but in raw viewBox units (not pixel-scaled) — a triangle detent renders
  // as a real <path> inside the shared 0-100 viewBox SVG (see below), which
  // the browser scales for free the same way it already does the dial/
  // needle/track, unlike the other three detent shapes' plain-HTML divs
  // (which live outside that SVG and must do the scaling by hand).
  const detentBorderWidthVb = detentStyle?.borderWidth ?? 0
  const detentBorderRadiusVb = detentStyle?.borderRadius ?? defaultDetentBorderRadius ?? 0

  // Precomputed once per position so both the (triangle-only) in-SVG marker
  // below and the plain-HTML marker/labels further down share the same
  // angle/point/color instead of resolving each position's color twice.
  const positionMarkers = (widget.positions ?? []).map((position, index) => {
    const angle = angleForPosition(widget, index)
    const dotVb = polarToCartesian(50, 50, detentRadius, angle)
    const dot = viewBoxToPixel(dotVb.x, dotVb.y, widget.w, widget.h)
    const resolvedColor = resolveColor(position, variables)
    const unselectedColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
    const active = index === effectiveIndex
    // Only resolved for the active detent — no reason to evaluate
    // activeColor/activeOpacity's expression for every other one on each
    // render.
    let displayColor = unselectedColor
    let dotOpacity = resolvedColor.opacity ?? position.backgroundOpacity ?? 1
    if (active) {
      const resolvedActive = resolveColor({ color: position.activeColor, colorExpr: position.activeColorExpr }, variables)
      displayColor = resolvedActive.color ?? pickAutoActiveColor(unselectedColor)
      dotOpacity = resolvedActive.opacity ?? position.activeOpacity ?? dotOpacity
    }
    const dotColor = withOpacity(displayColor, dotOpacity)
    // Only wired in tap mode (onSelect is only ever passed then) — in drag
    // mode the outer container above owns the whole gesture, and a per-dot
    // click here would fire alongside/instead of it.
    const handleSelect = interactive && onSelect ? () => onSelect(index) : undefined
    return { position, index, angle, dotVb, dot, dotColor, handleSelect }
  })

  // Passed to SquareIndicatorOverlay below — see its own doc comment for why
  // a 'square' indicator renders as an HTML div instead of joining
  // DialShapeGraphic's SVG output.
  const shapeColor = (widget.dialShape ?? 'needle') === 'square' ? (widget.squareColor ?? needleColor) : (widget.circleColor ?? needleColor)

  return (
    <div
      className={`deck-dial-switch${interactive ? '' : ' deck-dial-switch--static'}${dragMode && interactive ? ' deck-dial-switch--drag' : ''}`}
      style={widget.zIndex !== undefined ? { zIndex: widget.zIndex } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Everything — dial face, needle, detents/labels, widget-level labels
          — rotates together as one unit, same "no separate always-upright
          layer" choice ButtonWidget/AdjusterWidget/ToggleSwitchWidget's own
          rotateAngle makes. */}
      <div className="deck-dial-switch__rotated" style={rotateAngle ? { transform: `rotate(${rotateAngle}deg)` } : undefined}>
      <svg className="deck-dial-switch__dial" viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={45} fill={trackColor} stroke={borderColor} strokeWidth={2} />
        <DialShapeGraphic
          style={widget}
          angle={needleAngle}
          fillColor={needleColor}
          trackColor={trackColor}
          needleLength={NEEDLE_LENGTH}
          needleHalfWidth={2}
          needleTipLength={10}
          needleCenterRadius={4}
        />
        {detentShape === 'triangle' &&
          positionMarkers.map(({ position, angle, dotVb, dotColor, handleSelect }) => {
            const halfW = baseDetentSize.width / 2
            const halfH = baseDetentSize.height / 2
            const points = [
              { x: dotVb.x, y: dotVb.y - halfH },
              { x: dotVb.x - halfW, y: dotVb.y + halfH },
              { x: dotVb.x + halfW, y: dotVb.y + halfH }
            ]
            return (
              <path
                key={position.id}
                className="deck-dial-switch__detent-svg"
                d={roundedPolygonPath(points, detentBorderRadiusVb)}
                fill={dotColor}
                stroke={detentStyle?.borderColor}
                strokeWidth={detentBorderWidthVb}
                transform={`rotate(${angle} ${dotVb.x} ${dotVb.y})`}
                onClick={handleSelect}
              />
            )
          })}
      </svg>
      <SquareIndicatorOverlay style={widget} angle={needleAngle} shapeColor={shapeColor} w={widget.w} h={widget.h} />
      {positionMarkers.map(({ position, angle, dotVb, dot, dotColor, handleSelect }) => (
        // The dot and each label are independently-positioned elements, not
        // parent/child — each centered (translate -50%,-50%) on its own
        // computed point, so a label's own size (it can wrap to two lines
        // for a long name) never drags the dot's center off the ring the
        // way nesting them in one flex block used to. Every label in this
        // position gets its own wrapper (not one shared one) since each now
        // has its own independent labelAnchor.
        <div key={position.id}>
          {detentShape !== 'triangle' && detentShape !== 'none' && (
            <div
              className={`deck-dial-switch__detent deck-dial-switch__detent--${detentShape}`}
              style={{
                left: dot.x,
                top: dot.y,
                width: detentSize.width,
                height: detentSize.height,
                background: dotColor,
                transform: rotateDetent ? `translate(-50%, -50%) rotate(${angle}deg)` : undefined,
                ...(detentBorderWidth > 0 || detentBorderRadius !== undefined
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
          )}
          {(position.labels ?? []).map((positionLabel) => {
            const labelVb = labelAnchorPoint(dotVb, angle, detentRadius, positionLabel.labelDistance ?? LABEL_OFFSET, positionLabel.labelAnchor)
            const label = viewBoxToPixel(labelVb.x, labelVb.y, widget.w, widget.h)
            return (
              <div key={positionLabel.id} className="deck-dial-switch__detent-label" style={{ left: label.x, top: label.y }} onClick={handleSelect}>
                {renderWidgetLabel(positionLabel, trackColor, variables, debugMode)}
              </div>
            )
          })}
        </div>
      ))}
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
      </div>
    </div>
  )
}
