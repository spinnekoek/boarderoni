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

// General form of viewBoxToPixel below, for a caller whose SVG viewBox isn't
// the fixed "0 0 100 100" every other ring/dial widget uses — GaugeWidget's
// arc style computes its own viewBox per-render (see arcBoundsUnit) to fit a
// partial sweep to the widget's box, so its tick labels need the actual
// rect that render used, not a hardcoded one. Replicates the same
// preserveAspectRatio="xMidYMid meet" scale-to-fit-and-center math the SVG
// itself already does.
export function viewBoxRectToPixel(
  vx: number,
  vy: number,
  viewBox: { x: number; y: number; width: number; height: number },
  w: number,
  h: number
): { x: number; y: number } {
  const scale = Math.min(w / viewBox.width, h / viewBox.height)
  const offsetX = (w - viewBox.width * scale) / 2
  const offsetY = (h - viewBox.height * scale) / 2
  return { x: offsetX + (vx - viewBox.x) * scale, y: offsetY + (vy - viewBox.y) * scale }
}

// A ring/dial-style widget's own SVG is always `viewBox="0 0 100 100"` — by
// default it scales uniformly (preserveAspectRatio: xMidYMid meet) to stay
// undistorted regardless of the widget's own w/h, letterboxing the shorter
// axis. Detent dots/labels, being plain HTML rather than part of that SVG,
// must replicate the exact same uniform scale-and-center transform by hand
// — raw 0-100 percentages for left/top apply w and h independently and
// drift off the SVG's own shape on any non-square widget. Shared by
// DialSwitchWidget (ring detents) and ToggleSwitchWidget (per-position
// labels). Just viewBoxRectToPixel with that fixed rect baked in.
export function viewBoxToPixel(vx: number, vy: number, w: number, h: number): { x: number; y: number } {
  return viewBoxRectToPixel(vx, vy, { x: 0, y: 0, width: 100, height: 100 }, w, h)
}

// The tightest axis-aligned bounding box — in UNIT-circle terms, center
// (0,0) radius 1 — containing every point on the arc swept from startDeg to
// endDeg. An arc's x/y extremes occur only at its own two endpoints or at
// whichever cardinal angles (multiples of 90°) the sweep happens to pass
// through, so those are the only candidates that matter. Used by
// GaugeWidget's arc style to fit a partial sweep (e.g. a single quarter) to
// the widget's actual box, instead of sitting inside a viewBox sized for the
// full circle it's a slice of — see GaugeArc in GaugeWidget.tsx. Direction-
// agnostic (works whether endDeg is greater or less than startDeg) and
// tolerant of sweeps past 360° (e.g. 135..405), since it only cares about
// interior multiples of 90 between the two, however far apart they are.
export function arcBoundsUnit(startDeg: number, endDeg: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const lo = Math.min(startDeg, endDeg)
  const hi = Math.max(startDeg, endDeg)
  const candidates = [startDeg, endDeg]
  for (let k = Math.floor(lo / 90); k * 90 <= hi; k++) {
    const a = k * 90
    if (a > lo && a < hi) candidates.push(a)
  }
  const points = candidates.map((deg) => polarToCartesian(0, 0, 1, deg))
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y))
  }
}

// SVG path `d` for a closed polygon (any N >= 3 points, in order) with each
// corner cut by a quadratic-Bezier curve instead of a sharp point — a
// lightweight "rounded polygon" approximation (not true circular-arc
// corners, which would need per-vertex arc-flag math for little visible
// difference at the sizes these shapes render at). `radius` is clamped per
// vertex to at most half the length of its shorter adjacent edge, so a
// small/thin shape (e.g. a narrow triangle detent) can't self-intersect.
// Shared by DialShapeGraphic's triangle detent/indicator (both the ring
// detent's own <path> and DetentIndicatorShape's triangle branch) so a
// triangle can have a real stroke AND a border radius, neither of which a
// CSS clip-path can express (see DialShapeGraphic.tsx for why).
export function roundedPolygonPath(points: { x: number; y: number }[], radius: number): string {
  const n = points.length
  if (n < 3 || radius <= 0) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  }
  const corners = points.map((curr, i) => {
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const prevLen = Math.hypot(prev.x - curr.x, prev.y - curr.y)
    const nextLen = Math.hypot(next.x - curr.x, next.y - curr.y)
    const r = Math.min(radius, prevLen / 2, nextLen / 2)
    const a = { x: curr.x + ((prev.x - curr.x) / prevLen) * r, y: curr.y + ((prev.y - curr.y) / prevLen) * r }
    const b = { x: curr.x + ((next.x - curr.x) / nextLen) * r, y: curr.y + ((next.y - curr.y) / nextLen) * r }
    return { curr, a, b }
  })
  const start = corners[n - 1].b
  const segments = corners.map(({ curr, a, b }) => `L ${a.x} ${a.y} Q ${curr.x} ${curr.y} ${b.x} ${b.y}`)
  return `M ${start.x} ${start.y} ${segments.join(' ')} Z`
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
