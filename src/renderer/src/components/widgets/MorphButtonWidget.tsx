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

  // Percentage-based (not fixed cellW/cellH px) so the same grid-spacing
  // inset applied to the widget's outer box (see layout.ts's applySpacing)
  // shrinks the whole shape proportionally, exactly like a single
  // ButtonWidget's box shrinks today — no per-cell gap introduced.
  const cellElements = widget.cells.map((cell) => {
    const hasUp = cellSet.has(`${cell.col},${cell.row - 1}`)
    const hasDown = cellSet.has(`${cell.col},${cell.row + 1}`)
    const hasLeft = cellSet.has(`${cell.col - 1},${cell.row}`)
    const hasRight = cellSet.has(`${cell.col + 1},${cell.row}`)

    const cellStyle: React.CSSProperties = {
      left: `${((cell.col - minCol) / totalCols) * 100}%`,
      top: `${((cell.row - minRow) / totalRows) * 100}%`,
      width: `${(1 / totalCols) * 100}%`,
      height: `${(1 / totalRows) * 100}%`,
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
    <div className="deck-morph">
      {cellElements}
      <div className="deck-morph-labels">{labelElements}</div>
      {error && <span className="deck-button__error">{error}</span>}
    </div>
  )
}
