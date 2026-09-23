import { DEFAULT_WIDGET_COLOR, darken, lighten, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { SwitchPosition, ToggleSwitchWidget } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabel, renderWidgetLabels } from './labels'
import { labelAnchorPoint, polarToCartesian, viewBoxToPixel } from './arcPath'

const BEZEL_RADIUS = 45 // default for widget.bezelRadius, same convention as DialSwitchWidget's dial-face radius
const LEVER_LENGTH = 36 // default for widget.leverLength
const LEVER_TIP_HALF_WIDTH = 9 // wide end — the visible grip, sticking up out of the bezel; default for widget.leverTipRadius
const LEVER_BASE_HALF_WIDTH = 4 // narrow end — tapers down into the pivot, like a post through a hole
// Defaults for widget.barWidth/barHeight — leverShape 'bar' only, see its
// own comment in shared/types.ts. Wider than tall, like a real toggle's
// paddle/bat handle capping the post.
const BAR_WIDTH = 20
const BAR_HEIGHT = 10
// Just past the bezel rim — the ring a position's own label anchors off of,
// same role DialSwitchWidget's detentRadius plays for its ring detents. Added
// to the EFFECTIVE bezel radius (widget.bezelRadius ?? BEZEL_RADIUS) below,
// not this constant, so labels stay pinned just outside the rim regardless
// of how big/small the bezel is set.
const LABEL_RING_OFFSET = 3
const LABEL_OFFSET = 12

// The two poles a lever swings between, indexed [pole-for-position-0,
// pole-for-last-position] — 'vertical' throws straight up (first position)
// down to straight down (last position), 'horizontal' throws left (first)
// to right (last), expressed in a wrap-safe range (no crossing the 0/360
// seam) so interpolating between them in angleForIndex is a plain lerp.
// This has to match the click zones' own top-to-bottom/left-to-right order
// (see .deck-toggle-switch__zones below, which renders positions in array
// order along the same flex axis) — position 0 is always the FIRST zone
// (top, or left), so its pole must be whichever direction that zone is in,
// or tapping it would flip the lever the opposite way from where you tapped.
const POLE_ANGLES: Record<'horizontal' | 'vertical', [number, number]> = {
  vertical: [0, 180],
  horizontal: [-90, 90]
}

// True only for the exact middle index of an odd-length positions list — a
// real 3-way toggle's center throw doesn't lean either way (e.g. a BATT
// switch's OFF), so it gets its own distinct "circle" look (see the render
// below) rather than a lever drawn at some arbitrary angle. Exported so
// useToggleSwitchDrag.ts and ViewCanvas.tsx's ToggleSwitchView can find the
// middle position a momentary throw springs back to, without duplicating
// this same odd/even math.
export function isMiddlePosition(index: number, count: number): boolean {
  return count % 2 === 1 && index === (count - 1) / 2
}

// The position a momentary Top/Bottom throw springs back to once released —
// the middle for a 3-position switch (see SwitchPosition.momentary's own
// comment), or, on a 2-position switch (no middle to spring back to),
// whichever of Top/Bottom ISN'T the momentary one. The properties panel
// enforces at most one momentary position on a 2-position switch (see
// PropertiesPanel.tsx's Momentary section), so "the other one" is always
// unambiguous — there's no case where both ends are momentary and neither
// has anywhere non-momentary to land. -1 means "no such position," kept for
// parity with isMiddlePosition returning false rather than throwing on an
// unexpected count (toggle switches are always 2 or 3 positions in practice
// — see Palette.tsx's own hint — but this stays total instead of assuming
// that's enforced everywhere upstream). Exported for useToggleSwitchDrag.ts's
// own drag-mode spring-back and ViewCanvas.tsx's tap-mode spring-back, same
// reason isMiddlePosition above is exported for both.
export function momentarySpringBackIndex(momentaryIndex: number, count: number): number {
  if (count % 2 === 1) return (count - 1) / 2
  if (count === 2) return momentaryIndex === 0 ? 1 : 0
  return -1
}

