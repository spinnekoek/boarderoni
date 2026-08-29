import { useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore, useGridSize } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useWidgetDrag } from '../useWidgetDrag'
import { morphFootprint, normalizeMorphBlocks, blockNeighbors, neighborCount } from '@shared/morph'
import { getSubDeckWidgets } from '@shared/subDecks'
import { nextId } from '../id'
import { MorphButtonWidgetContent } from './widgets/MorphButtonWidget'
import { resolveNumericExpr, resolveWidgetVisible, type VariableMap } from '@shared/expr'
import type { MorphBlock, MorphButtonWidget, MorphCell } from '@shared/types'

interface ResizeState {
  startX: number
  startY: number
  origCellW: number
  origCellH: number
}

interface EdgeSpot {
  key: string
  leftPct: number
  topPct: number
  source: MorphBlock
  target: MorphCell
}

// One "+"/"−" affordance per open edge of every existing block — an empty
// slot bordering two different existing blocks (e.g. the inner corner of a
// U) gets two separate spots pointing at it, which is fine: either just
// fills the same gap. Each spot stays anchored to the existing block it
// came from (`source`) even in remove mode, where it acts on that block
// instead of the empty `target` it points at — see the Ctrl-held branch
// below for why removal only reuses a subset of these.
function computeEdgeSpots(blocks: MorphBlock[]): EdgeSpot[] {
  const blockSet = new Set(blocks.map((b) => `${b.col},${b.row}`))
  const cols = blocks.map((b) => b.col)
  const rows = blocks.map((b) => b.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  const totalCols = Math.max(...cols) - minCol + 1
  const totalRows = Math.max(...rows) - minRow + 1

  const spots: EdgeSpot[] = []
  for (const block of blocks) {
    const centerX = ((block.col - minCol + 0.5) / totalCols) * 100
    const centerY = ((block.row - minRow + 0.5) / totalRows) * 100
    const leftEdge = ((block.col - minCol) / totalCols) * 100
    const rightEdge = ((block.col - minCol + 1) / totalCols) * 100
    const topEdge = ((block.row - minRow) / totalRows) * 100
    const bottomEdge = ((block.row - minRow + 1) / totalRows) * 100

    if (!blockSet.has(`${block.col},${block.row - 1}`)) {
      spots.push({ key: `${block.col},${block.row}-up`, leftPct: centerX, topPct: topEdge, source: block, target: { col: block.col, row: block.row - 1 } })
    }
    if (!blockSet.has(`${block.col},${block.row + 1}`)) {
      spots.push({ key: `${block.col},${block.row}-down`, leftPct: centerX, topPct: bottomEdge, source: block, target: { col: block.col, row: block.row + 1 } })
    }
    if (!blockSet.has(`${block.col - 1},${block.row}`)) {
      spots.push({ key: `${block.col},${block.row}-left`, leftPct: leftEdge, topPct: centerY, source: block, target: { col: block.col - 1, row: block.row } })
    }
    if (!blockSet.has(`${block.col + 1},${block.row}`)) {
      spots.push({ key: `${block.col},${block.row}-right`, leftPct: rightEdge, topPct: centerY, source: block, target: { col: block.col + 1, row: block.row } })
    }
  }
  return spots
}

// A block is only safe to remove here if it has at most one same-widget
// neighbor ("tips" of the shape) — a block with two or more neighbors is
// load-bearing for the shape's connectivity (e.g. the middle of a long
// strip), and removing it would split the widget into two disjoint pieces.
// Also false once there's only one block left: a morph widget always needs
// at least one.
function isRemovable(blocks: MorphBlock[], block: MorphBlock): boolean {
  if (blocks.length <= 1) return false
  return neighborCount(blockNeighbors(blocks, block)) <= 1
}

// Holding Control while a morph widget is selected swaps its extend (+)
// handles for remove (−) handles. Only the sole-selected widget ever renders
// any handles, so a plain per-component listener is enough — no need to
// share this across instances.
function useCtrlHeld(): boolean {
  const [ctrlHeld, setCtrlHeld] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Control') setCtrlHeld(true)
    }
    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key === 'Control') setCtrlHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  return ctrlHeld
}

