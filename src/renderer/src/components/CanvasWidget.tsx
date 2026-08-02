import { useRef } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import type { Widget } from '@shared/types'

const DRAG_THRESHOLD = 3
const MIN_SIZE = 20

interface DragState {
  startX: number
  startY: number
  origX: number
  origY: number
  moved: boolean
}

interface ResizeState {
  startX: number
  startY: number
  origW: number
  origH: number
}

export function CanvasWidget({ widget, zoom }: { widget: Widget; zoom: number }): React.JSX.Element {
  const selectedWidgetId = useDashboardStore((s) => s.selectedWidgetId)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)

  const selected = widget.id === selectedWidgetId
  const dragState = useRef<DragState | null>(null)
  const resizeState = useRef<ResizeState | null>(null)

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function patch(fields: Partial<Widget>): void {
    updateWidgets(widgets.map((w) => (w.id === widget.id ? { ...w, ...fields } : w)))
  }

  function handlePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: widget.x, origY: widget.y, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture is best-effort (keeps drag tracking outside the element's
      // bounds); a failure here shouldn't stop the drag from working
    }
  }

  function handlePointerMove(e: React.PointerEvent): void {
    e.stopPropagation()
    const drag = dragState.current
    if (!drag) return
    const dx = (e.clientX - drag.startX) / zoom
    const dy = (e.clientY - drag.startY) / zoom
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true
    if (drag.moved) {
      patch({ x: snap(drag.origX + dx), y: snap(drag.origY + dy) })
    }
  }

  function handlePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    const moved = dragState.current?.moved
    dragState.current = null
    if (!moved) selectWidget(widget.id)
  }

  function handleResizePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: widget.w, origH: widget.h }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see handlePointerDown
    }
  }

  function handleResizePointerMove(e: React.PointerEvent): void {
    e.stopPropagation()
    const resize = resizeState.current
    if (!resize) return
    const dx = (e.clientX - resize.startX) / zoom
    const dy = (e.clientY - resize.startY) / zoom
    patch({ w: Math.max(MIN_SIZE, snap(resize.origW + dx)), h: Math.max(MIN_SIZE, snap(resize.origH + dy)) })
  }

  function handleResizePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = null
  }

  return (
    <div
      className={`canvas-widget${selected ? ' canvas-widget--selected' : ''}`}
      style={{ left: widget.x, top: widget.y, width: widget.w, height: widget.h }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <ButtonWidgetContent widget={widget} interactive={false} />
      {selected && (
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