// The shaded-cap look shared by the middle-position circle and the lever's
// own tip ellipse (see circleTopStyle's own comment in shared/types.ts) —
// one control for "what does the round top of the toggle look like,"
// rendered as a full circle head-on (middle position) or a foreshortened
// ellipse cap on the lever's tip (thrown positions), same physical point of
// the switch either way.
function topShadeStops(baseColor: string, alpha: number, style: 'flat' | 'rounded'): { offset: string; color: string }[] {
  return style === 'rounded'
    ? [
        // Full radial highlight offset toward the upper-left, like light
        // catching a sphere — darkest at that same spot's opposite corner
        // (bottom-right), not the outer rim in every direction, so it
        // doesn't read as a dimple/dent.
        { offset: '0%', color: withOpacity(darken(baseColor, 0.35), alpha) },
        { offset: '60%', color: withOpacity(baseColor, alpha) },
        { offset: '100%', color: withOpacity(lighten(baseColor, 0.4), alpha) }
      ]
    : [
        // A thin light rim right at the bottom edge over an otherwise flat
        // face, plus a slightly darker top edge — reads as a flat cylinder
        // cap catching a line of light, not a dome.
        { offset: '0%', color: withOpacity(darken(baseColor, 0.25), alpha) },
        { offset: '20%', color: withOpacity(baseColor, alpha) },
        { offset: '86%', color: withOpacity(baseColor, alpha) },
        { offset: '100%', color: withOpacity(lighten(baseColor, 0.45), alpha) }
      ]
}

// The middle-position circle's own gradient — screen-fixed by construction
// since (unlike the lever tip below) it never sits inside a rotated group,
// so plain objectBoundingBox units (no explicit position/rotation math
// needed) are enough. `id` must be unique per widget instance (suffixed
// with widget.id below) since SVG <defs> ids are document-global, not
// scoped to one widget's own <svg>.
function renderCircleTopGradient(id: string, baseColor: string, alpha: number, style: 'flat' | 'rounded'): React.JSX.Element {
  const stops = topShadeStops(baseColor, alpha, style).map((s) => <stop key={s.offset} offset={s.offset} stopColor={s.color} />)
  return style === 'rounded' ? (
    <radialGradient id={id} cx="35%" cy="30%" r="75%">
      {stops}
    </radialGradient>
  ) : (
    <linearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
      {stops}
    </linearGradient>
  )
}

// The lever tip ellipse's own gradient — unlike the circle above, this
// shape lives inside the lever's own `<g transform="rotate(leverAngle ...)>`
// group, so a gradient defined in plain objectBoundingBox/default-axis terms
// would spin along with the lever and light the tip from a different
// direction depending on which way the switch is thrown (e.g. from the
// pivot side when thrown down instead of always from screen-up). Explicit
// userSpaceOnUse coordinates plus a `rotate(-leverAngle, ...)`
// gradientTransform counter the ancestor rotation so the highlight direction
// stays fixed on screen while the ellipse itself still rotates with the
// lever.
function renderLeverTipGradient(
  id: string,
  baseColor: string,
  alpha: number,
  style: 'flat' | 'rounded',
  cy: number,
  rx: number,
  ry: number,
  leverAngle: number
): React.JSX.Element {
  const stops = topShadeStops(baseColor, alpha, style).map((s) => <stop key={s.offset} offset={s.offset} stopColor={s.color} />)
  const counterRotate = `rotate(${-leverAngle} 50 ${cy})`
  return style === 'rounded' ? (
    <radialGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      cx={50 - rx * 0.3}
      cy={cy - ry * 0.3}
      r={Math.max(rx, ry) * 1.4}
      gradientTransform={counterRotate}
    >
      {stops}
    </radialGradient>
  ) : (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={50} y1={cy - ry} x2={50} y2={cy + ry} gradientTransform={counterRotate}>
      {stops}
    </linearGradient>
  )
}

