import type { WidgetLabel } from '@shared/types'

// Shared SVG arc-path math for Gauge's arc style, Adjuster's knob style, and
// DialSwitchWidget/ToggleSwitchWidget's ring/pole label placement. Angles
// are degrees, 0 pointing up, increasing clockwise (SVG's y-down coordinate
// space) — matches how startAngle/endAngle read intuitively as "clock
// position" when picked in the properties panel (135° = ~4:30, 405° =
// 135+270 = ~7:30 going the long way round).

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

// SVG polygon `points` for a needle/pointer — a constant-width shaft (like
// the old stroked line) for most of its length, then tapering to a sharp
// point over the last `tipLength` units instead of ending in a round cap.
// Shared by DialSwitchWidget's needle and EncoderWidget's grip indicator so
// both read as a real pointer instead of a blunt round-capped line.
export function needlePoints(cx: number, cy: number, angleDeg: number, length: number, halfWidth: number, tipLength: number): string {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const px = -dy
  const py = dx
  const shoulder = Math.max(0, length - tipLength)
  const baseLeftX = cx + px * halfWidth
  const baseLeftY = cy + py * halfWidth
  const baseRightX = cx - px * halfWidth
  const baseRightY = cy - py * halfWidth
  const shoulderLeftX = cx + dx * shoulder + px * halfWidth
  const shoulderLeftY = cy + dy * shoulder + py * halfWidth
  const shoulderRightX = cx + dx * shoulder - px * halfWidth
  const shoulderRightY = cy + dy * shoulder - py * halfWidth
  const tipX = cx + dx * length
  const tipY = cy + dy * length
  return `${baseLeftX},${baseLeftY} ${shoulderLeftX},${shoulderLeftY} ${tipX},${tipY} ${shoulderRightX},${shoulderRightY} ${baseRightX},${baseRightY}`
}

// Builds an SVG path `d` string for the arc from startDeg to endDeg on a
// circle of radius r centered at (cx, cy). Handles sweeps past 360° (e.g.
// startAngle=135/endAngle=405, a 270° gauge sweep) by always taking the
// large-arc flag from whether the sweep exceeds 180°, not from the raw
// angle values themselves.
export function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const sweep = endDeg - startDeg
  if (Math.abs(sweep) < 0.001) return ''
  const start = polarToCartesian(cx, cy, r, startDeg)
  const end = polarToCartesian(cx, cy, r, endDeg)
  const largeArcFlag = Math.abs(sweep) > 180 ? 1 : 0
  const sweepFlag = sweep > 0 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`
}

// A ring/dial-style widget's own SVG is always `viewBox="0 0 100 100"` — by
// default it scales uniformly (preserveAspectRatio: xMidYMid meet) to stay
// undistorted regardless of the widget's own w/h, letterboxing the shorter
// axis. Detent dots/labels, being plain HTML rather than part of that SVG,
// must replicate the exact same uniform scale-and-center transform by hand
// — raw 0-100 percentages for left/top apply w and h independently and
// drift off the SVG's own shape on any non-square widget. Shared by
// DialSwitchWidget (ring detents) and ToggleSwitchWidget (per-position
// labels).
export function viewBoxToPixel(vx: number, vy: number, w: number, h: number): { x: number; y: number } {
  const scale = Math.min(w, h) / 100
  return { x: w / 2 + (vx - 50) * scale, y: h / 2 + (vy - 50) * scale }
}

// Where a label sits, in the same viewBox coordinate space as its position's
// own anchor point `dotVb` — the label's own labelAnchor (WidgetLabel field)
// wins outright, fixed to that one side; unset means 'auto': radially
// outward along THIS position's own angle, just past the ring/pole radius,
// so it reads correctly regardless of which side of the widget it falls on.
// `labelDistance` is this one label's own WidgetLabel.labelDistance (or a
// caller-supplied default if unset) — only used by the 'auto' case; a fixed
// side always offsets from `dotVb` by a plain `sideOffset`, since a side
// anchor is about dodging something nearby, not about how far out the label
// sits along the ring. Shared by DialSwitchWidget/ToggleSwitchWidget.
export function labelAnchorPoint(
  dotVb: { x: number; y: number },
  angle: number,
  ringRadius: number,
  labelDistance: number,
  anchor: WidgetLabel['labelAnchor'],
  sideOffset: number
): { x: number; y: number } {
  if (anchor === 'top') return { x: dotVb.x, y: dotVb.y - sideOffset }
  if (anchor === 'bottom') return { x: dotVb.x, y: dotVb.y + sideOffset }
  if (anchor === 'left') return { x: dotVb.x - sideOffset, y: dotVb.y }
  if (anchor === 'right') return { x: dotVb.x + sideOffset, y: dotVb.y }
  return polarToCartesian(50, 50, ringRadius + labelDistance, angle)
}
