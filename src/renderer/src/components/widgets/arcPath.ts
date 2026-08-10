// Shared SVG arc-path math for Gauge's arc style and Adjuster's knob style.
// Angles are degrees, 0 pointing right, increasing clockwise (SVG's y-down
// coordinate space) — matches how startAngle/endAngle read intuitively as
// "clock position" when picked in the properties panel (135° = ~4:30,
// 405° = 135+270 = ~7:30 going the long way round).

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
