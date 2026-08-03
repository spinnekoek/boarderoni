import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, withOpacity } from '@shared/color'
import type { MorphButtonWidget, WidgetState } from '@shared/types'
import { renderWidgetLabels } from './labels'

// Matches .deck-button's border-radius in styles.css — kept as a literal
// here (not a shared constant/CSS var) since it's the only value that needs
// to flow into JS for the outer-corners-only rounding logic below.
const CELL_RADIUS = 8

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

  // Fixed pixel offsets (not percentages of the bounding box), each cell
  // inset by the full `spacing` on whichever of its top/left sides face
  // outward (no same-widget neighbor there) and none on sides that touch
  // another cell of this widget. A percentage-of-bounding-box shrink would
  // only give a multi-cell shape a spacing/totalCols-sized gap instead of a
  // full one, and that fraction changes with cell count — inconsistent with
  // a plain ButtonWidget's (and any differently-sized morph shape's) full
  // shrink, which is exactly what produced the overlap/gap mismatch between
  // two touching shapes at spacing > 0.
  const cellElements = widget.cells.map((cell) => {
    const hasUp = cellSet.has(`${cell.col},${cell.row - 1}`)
    const hasDown = cellSet.has(`${cell.col},${cell.row + 1}`)
    const hasLeft = cellSet.has(`${cell.col - 1},${cell.row}`)
    const hasRight = cellSet.has(`${cell.col + 1},${cell.row}`)

    const insetLeft = hasLeft ? 0 : spacing
    const insetTop = hasUp ? 0 : spacing

    const cellStyle: React.CSSProperties = {
      left: (cell.col - minCol) * widget.cellW + insetLeft,
      top: (cell.row - minRow) * widget.cellH + insetTop,
      width: Math.max(0, widget.cellW - insetLeft),
      height: Math.max(0, widget.cellH - insetTop),
      backgroundColor: bg,
      borderTop: hasUp ? 'none' : `1px solid ${border}`,
      borderBottom: hasDown ? 'none' : `1px solid ${border}`,
      borderLeft: hasLeft ? 'none' : `1px solid ${border}`,
      borderRight: hasRight ? 'none' : `1px solid ${border}`,
      borderTopLeftRadius: !hasUp && !hasLeft ? CELL_RADIUS : 0,
      borderTopRightRadius: !hasUp && !hasRight ? CELL_RADIUS : 0,
      borderBottomLeftRadius: !hasDown && !hasLeft ? CELL_RADIUS : 0,
      borderBottomRightRadius: !hasDown && !hasRight ? CELL_RADIUS : 0
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
