import { resolveColor, type VariableMap } from './expr'
import type { BoxAppearance, ColorAppearance, MorphBlock, MorphButtonWidget, WidgetState } from './types'

function key(col: number, row: number): string {
  return `${col},${row}`
}

export interface BlockNeighbors {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

export function blockNeighbors(blocks: MorphBlock[], block: MorphBlock): BlockNeighbors {
  const blockSet = new Set(blocks.map((b) => key(b.col, b.row)))
  return {
    up: blockSet.has(key(block.col, block.row - 1)),
    down: blockSet.has(key(block.col, block.row + 1)),
    left: blockSet.has(key(block.col - 1, block.row)),
    right: blockSet.has(key(block.col + 1, block.row))
  }
}

export function neighborCount(neighbors: BlockNeighbors): number {
  return Number(neighbors.up) + Number(neighbors.down) + Number(neighbors.left) + Number(neighbors.right)
}

// Whether each side of this block currently auto-fits its same-widget
// neighbor for the given state — true only when BOTH this block's own
// autoFit is on AND the neighbor on that side (if any) also has its autoFit
// on for this state. A seam is a mutual thing: if either side opts out, the
// other side falling back to a fixed computed -1/0/0 would leave it with no
// way to actually coordinate a new look with its now-manual neighbor, so
// both sides of that seam drop to manual together.
export interface BlockMerge {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

export function blockMerge(blocks: MorphBlock[], block: MorphBlock, stateId: string): BlockMerge {
  const override = block.perState[stateId] ?? {}
  const autoFit = override.autoFit ?? true
  const blockMap = new Map(blocks.map((b) => [key(b.col, b.row), b]))

  function neighborAutoFit(dCol: number, dRow: number): boolean {
    const neighbor = blockMap.get(key(block.col + dCol, block.row + dRow))
    if (!neighbor) return false
    return (neighbor.perState[stateId] ?? {}).autoFit ?? true
  }

  return {
    up: autoFit && neighborAutoFit(0, -1),
    down: autoFit && neighborAutoFit(0, 1),
    left: autoFit && neighborAutoFit(-1, 0),
    right: autoFit && neighborAutoFit(1, 0)
  }
}

// The per-side appearance actually used to render a block in a given state:
// manual values from its perState override, with any side currently merged
// (see blockMerge above) replaced by the auto-fit values (spacing -1,
// radius 0, border 0). A side that isn't merged always falls back to the
// manual value, regardless of this block's own autoFit — there's nothing to
// compute there.
export function effectiveBlockAppearance(blocks: MorphBlock[], block: MorphBlock, stateId: string): BoxAppearance & { autoFit: boolean } {
  const override = block.perState[stateId] ?? {}
  const autoFit = override.autoFit ?? true
  const merge = blockMerge(blocks, block, stateId)

  return {
    autoFit,
    spacingTop: merge.up ? -1 : override.spacingTop,
    spacingRight: merge.right ? -1 : override.spacingRight,
    spacingBottom: merge.down ? -1 : override.spacingBottom,
    spacingLeft: merge.left ? -1 : override.spacingLeft,
    radiusTopLeft: merge.up || merge.left ? 0 : override.radiusTopLeft,
    radiusTopRight: merge.up || merge.right ? 0 : override.radiusTopRight,
    radiusBottomLeft: merge.down || merge.left ? 0 : override.radiusBottomLeft,
    radiusBottomRight: merge.down || merge.right ? 0 : override.radiusBottomRight,
    borderWidthTop: merge.up ? 0 : override.borderWidthTop,
    borderWidthRight: merge.right ? 0 : override.borderWidthRight,
    borderWidthBottom: merge.down ? 0 : override.borderWidthBottom,
    borderWidthLeft: merge.left ? 0 : override.borderWidthLeft
  }
}

// This block's fill/border color+opacity for the given state: its own
// perState override where set (colorExpr evaluated where present, same as a
// plain button's own color), falling back to the widget's own state fields
// (and from there to the same DEFAULT_WIDGET_COLOR/pickAutoBorderColor
// fallbacks a plain button already uses — left to the caller, same as
// state.color ?? DEFAULT_WIDGET_COLOR is today). Nothing here ties this to
// autoFit or block adjacency — a block's color is always either explicitly
// overridden or inherited, never computed from neighbors.
export function effectiveBlockColor(block: MorphBlock, state: WidgetState, variables: VariableMap): ColorAppearance {
  const override = block.perState[state.id] ?? {}
  return {
    color: resolveColor(override, variables) ?? resolveColor(state, variables),
    borderColor: override.borderColor ?? state.borderColor,
    backgroundOpacity: override.backgroundOpacity ?? state.backgroundOpacity,
    borderOpacity: override.borderOpacity ?? state.borderOpacity
  }
}

// Keeps a morph widget's blocks always starting at col/row 0 — i.e. (0,0) is
// always the shape's actual top-left block, not just an arbitrary anchor —
// adjusting x/y to compensate so the shape's on-screen position doesn't
// move. Without this, a shape whose remaining blocks don't start at (0,0)
// (e.g. after deleting its original base block, leaving blocks at col 2-4)
// would drift when resized: morphFootprint's x is `widget.x + minCol *
// cellW`, so with a nonzero minCol, changing cellW alone shifts the
// footprint's position too, compounding with the width change.
export function normalizeMorphBlocks(widget: MorphButtonWidget): MorphButtonWidget {
  const cols = widget.blocks.map((b) => b.col)
  const rows = widget.blocks.map((b) => b.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  if (minCol === 0 && minRow === 0) return widget
  return {
    ...widget,
    x: widget.x + minCol * widget.cellW,
    y: widget.y + minRow * widget.cellH,
    blocks: widget.blocks.map((b) => ({ ...b, col: b.col - minCol, row: b.row - minRow }))
  }
}

// A morph widget's overall rectangle — its blocks' bounding box. col/row 0
// always maps to (x, y), so a shape extended in the negative direction
// (up/left) needs its min col/row folded back in here rather than assuming
// (x, y) is the top-left block.
export function morphFootprint(widget: MorphButtonWidget): { x: number; y: number; w: number; h: number } {
  const cols = widget.blocks.map((b) => b.col)
  const rows = widget.blocks.map((b) => b.row)
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
