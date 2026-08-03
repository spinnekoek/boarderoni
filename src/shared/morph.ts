import type { MorphButtonWidget } from './types'

// Keeps a morph widget's cells always starting at col/row 0 — i.e. (0,0) is
// always the shape's actual top-left cell, not just an arbitrary anchor —
// adjusting x/y to compensate so the shape's on-screen position doesn't
// move. Without this, a shape whose remaining cells don't start at (0,0)
// (e.g. after deleting its original base cell, leaving cells at col 2-4)
// would drift when resized: widgetFootprint's x is `widget.x + minCol *
// cellW`, so with a nonzero minCol, changing cellW alone shifts the
// footprint's position too, compounding with the width change.
export function normalizeMorphCells(widget: MorphButtonWidget): MorphButtonWidget {
  const cols = widget.cells.map((c) => c.col)
  const rows = widget.cells.map((c) => c.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  if (minCol === 0 && minRow === 0) return widget
  return {
    ...widget,
    x: widget.x + minCol * widget.cellW,
    y: widget.y + minRow * widget.cellH,
    cells: widget.cells.map((c) => ({ col: c.col - minCol, row: c.row - minRow }))
  }
}
