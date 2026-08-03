import { useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useWidgetDrag } from '../useWidgetDrag'
import { applySpacing, widgetFootprint } from '../layout'
import { MorphButtonWidgetContent } from './widgets/MorphButtonWidget'
import type { MorphButtonWidget, MorphCell } from '@shared/types'

interface ResizeState {
  startX: number
  startY: number
  origCellW: number
  origCellH: number
}

interface ExtendSpot {
  key: string
  leftPct: number
  topPct: number
  target: MorphCell
}

// One "+" affordance per open edge of every existing cell — an empty cell
// bordering two different existing cells (e.g. the inner corner of a U)
// gets two separate spots pointing at it, which is fine: either just fills
// the same gap.
function computeExtendSpots(cells: MorphCell[]): ExtendSpot[] {
  const cellSet = new Set(cells.map((c) => `${c.col},${c.row}`))
  const cols = cells.map((c) => c.col)
  const rows = cells.map((c) => c.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  const totalCols = Math.max(...cols) - minCol + 1
  const totalRows = Math.max(...rows) - minRow + 1

  const spots: ExtendSpot[] = []
  for (const cell of cells) {
    const centerX = ((cell.col - minCol + 0.5) / totalCols) * 100
    const centerY = ((cell.row - minRow + 0.5) / totalRows) * 100
    const leftEdge = ((cell.col - minCol) / totalCols) * 100
    const rightEdge = ((cell.col - minCol + 1) / totalCols) * 100
    const topEdge = ((cell.row - minRow) / totalRows) * 100
    const bottomEdge = ((cell.row - minRow + 1) / totalRows) * 100

    if (!cellSet.has(`${cell.col},${cell.row - 1}`)) {
      spots.push({ key: `${cell.col},${cell.row}-up`, leftPct: centerX, topPct: topEdge, target: { col: cell.col, row: cell.row - 1 } })
    }
    if (!cellSet.has(`${cell.col},${cell.row + 1}`)) {
      spots.push({ key: `${cell.col},${cell.row}-down`, leftPct: centerX, topPct: bottomEdge, target: { col: cell.col, row: cell.row + 1 } })
    }
    if (!cellSet.has(`${cell.col - 1},${cell.row}`)) {
      spots.push({ key: `${cell.col},${cell.row}-left`, leftPct: leftEdge, topPct: centerY, target: { col: cell.col - 1, row: cell.row } })
    }
    if (!cellSet.has(`${cell.col + 1},${cell.row}`)) {
      spots.push({ key: `${cell.col},${cell.row}-right`, leftPct: rightEdge, topPct: centerY, target: { col: cell.col + 1, row: cell.row } })
    }
  }
  return spots
}

export function MorphCanvasWidget({ widget, zoom }: { widget: MorphButtonWidget; zoom: number }): React.JSX.Element {
  const { selected, selectedWidgetIds, handlePointerDown, handlePointerMove, handlePointerUp } = useWidgetDrag(widget, zoom)
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const spacing = useDashboardStore((s) => s.dashboard.spacing ?? 0)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)

  const resizeState = useRef<ResizeState | null>(null)
  const [resizing, setResizing] = useState(false)

  const isSolePreviewTarget = selected && selectedWidgetIds.length === 1 && (widget.statesEnabled ?? false)
  const previewState = isSolePreviewTarget ? (widget.states[activeStateIndex] ?? widget.states[0]) : widget.states[0]

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function addCell(cell: MorphCell): void {
    updateWidgets(
      widgets.map((w) => {
        if (w.id !== widget.id || w.type !== 'morph') return w
        if (w.cells.some((c) => c.col === cell.col && c.row === cell.row)) return w
        return { ...w, cells: [...w.cells, cell] }
      })
    )
  }

  function patchCellSize(cellW: number, cellH: number): void {
    updateWidgets(widgets.map((w) => (w.id === widget.id && w.type === 'morph' ? { ...w, cellW, cellH } : w)))
  }

  // Every cell shares one size, so dragging this — like a regular button's
  // resize handle — resizes all of them (and every future extension)
  // together, matching the Cell W/Cell H fields in the properties panel.
  function handleResizePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = { startX: e.clientX, startY: e.clientY, origCellW: widget.cellW, origCellH: widget.cellH }
    setResizing(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see useWidgetDrag's handlePointerDown
    }
  }

  function handleResizePointerMove(e: React.PointerEvent): void {
    e.stopPropagation()
    const resize = resizeState.current
    if (!resize) return
    const dx = (e.clientX - resize.startX) / zoom
    const dy = (e.clientY - resize.startY) / zoom

    // The handle sits at the bounding box's corner, which is totalCols/Rows
    // cells wide/tall — dividing the drag delta back down to a per-cell
    // delta keeps the corner tracking the cursor 1:1 (and reduces to a plain
    // 1:1 drag for the common single-cell case).
    const cols = widget.cells.map((c) => c.col)
    const rows = widget.cells.map((c) => c.row)
    const totalCols = Math.max(...cols) - Math.min(...cols) + 1
    const totalRows = Math.max(...rows) - Math.min(...rows) + 1

    const minSize = snapToGrid ? gridSize : 1
    patchCellSize(
      Math.max(minSize, snap(resize.origCellW + dx / totalCols)),
      Math.max(minSize, snap(resize.origCellH + dy / totalRows))
    )
  }

  function handleResizePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = null
    setResizing(false)
  }

  const footprint = widgetFootprint(widget)
  const rendered = applySpacing(footprint.x, footprint.y, footprint.w, footprint.h, spacing)
  const isSoleSelection = selected && selectedWidgetIds.length === 1

  return (
    <div
      className={`canvas-widget canvas-widget--morph${selected ? ' canvas-widget--selected' : ''}`}
      style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
    >
      <MorphButtonWidgetContent
        widget={widget}
        state={previewState}
        interactive={false}
        onCellPointerDown={handlePointerDown}
        onCellPointerMove={handlePointerMove}
        onCellPointerUp={handlePointerUp}
      />
      {resizing && (
        <div className="canvas-widget__size-label" style={{ transform: `scale(${1 / zoom})` }}>
          {Math.round(widget.cellW)} × {Math.round(widget.cellH)}
        </div>
      )}
      {isSoleSelection &&
        computeExtendSpots(widget.cells).map((spot) => (
          <button
            key={spot.key}
            type="button"
            className="canvas-widget__morph-extend"
            style={{ left: `${spot.leftPct}%`, top: `${spot.topPct}%` }}
            title="Extend shape"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              addCell(spot.target)
            }}
          >
            +
          </button>
        ))}
      {isSoleSelection && (
        <div
          className="canvas-widget__resize-handle"
          title="Drag to resize every cell"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        />
      )}
    </div>
  )
}
