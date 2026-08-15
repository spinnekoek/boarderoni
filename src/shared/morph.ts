import { resolveBorderColor, resolveColor, type VariableMap } from './expr'
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
// perState override where set (colorExpr/borderColorExpr evaluated where
// present, same as a plain button's own color/border), falling back to the
// widget's own state fields — themselves resolved the same way, so a
// widget-level colorExpr/borderColorExpr still applies to blocks left on
// Auto — and from there to the same DEFAULT_WIDGET_COLOR/pickAutoBorderColor
// fallbacks a plain button already uses (left to the caller, same as
// state.color ?? DEFAULT_WIDGET_COLOR is today). Nothing here ties this to
// autoFit or block adjacency — a block's color is always either explicitly
// overridden or inherited, never computed from neighbors.
export function effectiveBlockColor(block: MorphBlock, state: WidgetState, variables: VariableMap): ColorAppearance {
  const override = block.perState[state.id] ?? {}
  const resolvedColor = resolveColor(override, variables)
  const resolvedBorder = resolveBorderColor(override, variables)
  return {
    color: resolvedColor.color ?? resolveColor(state, variables).color,
    backgroundOpacity: resolvedColor.opacity ?? override.backgroundOpacity ?? state.backgroundOpacity,
    borderColor: resolvedBorder.color ?? resolveBorderColor(state, variables).color,
    borderOpacity: resolvedBorder.opacity ?? override.borderOpacity ?? state.borderOpacity
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

// A connected shape (blocks are always connected — see MorphCanvasWidget.tsx's
// isRemovable/addBlock, which never leave a gap) is a tree, i.e. loop-free,
// iff it has exactly blocks.length - 1 edges. Counting only the right/down
// neighbor of each block (rather than all four directions) counts each edge
// once instead of twice, so no /2 or visited-pair tracking is needed.
export function hasMorphCycle(blocks: MorphBlock[]): boolean {
  const blockSet = new Set(blocks.map((b) => key(b.col, b.row)))
  let edges = 0
  for (const b of blocks) {
    if (blockSet.has(key(b.col + 1, b.row))) edges++
    if (blockSet.has(key(b.col, b.row + 1))) edges++
  }
  return edges > blocks.length - 1
}

// Single source of truth for "does this widget's slider actually do
// anything" — used for gating the Properties panel toggle, which events fire
// (see shared/widgetEvents.ts), and whether the handle renders/drags at all.
// Deliberately derived from sliderEnabled + the current shape rather than
// trying to keep sliderEnabled itself in sync (e.g. force it off) whenever a
// block edit closes a loop — a shape edit alone never needs to reach into
// the widget's own flags to stay consistent.
export function isMorphSliderActive(widget: MorphButtonWidget): boolean {
  return !!widget.sliderEnabled && widget.blocks.length >= 2 && !hasMorphCycle(widget.blocks)
}

function morphAdjacency(blocks: MorphBlock[]): Map<string, MorphBlock[]> {
  const blockByCell = new Map(blocks.map((b) => [key(b.col, b.row), b]))
  const deltas: [number, number][] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0]
  ]
  const adjacency = new Map<string, MorphBlock[]>()
  for (const block of blocks) {
    const neighbors: MorphBlock[] = []
    for (const [dCol, dRow] of deltas) {
      const neighbor = blockByCell.get(key(block.col + dCol, block.row + dRow))
      if (neighbor) neighbors.push(neighbor)
    }
    adjacency.set(block.id, neighbors)
  }
  return adjacency
}

