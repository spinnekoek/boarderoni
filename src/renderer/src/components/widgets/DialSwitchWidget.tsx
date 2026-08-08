import { DEFAULT_WIDGET_COLOR, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, type VariableMap } from '@shared/expr'
import type { DialSwitchWidget } from '@shared/types'
import { renderWidgetLabels } from './labels'
import { polarToCartesian } from './arcPath'

const DEFAULT_START_ANGLE = 135
const DEFAULT_END_ANGLE = 405
const DETENT_RADIUS = 40
const DETENT_DOT_RADIUS = 5
const NEEDLE_LENGTH = 30
// How far (in the same 0-100 viewBox units as everything else here) a
// position's label sits from its dot — see labelAnchorPoint below.
const LABEL_OFFSET = 12

// The dial face is an SVG with viewBox="0 0 100 100" — by default it scales
// uniformly (preserveAspectRatio: xMidYMid meet) to stay a true circle
// regardless of the widget's own w/h. The detent dots below are plain HTML,
// NOT part of that SVG, so they must replicate the exact same uniform
// scale-and-center transform by hand — using raw 0-100 percentages for
// left/top (as an earlier version did) applies w and h independently and
// drifts off the SVG's circle on any non-square widget (dots outside the
// ring on the axis that's "long," inside on the axis that's "short").
function viewBoxToPixel(vx: number, vy: number, w: number, h: number): { x: number; y: number } {
  const scale = Math.min(w, h) / 100
  return { x: w / 2 + (vx - 50) * scale, y: h / 2 + (vy - 50) * scale }
}

// Where a detent's label sits, in the same viewBox coordinate space as its
// dot (see `dot` below) — widget.labelAnchor picked wins outright, fixed to
// that one side for every position; unset means 'auto': radially outward
// along THIS detent's own angle, just past the dial's rim, so it reads
// correctly on every side of the ring without any configuration.
function labelAnchorPoint(dotVb: { x: number; y: number }, angle: number, anchor: DialSwitchWidget['labelAnchor']): { x: number; y: number } {
  if (anchor === 'top') return { x: dotVb.x, y: dotVb.y - LABEL_OFFSET }
  if (anchor === 'bottom') return { x: dotVb.x, y: dotVb.y + LABEL_OFFSET }
  if (anchor === 'left') return { x: dotVb.x - LABEL_OFFSET, y: dotVb.y }
  if (anchor === 'right') return { x: dotVb.x + LABEL_OFFSET, y: dotVb.y }
  return polarToCartesian(50, 50, DETENT_RADIUS + LABEL_OFFSET, angle)
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
  const needleTip = polarToCartesian(50, 50, NEEDLE_LENGTH, needleAngle)
  const dragMode = widget.interactionMode === 'drag'

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
        <line x1={50} y1={50} x2={needleTip.x} y2={needleTip.y} stroke={needleColor} strokeWidth={4} strokeLinecap="round" />
        <circle cx={50} cy={50} r={4} fill={needleColor} />
      </svg>
      {widget.positions.map((position, index) => {
        const angle = angleForPosition(widget, index)
        const dotVb = polarToCartesian(50, 50, DETENT_RADIUS, angle)
        const dot = viewBoxToPixel(dotVb.x, dotVb.y, widget.w, widget.h)
        const labelVb = labelAnchorPoint(dotVb, angle, widget.labelAnchor)
        const label = viewBoxToPixel(labelVb.x, labelVb.y, widget.w, widget.h)
        const resolvedColor = resolveColor(position, variables)
        const dotColor = withOpacity(resolvedColor.color ?? DEFAULT_WIDGET_COLOR, resolvedColor.opacity ?? position.backgroundOpacity ?? 1)
        const active = index === effectiveIndex
        // Only wired in tap mode (onSelect is only ever passed then) — in
        // drag mode the outer container above owns the whole gesture, and a
        // per-dot click here would fire alongside/instead of it.
        const handleSelect = interactive && onSelect ? () => onSelect(index) : undefined
        return (
          // Two independently-positioned elements, not parent/child — each
          // centered (translate -50%,-50%) on its own computed point, so the
          // label's own size (it can wrap to two lines for a long name)
          // never drags the dot's center off the ring the way nesting them
          // in one flex block used to.
          <div key={position.id}>
            <div
              className={`deck-dial-switch__detent${active ? ' deck-dial-switch__detent--active' : ''}`}
              style={{ left: dot.x, top: dot.y, width: DETENT_DOT_RADIUS * 2, height: DETENT_DOT_RADIUS * 2, background: dotColor }}
              onClick={handleSelect}
            />
            <div className="deck-dial-switch__detent-label" style={{ left: label.x, top: label.y }} onClick={handleSelect}>
              {renderWidgetLabels(position.labels, trackColor, variables)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