// SVG path for the lever, unrotated, pivoting from (50,50) with its tip
// pointing straight up — a tapered "post" outline (rounded dome at the wide
// tip, narrowing straight down to a flat narrow cap at the base/pivot)
// rather than a constant-width pill, so a static 2D render still reads as
// an upright, turned lever instead of a flat rocker segment. Only the tip
// is rounded — it's the end you actually see face-on (see isMiddlePosition's
// own circle, which is this same rounded tip viewed head-on); the base end
// disappears into the pivot and is never visibly a flat corner. `tipRy`
// defaults to `tipHalfWidth` (a true semicircle) — pass a smaller value to
// flatten the dome itself, for circleTopStyle 'flat' below: a sphere's
// silhouette is a circle from any angle, but a flat disc's silhouette
// foreshortens into an ellipse when viewed edge-on, so the tip's own
// outline (not just its shading) needs to flatten to read as a flat cap
// rather than a dome.
function leverPath(length: number, tipHalfWidth: number, baseHalfWidth: number, tipRy: number = tipHalfWidth): string {
  const topY = 50 - length
  const baseY = 50
  return [
    `M ${50 - tipHalfWidth} ${topY}`,
    `A ${tipHalfWidth} ${tipRy} 0 0 1 ${50 + tipHalfWidth} ${topY}`,
    `L ${50 + baseHalfWidth} ${baseY}`,
    `L ${50 - baseHalfWidth} ${baseY}`,
    'Z'
  ].join(' ')
}

// SVG `points` for a regular hexagon centered at (50,50), one vertex
// pointing straight up at rotation 0 — bezelShape 'hexagon' only (see its
// own comment in shared/types.ts). User rotation (widget.bezelRotation) is
// applied as a separate SVG transform on top of this, same split as the
// lever's own leverPath (drawn upright, then wrapped in its own
// rotate(...) transform below) rather than baking the angle into the point
// math itself.
function hexagonPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, i) => polarToCartesian(50, 50, radius, i * 60))
    .map((p) => `${p.x},${p.y}`)
    .join(' ')
}

// The fixed, non-editable name for a given position slot — see
// ToggleSwitchWidget's own comment in shared/types.ts for why these are
// forced rather than freeform like Rocker/Dial/Dropdown's. Shared by
// Palette.tsx (initial creation) and PropertiesPanel.tsx (every
// add/remove/reorder re-derives every position's name through this, so it
// can never drift from what's actually rendered where).
export function toggleNameForIndex(index: number, count: number): string {
  if (isMiddlePosition(index, count)) return 'Middle'
  return index === 0 ? 'Top' : 'Bottom'
}

// This position's own angle on the arc between the two poles — used both to
// point the lever when this position is the active one, and (for every
// position, active or not) to anchor its own labels, same role
// DialSwitchWidget's angleForPosition plays for its ring detents. Exported
// for useToggleSwitchDrag.ts's own nearest-position-to-drag-angle
// resolution — same reason DialSwitchWidget exports angleForPosition.
export function angleForIndex(index: number, count: number, orientation: 'horizontal' | 'vertical'): number {
  const [pole0, pole1] = POLE_ANGLES[orientation]
  return count > 1 ? pole0 + (index / (count - 1)) * (pole1 - pole0) : pole1
}