// BFS from `startId`, returning the LAST block visited (id) and each
// visited block's parent — in an unweighted graph, BFS visits every node at
// distance d before any node at distance d+1, so the last node it ever
// visits is guaranteed to be at the maximum distance from the start. Used
// twice (see findMorphSliderPath) — that's the standard "double BFS" trick
// for finding a tree's diameter endpoints, exact for any tree (which this
// always is here, since findMorphSliderPath is only ever called once
// isMorphSliderActive has already confirmed the shape is loop-free).
function bfsFarthestId(adjacency: Map<string, MorphBlock[]>, startId: string): { farthestId: string; parents: Map<string, string | null> } {
  const parents = new Map<string, string | null>([[startId, null]])
  const queue = [startId]
  let farthestId = startId
  for (let head = 0; head < queue.length; head++) {
    farthestId = queue[head]
    for (const neighbor of adjacency.get(farthestId) ?? []) {
      if (parents.has(neighbor.id)) continue
      parents.set(neighbor.id, farthestId)
      queue.push(neighbor.id)
    }
  }
  return { farthestId, parents }
}

// The shape's own two furthest-apart blocks, and the single path between
// them — every block along the way, in order. Well-defined only for a
// loop-free shape (see isMorphSliderActive); called elsewhere only once
// that's already been confirmed.
export function findMorphSliderPath(blocks: MorphBlock[]): MorphBlock[] {
  if (blocks.length <= 1) return blocks
  const blockById = new Map(blocks.map((b) => [b.id, b]))
  const adjacency = morphAdjacency(blocks)
  const first = bfsFarthestId(adjacency, blocks[0].id)
  const second = bfsFarthestId(adjacency, first.farthestId)
  const path: MorphBlock[] = []
  for (let id: string | null = second.farthestId; id !== null; id = second.parents.get(id) ?? null) {
    const block = blockById.get(id)
    if (block) path.push(block)
  }
  return path.reverse()
}

// The slider path's blocks, as pixel centers in the widget's own local
// (footprint-relative) coordinate space — same (col - minCol) * cellW
// anchoring MorphButtonWidget.tsx's own block slotStyle uses, so these line
// up with the rendered blocks exactly.
export function morphSliderPoints(widget: MorphButtonWidget): { x: number; y: number }[] {
  const cols = widget.blocks.map((b) => b.col)
  const rows = widget.blocks.map((b) => b.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  return findMorphSliderPath(widget.blocks).map((b) => ({
    x: (b.col - minCol) * widget.cellW + widget.cellW / 2,
    y: (b.row - minRow) * widget.cellH + widget.cellH / 2
  }))
}

function morphSliderSegmentLengths(points: { x: number; y: number }[]): number[] {
  const lengths: number[] = []
  for (let i = 1; i < points.length; i++) {
    lengths.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  return lengths
}

// The point at `fraction` (0-1) of the way along the path's total arc
// length — where the handle is drawn.
export function morphSliderPointAtFraction(points: { x: number; y: number }[], fraction: number): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const lengths = morphSliderSegmentLengths(points)
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total === 0) return points[0]
  let remaining = Math.min(1, Math.max(0, fraction)) * total
  for (let i = 0; i < lengths.length; i++) {
    const segLen = lengths[i]
    if (remaining <= segLen || i === lengths.length - 1) {
      const t = segLen === 0 ? 0 : Math.min(1, remaining / segLen)
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t
      }
    }
    remaining -= segLen
  }
  return points[points.length - 1]
}

// The arc-length fraction (0-1) of whichever point on the path is closest
// to (localX, localY) — the path equivalent of useAdjusterDrag.ts's
// fractionFromEvent (which projects onto a straight track or an arc
// instead). Standard nearest-point-on-polyline: project onto each segment
// (clamped to that segment's own extent), keep the closest.
export function projectOntoMorphSliderPath(points: { x: number; y: number }[], localX: number, localY: number): number {
  if (points.length < 2) return 0
  const lengths = morphSliderSegmentLengths(points)
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total === 0) return 0

  let bestDistSq = Infinity
  let bestLengthAlong = 0
  let cumulative = 0
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    const segLen = lengths[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, ((localX - a.x) * dx + (localY - a.y) * dy) / (segLen * segLen)))
    const projX = a.x + dx * t
    const projY = a.y + dy * t
    const distSq = (localX - projX) ** 2 + (localY - projY) ** 2
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestLengthAlong = cumulative + t * segLen
    }
    cumulative += segLen
  }
  return Math.min(1, Math.max(0, bestLengthAlong / total))
}
