// Grid spacing is a pure rendering inset, not a positioning concept: each
// widget's box shrinks by `spacing` px on its left/top edge only. Since two
// touching widgets share an x/y at their common edge (one's right == the
// other's left), insetting only the left/top means adjacent widgets end up
// with exactly `spacing` px between them, without ever touching their
// stored x/y/w/h.
export function applySpacing(
  x: number,
  y: number,
  w: number,
  h: number,
  spacing: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: x + spacing,
    y: y + spacing,
    w: Math.max(0, w - spacing),
    h: Math.max(0, h - spacing)
  }
}