// Shared between the editor preview (CanvasWidget, interactive=false, no
// zone/drag handlers at all) and the deployed view client (ViewCanvas,
// interactive=true — see ToggleSwitchView in ViewCanvas.tsx, which wires
// EITHER onZonePointerDown/onZonePointerUp (tap mode) OR
// onPointerDown/onPointerMove/onPointerUp (drag mode) depending on
// widget.interactionMode, never both — same split DialSwitchWidgetContent's
// own comment describes). `activeIndex` is resolved by the caller (either
// from widget.activePositionExpr or a client-local tap/drag, see
// useSwitchPosition.ts) — `dragIndex`, only set mid-drag, previews whichever
// position the drag would currently commit, overriding `activeIndex` for
// the lever so you can see what releasing would select before you do.
export function ToggleSwitchWidgetContent({
  widget,
  variables,
  interactive,
  activeIndex,
  dragIndex,
  onZonePointerDown,
  onZonePointerUp,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  selectedPositionId,
  onPositionSelect,
  guardOpen,
  onGuardToggle,
  applyRotation = true
}: {
  widget: ToggleSwitchWidget
  variables: VariableMap
  interactive: boolean
  activeIndex: number
  dragIndex?: number
  // Only meaningful when widget.guardEnabled — resolved by the caller (see
  // useSwitchGuard.ts) the same "local tap, optional expr override" way
  // activeIndex above is. Editor preview (interactive=false) never passes
  // these, so the guard always renders closed there.
  guardOpen?: boolean
  onGuardToggle?: () => void
  // Tap mode only (see ToggleSwitchView) — pressing a zone always selects it
  // immediately (even a momentary one, which springs back on release — see
  // SwitchPosition.momentary); releasing anywhere on that same zone (pointer
  // capture keeps the events targeted here regardless of where the pointer
  // physically ends up) is what a momentary position's spring-back hooks
  // into. A non-momentary position's onZonePointerUp is a no-op.
  onZonePointerDown?: (index: number) => void
  onZonePointerUp?: (index: number) => void
  // Drag mode only — the whole widget is one drag surface, not a set of
  // individually-tappable zones, so it needs the outer container's own
  // pointer events instead (see useToggleSwitchDrag.ts).
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  // Editor-only (interactive=false) click-through-to-drill-down, same as
  // RockerSwitchWidgetContent's own onPositionSelect.
  selectedPositionId?: string | null
  onPositionSelect?: (position: SwitchPosition) => void
  // See ButtonWidgetContent's identical prop for why — CanvasWidget.tsx
  // rotates the outer selection/resize wrapper itself and passes false here
  // to avoid rotating twice.
  applyRotation?: boolean
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedFill = resolveColor(widget.fill, variables)
  const leverBaseColor = resolvedFill.color ?? DEFAULT_WIDGET_COLOR
  const leverAlpha = resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1
  const leverColor = withOpacity(leverBaseColor, leverAlpha)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const borderWidth = widget.borderWidth ?? 2
  const bezelRadius = widget.bezelRadius ?? BEZEL_RADIUS
  const bezelShape = widget.bezelShape ?? 'circle'
  const leverLength = widget.leverLength ?? LEVER_LENGTH
  const leverBorderWidth = widget.leverBorderWidth ?? 0
  const leverBorderColor = withOpacity(widget.leverBorderColor ?? 'transparent', 1)
  const leverTipRadius = widget.leverTipRadius ?? LEVER_TIP_HALF_WIDTH
  const leverBaseRadius = widget.leverBaseRadius ?? LEVER_BASE_HALF_WIDTH
  const circleTopStyle = widget.circleTopStyle ?? 'rounded'
  // A sphere's silhouette is a circle from any angle, but a flat disc's
  // silhouette foreshortens into an ellipse viewed edge-on — so the dome's
  // own vertical radius (leverPath's tipRy, below) flattens for 'flat' but
  // stays a full circle for 'rounded'. leverTipRx/Ry (the shading overlay's
  // own size) follow the same split: 'flat' matches the dome's full extent
  // exactly (no gap between outline and shading), 'rounded' keeps the
  // smaller inset highlight that already reads correctly on a full dome.
  const leverTipDomeRy = circleTopStyle === 'flat' ? leverTipRadius * 0.5 : leverTipRadius
  const leverTipCy = 50 - leverLength - leverTipDomeRy * 0.55 + 1
  const leverTipRx = circleTopStyle === 'flat' ? leverTipRadius : leverTipRadius * 0.85
  const leverTipRy = circleTopStyle === 'flat' ? leverTipDomeRy : leverTipRadius * 0.5
  const circleBaseColor = widget.circleColor ?? resolvedFill.color ?? DEFAULT_WIDGET_COLOR
  const circleAlpha = widget.circleOpacity ?? resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1
  const circleRadius = widget.circleRadius ?? leverTipRadius
  const circleBorderWidth = widget.circleBorderWidth ?? 0
  const circleBorderColor = withOpacity(widget.circleBorderColor ?? 'transparent', 1)
  const circleTopGradientId = `toggle-circle-top-${widget.id}`
  const leverTipGradientId = `toggle-lever-tip-${widget.id}`
  // Opacity deliberately does NOT inherit widget.track.backgroundOpacity the
  // way the color above inherits resolvedTrack.color — an invisible/
  // transparent bezel (track.backgroundOpacity: 0) is a common, intentional
  // look (just the lever against a background image, no backing plate), and
  // chaining through it silently zeroed out an explicitly-chosen
  // innerBezelColor with no visible cause. Defaults straight to 1 instead,
  // so setting a color actually shows it regardless of the bezel's own
  // opacity.
  const innerBezelColor = withOpacity(widget.innerBezelColor ?? resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, widget.innerBezelOpacity ?? 1)
  // 0 (invisible) by default — see its own comment in shared/types.ts for why.
  const innerBezelRadius = widget.innerBezelRadius ?? 0
  const innerBezelBorderWidth = widget.innerBezelBorderWidth ?? 0
  const innerBezelBorderColor = withOpacity(widget.innerBezelBorderColor ?? 'transparent', 1)
  const leverShape = widget.leverShape ?? 'normal'
  const barWidth = widget.barWidth ?? BAR_WIDTH
  const barHeight = widget.barHeight ?? BAR_HEIGHT
  const barColor = withOpacity(
    widget.barColor ?? resolvedFill.color ?? DEFAULT_WIDGET_COLOR,
    widget.barOpacity ?? resolvedFill.opacity ?? widget.fill.backgroundOpacity ?? 1
  )
  const barBorderWidth = widget.barBorderWidth ?? 0
  const barBorderColor = withOpacity(widget.barBorderColor ?? 'transparent', 1)
  const barBorderRadius = widget.barBorderRadius ?? 0
  const resolvedGuard = resolveColor(widget.guard ?? {}, variables)
  const guardColor = withOpacity(resolvedGuard.color ?? '#c0392b', resolvedGuard.opacity ?? widget.guard?.backgroundOpacity ?? 1)
  const resolvedGuardBorder = resolveBorderColor(widget.guard ?? {}, variables)
  const guardBorderColor = withOpacity(resolvedGuardBorder.color ?? 'transparent', resolvedGuardBorder.opacity ?? widget.guard?.borderOpacity ?? 1)
  // Vertically centered by default (matches the pre-guardTop look exactly:
  // a box guardHeight tall, centered in a widget widget.h tall) — see
  // ToggleSwitchWidget.guardTop's own comment in shared/types.ts.
  const guardTop = widget.guardTop ?? (widget.h - (widget.guardHeight ?? widget.h)) / 2
  const guardOpenHeight = widget.guardOpenHeight ?? 14
  const guardOpenTop = widget.guardOpenTop ?? 0
  const orientation = widget.orientation ?? 'vertical'
  const count = widget.positions?.length ?? 0
  const dragMode = widget.interactionMode === 'drag'
  const effectiveIndex = dragIndex ?? activeIndex
  const showCircle = isMiddlePosition(effectiveIndex, count)
  const leverAngle = angleForIndex(effectiveIndex, count, orientation)
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle

  return (
    <div
      className={`deck-toggle-switch${interactive ? '' : ' deck-toggle-switch--static'}${dragMode && interactive ? ' deck-toggle-switch--drag' : ''}`}
      style={widget.zIndex !== undefined ? { zIndex: widget.zIndex } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Everything — zones, position labels, widget-level labels,
          bezel/lever, guard — rotates together as one unit, same "no
          separate always-upright layer" choice ButtonWidget/AdjusterWidget's
          own rotateAngle makes. */}
      <div className="deck-toggle-switch__rotated" style={applyRotation && rotateAngle ? { transform: `rotate(${rotateAngle}deg)` } : undefined}>
      <div className="deck-toggle-switch__zones" style={{ flexDirection: orientation === 'vertical' ? 'column' : 'row' }}>
        {(widget.positions ?? []).map((position, index) => {
          const selected = !interactive && position.id === selectedPositionId
          return (
            <div
              key={position.id}
              className={`deck-toggle-switch__zone${selected ? ' deck-toggle-switch__zone--selected' : ''}`}
              onPointerDown={
                interactive && !dragMode
                  ? (e) => {
                      onZonePointerDown?.(index)
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId)
                      } catch {
                        // best-effort, see CanvasWidget's handlePointerDown
                      }
                    }
                  : !interactive
                    ? // Same deliberate non-stopPropagation as RockerSwitchWidgetContent's
                      // segment click — see its own comment for why the widget-level
                      // select/drag handler still needs to see this pointerdown too.
                      () => onPositionSelect?.(position)
                    : undefined
              }
              onPointerUp={interactive && !dragMode ? () => onZonePointerUp?.(index) : undefined}
              onPointerCancel={interactive && !dragMode ? () => onZonePointerUp?.(index) : undefined}
            />
          )
        })}
      </div>
      {(widget.positions ?? []).map((position, index) => {
        const angle = angleForIndex(index, count, orientation)
        const labelRingRadius = bezelRadius + LABEL_RING_OFFSET
        const dotVb = polarToCartesian(50, 50, labelRingRadius, angle)
        return (position.labels ?? []).map((label) => {
          const labelVb = labelAnchorPoint(dotVb, angle, labelRingRadius, label.labelDistance ?? LABEL_OFFSET, label.labelAnchor)
          const labelPx = viewBoxToPixel(labelVb.x, labelVb.y, widget.w, widget.h)
          return (
            <div key={label.id} className="deck-toggle-switch__label" style={{ left: labelPx.x, top: labelPx.y }}>
              {renderWidgetLabel(label, trackColor, variables, debugMode)}
            </div>
          )
        })
      })}
      {renderWidgetLabels(widget.labels, trackColor, variables, debugMode)}
      {/* Bezel+lever, painted AFTER every label above (rather than first,
          the more obvious order) so the lever/circle visually sits in front
          of a label that's been pulled in close via a negative labelDistance
          (see LabelFields' own "Label distance" comment in
          PropertiesPanel.tsx) — a real toggle's stalk would occlude a
          placard behind it the same way. pointer-events:none on
          .deck-toggle-switch__bezel (see its own CSS comment) means this
          move doesn't change what the zones below actually receive clicks
          for — that was already independent of paint order. */}
      <svg className="deck-toggle-switch__bezel" viewBox="0 0 100 100">
        <defs>
          {renderCircleTopGradient(circleTopGradientId, circleBaseColor, circleAlpha, circleTopStyle)}
          {leverShape !== 'bar' &&
            renderLeverTipGradient(leverTipGradientId, leverBaseColor, leverAlpha, circleTopStyle, leverTipCy, leverTipRx, leverTipRy, leverAngle)}
        </defs>
        {bezelShape === 'hexagon' ? (
          <g transform={`rotate(${widget.bezelRotation ?? 0} 50 50)`}>
            <polygon points={hexagonPoints(bezelRadius)} fill={trackColor} stroke={borderColor} strokeWidth={borderWidth} />
          </g>
        ) : (
          <circle cx={50} cy={50} r={bezelRadius} fill={trackColor} stroke={borderColor} strokeWidth={borderWidth} />
        )}
        {innerBezelRadius > 0 && (
          <circle
            cx={50}
            cy={50}
            r={innerBezelRadius}
            fill={innerBezelColor}
            stroke={innerBezelBorderWidth > 0 ? innerBezelBorderColor : undefined}
            strokeWidth={innerBezelBorderWidth > 0 ? innerBezelBorderWidth : undefined}
          />
        )}
        {showCircle ? (
          leverShape === 'bar' ? (
            <rect
              x={50 - barWidth / 2}
              y={50 - barHeight / 2}
              width={barWidth}
              height={barHeight}
              rx={barBorderRadius}
              fill={barColor}
              stroke={barBorderWidth > 0 ? barBorderColor : undefined}
              strokeWidth={barBorderWidth > 0 ? barBorderWidth : undefined}
            />
          ) : (
            <circle
              cx={50}
              cy={50}
              r={circleRadius}
              fill={`url(#${circleTopGradientId})`}
              stroke={circleBorderWidth > 0 ? circleBorderColor : undefined}
              strokeWidth={circleBorderWidth > 0 ? circleBorderWidth : undefined}
            />
          )
        ) : (
          <g transform={`rotate(${leverAngle} 50 50)`}>
            <path
              d={leverPath(leverLength, leverTipRadius, leverBaseRadius, leverTipDomeRy)}
              fill={leverColor}
              stroke={leverBorderWidth > 0 ? leverBorderColor : undefined}
              strokeWidth={leverBorderWidth > 0 ? leverBorderWidth : undefined}
            />
            {leverShape !== 'bar' && (
              // The same round tip as the middle-position circle above,
              // just viewed edge-on instead of head-on — foreshortened into
              // an ellipse (flattened along the lever's own axis) sitting
              // in the dome leverPath already outlines, scaled off the same
              // leverTipRadius so growing/shrinking the tip resizes this
              // along with it, shaded the same way via circleTopStyle.
              // Skipped for leverShape 'bar', which caps the tip with its
              // own flat rectangle instead.
              <ellipse cx={50} cy={leverTipCy} rx={leverTipRx} ry={leverTipRy} fill={`url(#${leverTipGradientId})`} />
            )}
            {leverShape === 'bar' && (
              <rect
                x={50 - barWidth / 2}
                y={50 - leverLength - barHeight / 2}
                width={barWidth}
                height={barHeight}
                rx={barBorderRadius}
                fill={barColor}
                stroke={barBorderWidth > 0 ? barBorderColor : undefined}
                strokeWidth={barBorderWidth > 0 ? barBorderWidth : undefined}
              />
            )}
          </g>
        )}
      </svg>
      {/* Closed cover full-size, blocking the whole switch; swapped for the
          small tab below once open — never both at once, so there's no
          pointer-events juggling on one element, just two differently-sized
          ones. Either one has to swallow the pointer gesture itself (not
          just decide the resulting click) — otherwise it'd still bubble up
          to ToggleSwitchView's own root press/release wrapper AND (in drag
          mode) this same element's ancestor .deck-toggle-switch, which owns
          the drag handlers — either would let a tap on the guard leak
          straight through to the switch it's supposed to be gating. */}
      {widget.guardEnabled && !guardOpen && (
        <div
          className="deck-toggle-switch__guard"
          style={{
            top: guardTop,
            width: widget.guardWidth ?? widget.w,
            height: widget.guardHeight ?? widget.h,
            background: guardColor,
            borderRadius: widget.guardRadius ?? 6,
            borderStyle: 'solid',
            borderWidth: widget.guardBorderWidth ?? 1,
            borderColor: guardBorderColor
          }}
          onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
          onPointerUp={interactive ? (e) => e.stopPropagation() : undefined}
          onPointerCancel={interactive ? (e) => e.stopPropagation() : undefined}
          onClick={interactive ? onGuardToggle : undefined}
        />
      )}
      {/* Open — the flipped-up cover's own hinge edge, still there to grab
          and flip back down. Deliberately small and pinned to the top
          rather than covering the switch, so it never blocks the reveal
          this whole feature exists for. */}
      {widget.guardEnabled && guardOpen && (
        <div
          className="deck-toggle-switch__guard-tab"
          style={{
            top: guardOpenTop,
            width: widget.guardWidth ?? widget.w,
            height: guardOpenHeight,
            background: guardColor,
            borderRadius: widget.guardRadius ?? 6,
            borderStyle: 'solid',
            borderWidth: widget.guardBorderWidth ?? 1,
            borderColor: guardBorderColor
          }}
          onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
          onPointerUp={interactive ? (e) => e.stopPropagation() : undefined}
          onPointerCancel={interactive ? (e) => e.stopPropagation() : undefined}
          onClick={interactive ? onGuardToggle : undefined}
        />
      )}
      </div>
    </div>
  )
}
