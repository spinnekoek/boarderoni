import type { Widget } from '@shared/types'

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

// A widget's overall rectangle, regardless of type. For a morph widget this
// is its cells' bounding box — col/row 0 always maps to (x, y), so a shape
// extended in the negative direction (up/left) needs its min col/row folded
// back in here rather than assuming (x, y) is the top-left cell.
export function widgetFootprint(widget: Widget): { x: number; y: number; w: number; h: number } {
  if (widget.type === 'morph') {
    const cols = widget.cells.map((c) => c.col)
    const rows = widget.cells.map((c) => c.row)
    const minCol = Math.min(...cols)
    const minRow = Math.min(...rows)
    const maxCol = Math.max(...cols)
    const maxRow = Math.max(...rows)
    return {
      x: widget.x + minCol * widget.cellW,
      y: widget.y + minRow * widget.cellH,
      w: (maxCol - minCol + 1) * widget.cellW,
      h: (maxRow - minRow + 1) * widget.cellH
    }
  }
  return { x: widget.x, y: widget.y, w: widget.w, h: widget.h }
}