export function MorphCanvasWidget({
  widget,
  zoom,
  variables,
  onContextMenu
}: {
  widget: MorphButtonWidget
  zoom: number
  variables: VariableMap
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const { selected, selectedWidgetIds, handlePointerDown, handlePointerMove, handlePointerUp } = useWidgetDrag(widget, zoom)
  const rootWidgets = useDashboardStore((s) => s.dashboard.widgets)
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks)
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  const widgets = useMemo(
    () => getSubDeckWidgets({ widgets: rootWidgets, subDecks }, editingSubDeckId),
    [rootWidgets, subDecks, editingSubDeckId]
  )
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const selectedBlockId = useDashboardStore((s) => s.selectedBlockId)
  const selectBlock = useDashboardStore((s) => s.selectBlock)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useGridSize()

  const resizeState = useRef<ResizeState | null>(null)
  const [resizing, setResizing] = useState(false)
  const ctrlHeld = useCtrlHeld()

  const isSolePreviewTarget = selected && selectedWidgetIds.length === 1 && (widget.statesEnabled ?? false)
  const previewState = isSolePreviewTarget ? (widget.states[activeStateIndex] ?? widget.states[0]) : widget.states[0]

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function addBlock(cell: MorphCell): void {
    updateWidgets(
      widgets.map((w) => {
        if (w.id !== widget.id || w.type !== 'morph') return w
        if (w.blocks.some((b) => b.col === cell.col && b.row === cell.row)) return w
        return normalizeMorphBlocks({ ...w, blocks: [...w.blocks, { id: nextId(), col: cell.col, row: cell.row, perState: {} }] })
      })
    )
  }

  function removeBlock(block: MorphBlock): void {
    updateWidgets(
      widgets.map((w) => {
        if (w.id !== widget.id || w.type !== 'morph') return w
        if (w.blocks.length <= 1) return w
        return normalizeMorphBlocks({ ...w, blocks: w.blocks.filter((b) => b.id !== block.id) })
      })
    )
  }

  function patchCellSize(cellW: number, cellH: number): void {
    updateWidgets(widgets.map((w) => (w.id === widget.id && w.type === 'morph' ? { ...w, cellW, cellH } : w)))
  }

  // Every block shares one size, so dragging this — like a regular button's
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
    // blocks wide/tall — dividing the drag delta back down to a per-block
    // delta keeps the corner tracking the cursor 1:1 (and reduces to a plain
    // 1:1 drag for the common single-block case).
    const cols = widget.blocks.map((b) => b.col)
    const rows = widget.blocks.map((b) => b.row)
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

  const footprint = morphFootprint(widget)
  const isSoleSelection = selected && selectedWidgetIds.length === 1
  const edgeSpots = computeEdgeSpots(widget.blocks)
  // See CanvasWidget's own comment on the same call — dims rather than
  // hides, so the widget stays selectable/editable, and evaluates the same
  // expression the deployed view does so a visibleExpr's console.log
  // reaches the debug panel while editing.
  const visible = resolveWidgetVisible(widget, variables)

  return (
    <div
      className={`canvas-widget canvas-widget--morph${selected ? ' canvas-widget--selected' : ''}${visible ? '' : ' canvas-widget--hidden'}`}
      style={{ left: footprint.x, top: footprint.y, width: footprint.w, height: footprint.h }}
    >
      <MorphButtonWidgetContent
        widget={widget}
        state={previewState}
        interactive={false}
        variables={variables}
        // Static (no drag hook here — this is the non-interactive editor
        // preview) rest position, same fallback-to-0 as MorphView's live
        // version in ViewCanvas.tsx.
        sliderFraction={widget.valueExpr ? (resolveNumericExpr(widget.valueExpr, variables) ?? 0) / 100 : 0}
        selectedBlockId={isSoleSelection ? selectedBlockId : null}
        onCellPointerDown={handlePointerDown}
        onCellPointerMove={handlePointerMove}
        onCellPointerUp={handlePointerUp}
        onCellContextMenu={onContextMenu}
        // isSoleSelection here reflects selection state as of the render
        // before this click (selected/selectedWidgetIds come from
        // useWidgetDrag, which reads the store at render time) — same
        // "wasSelected" idea useWidgetDrag itself uses. So: a click that's
        // also the click selecting this widget leaves it at the top
        // (widget-level) selection, with no block picked yet; a second
        // click, now that the widget is already sole-selected, picks a
        // block; and clicking that same block again drops back to the
        // top-level (block deselected, widget stays selected) rather than
        // switching to some other block.
        onBlockSelect={(block) => {
          if (!isSoleSelection) return
          selectBlock(selectedBlockId === block.id ? null : block.id)
        }}
      />
      {resizing && (
        <div className="canvas-widget__size-label" style={{ transform: `scale(${1 / zoom})` }}>
          {Math.round(widget.cellW)} × {Math.round(widget.cellH)}
        </div>
      )}
      {isSoleSelection && !ctrlHeld &&
        edgeSpots.map((spot) => (
          <button
            key={spot.key}
            type="button"
            className="canvas-widget__morph-extend"
            // The translate centers the button on its target spot (its
            // CSS counterpart moved here since inline style replaces the
            // whole `transform` property rather than merging with it); the
            // scale counteracts canvas zoom so it stays a constant screen
            // size, same trick as the resize handle below.
            style={{ left: `${spot.leftPct}%`, top: `${spot.topPct}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
            title="Extend shape"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              addBlock(spot.target)
            }}
          >
            +
          </button>
        ))}
      {isSoleSelection && ctrlHeld &&
        edgeSpots
          .filter((spot) => isRemovable(widget.blocks, spot.source))
          .map((spot) => (
            <button
              key={spot.key}
              type="button"
              className="canvas-widget__morph-extend canvas-widget__morph-extend--remove"
              style={{ left: `${spot.leftPct}%`, top: `${spot.topPct}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
              title="Remove block"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                removeBlock(spot.source)
              }}
            >
              −
            </button>
          ))}
      {isSoleSelection && (
        <div
          className="canvas-widget__resize-handle"
          title="Drag to resize every block"
          style={{ transform: `scale(${1 / zoom})` }}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        />
      )}
    </div>
  )
}
