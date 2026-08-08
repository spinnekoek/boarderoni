// Shared SVG arc-path math for Gauge's arc style and Adjuster's knob style.
// Angles are degrees, 0 pointing right, increasing clockwise (SVG's y-down
// coordinate space) — matches how startAngle/endAngle read intuitively as
// "clock position" when picked in the properties panel (135° = ~4:30,
// 405° = 135+270 = ~7:30 going the long way round).

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
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
