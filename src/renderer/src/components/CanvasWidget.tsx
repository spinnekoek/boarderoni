import { useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useWidgetDrag } from '../useWidgetDrag'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import type { ButtonWidget } from '@shared/types'

interface ResizeState {
  startX: number
  startY: number
  origW: number
  origH: number
}

export function CanvasWidget({
  widget,
  zoom,
  onContextMenu
}: {
  widget: ButtonWidget
  zoom: number
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const { selected, selectedWidgetIds, handlePointerDown, handlePointerMove, handlePointerUp } = useWidgetDrag(widget, zoom)
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)

  // Follow whichever tab is active in the properties panel — but only while
  // this is the sole selected widget, so an unselected (or multi-selected)
  // widget always shows its resting Default look.
  const isSolePreviewTarget = selected && selectedWidgetIds.length === 1 && (widget.statesEnabled ?? false)
  const previewState = isSolePreviewTarget ? (widget.states[activeStateIndex] ?? widget.states[0]) : widget.states[0]
  const resizeState = useRef<ResizeState | null>(null)
  const [resizing, setResizing] = useState(false)

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function patch(fields: Partial<ButtonWidget>): void {
    updateWidgets(widgets.map((w) => (w.id === widget.id && w.type === 'button' ? { ...w, ...fields } : w)))
  }

  function handleResizePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: widget.w, origH: widget.h }
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

    // Not tied to label content — text is allowed to overflow a widget
    // that's smaller than it needs (see .deck-button__label). The floor here
    // is purely about the grid: snapped widgets shouldn't shrink below one
    // grid cell, but with snapping off there's no such constraint.
    const minSize = snapToGrid ? gridSize : 1
    const w = Math.max(minSize, snap(resize.origW + dx))
    const h = Math.max(minSize, snap(resize.origH + dy))

    patch({ w, h })
  }

  function handleResizePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = null
    setResizing(false)
  }

  return (
    <div
      className={`canvas-widget${selected ? ' canvas-widget--selected' : ''}`}
      style={{ left: widget.x, top: widget.y, width: widget.w, height: widget.h }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={onContextMenu}
    >
      <ButtonWidgetContent widget={widget} state={previewState} interactive={false} />
      {resizing && (
        <div className="canvas-widget__size-label" style={{ transform: `scale(${1 / zoom})` }}>
          {Math.round(widget.w)} × {Math.round(widget.h)}
        </div>
      )}
      {selected && selectedWidgetIds.length === 1 && (
        <div
          className="canvas-widget__resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        />
      )}
    </div>
  )
}
