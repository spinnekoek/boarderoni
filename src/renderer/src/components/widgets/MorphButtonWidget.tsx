import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, withOpacity } from '@shared/color'
import type { MorphButtonWidget, WidgetState } from '@shared/types'
import { renderWidgetLabels } from './labels'

export function MorphButtonWidgetContent({
  widget,
  state,
  interactive,
  spacing,
  error,
  onTrigger,
  onPress,
  onRelease,
  onCellPointerDown,
  onCellPointerMove,
  onCellPointerUp
}: {
  widget: MorphButtonWidget
  state: WidgetState
  interactive: boolean
  // Grid spacing (dashboard.spacing), applied per cell/per side below — see
  // the comment on cellElements for why this can't just shrink the whole
  // bounding box the way a single ButtonWidget's box does.
  spacing: number
  error?: string
  onTrigger?: () => void
  onPress?: () => void
  onRelease?: () => void
  // Editor-only (non-interactive) selection/drag handlers — attached per
  // cell rather than to one bounding-box wrapper, so an empty notch cell
  // never steals a click meant for some other widget placed behind it.
  onCellPointerDown?: (e: React.PointerEvent) => void
  onCellPointerMove?: (e: React.PointerEvent) => void
  onCellPointerUp?: (e: React.PointerEvent) => void
}): React.JSX.Element {
  const backgroundColor = state.color ?? DEFAULT_WIDGET_COLOR
  const borderColor = state.borderColor ?? pickAutoBorderColor(backgroundColor)
  const bg = withOpacity(backgroundColor, state.backgroundOpacity ?? 1)
  const border = withOpacity(borderColor, state.borderOpacity ?? 1)

  const cellSet = new Set(widget.cells.map((c) => `${c.col},${c.row}`))
  const cols = widget.cells.map((c) => c.col)
  const rows = widget.cells.map((c) => c.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  const totalCols = Math.max(...cols) - minCol + 1
  const totalRows = Math.max(...rows) - minRow + 1

  // Every cell's inset is purely its own — no row/column aggregation.
  // Aggregating top-inset per row (so a bar's middle cell aligns flush with
  // its corners, which connect up into their legs and so never inset) was
  // tried, but a cell's inset is the same number that reserves its spacing
  // from anything external resting above it — flush-aligning the whole row
  // to the corners means the corners' "no spacing, I connect to my own leg"
  // requirement spreads to the entire row, so nothing placed on top of a
  // bar (anywhere along it, not just above the corners) gets any spacing
  // reserved at all. That's worse than the 1-2px cosmetic step this
  // produces at a bar's corners, so back to plain per-cell — matching how
  // left-inset already works (see the cross-widget spacing note below).
  //
  // Fixed pixel offsets (not percentages of the bounding box) — a
  // percentage-of-bounding-box shrink would only give a multi-cell shape a
  // spacing/totalCols-sized gap instead of a full one, and that fraction
  // changes with cell count — inconsistent with a plain ButtonWidget's (and
  // any differently-sized morph shape's) full shrink, which is exactly what
  // produced the overlap/gap mismatch between two touching shapes at
  // spacing > 0.
  // Same-widget cells that connect are the same solid color with no border
  // between them, but they're still two separate elements — Electron and an
  // Android WebView are different rendering engines, and even when both
  // cells' edges compute to the exact same CSS position, each can
  // independently round to a different device pixel, leaving a hairline
  // gap on one platform but not the other. Extending a cell's box by a
  // pixel into a same-widget neighbor it connects to is invisible (same
  // fill, no border there) and absorbs that rounding difference instead of
  // showing it.
  const SEAM_OVERLAP = 1

  const cellElements = widget.cells.map((cell) => {
    const hasUp = cellSet.has(`${cell.col},${cell.row - 1}`)
    const hasDown = cellSet.has(`${cell.col},${cell.row + 1}`)
    const hasLeft = cellSet.has(`${cell.col - 1},${cell.row}`)
    const hasRight = cellSet.has(`${cell.col + 1},${cell.row}`)

    const insetLeft = hasLeft ? 0 : spacing
    const insetTop = hasUp ? 0 : spacing

    let left = (cell.col - minCol) * widget.cellW + insetLeft
    let top = (cell.row - minRow) * widget.cellH + insetTop
    let width = Math.max(0, widget.cellW - insetLeft)
    let height = Math.max(0, widget.cellH - insetTop)

    if (hasLeft) {
      left -= SEAM_OVERLAP
      width += SEAM_OVERLAP
    }
    if (hasRight) width += SEAM_OVERLAP
    if (hasUp) {
      top -= SEAM_OVERLAP
      height += SEAM_OVERLAP
    }
    if (hasDown) height += SEAM_OVERLAP

    const cellStyle: React.CSSProperties = {
      left,
      top,
      width,
      height,
      backgroundColor: bg,
      borderTop: hasUp ? 'none' : `1px solid ${border}`,
      borderBottom: hasDown ? 'none' : `1px solid ${border}`,
      borderLeft: hasLeft ? 'none' : `1px solid ${border}`,
      borderRight: hasRight ? 'none' : `1px solid ${border}`
    }

    const key = `${cell.col},${cell.row}`

    if (interactive) {
      return (
        <button
          key={key}
          className="deck-morph-cell"
          style={cellStyle}
          title={widget.action.keys.join(' + ')}
          onClick={onTrigger}
          onPointerDown={(e) => {
            onPress?.()
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              // best-effort, see CanvasWidget's handlePointerDown
            }
          }}
          onPointerUp={() => onRelease?.()}
          onPointerCancel={() => onRelease?.()}
          onPointerLeave={() => onRelease?.()}
        />
      )
    }

    return (
      <div
        key={key}
        className="deck-morph-cell deck-morph-cell--static"
        style={cellStyle}
        onPointerDown={onCellPointerDown}
        onPointerMove={onCellPointerMove}
        onPointerUp={onCellPointerUp}
      />
    )
  })

  const labelElements = renderWidgetLabels(state.labels, backgroundColor)

  return (
    <div className="deck-morph" style={{ width: totalCols * widget.cellW, height: totalRows * widget.cellH }}>
      {cellElements}
      <div className="deck-morph-labels">{labelElements}</div>
      {error && <span className="deck-button__error">{error}</span>}
    </div>
  )
}
