import { useRef } from 'react'
import { useDashboardStore } from './store'
import { useEditorSettings } from './settingsStore'
import type { Widget } from '@shared/types'

const DRAG_THRESHOLD = 3

interface DragState {
  startX: number
  startY: number
  origins: Map<string, { x: number; y: number }>
  moved: boolean
  additive: boolean
  wasSelected: boolean
}

// Selection + drag-to-move for a widget on the editor canvas — shared by
// CanvasWidget and MorphCanvasWidget since "move the whole thing by
// translating x/y, respecting multi-select group drag" is identical
// regardless of a widget's shape. Resizing/shape-editing stays owned by each
// widget type's own component.
export function useWidgetDrag(
  widget: Widget,
  zoom: number
): {
  selected: boolean
  selectedWidgetIds: string[]
  handlePointerDown: (e: React.PointerEvent) => void
  handlePointerMove: (e: React.PointerEvent) => void
  handlePointerUp: (e: React.PointerEvent) => void
} {
  const selectedWidgetIds = useDashboardStore((s) => s.selectedWidgetIds)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)

  const selected = selectedWidgetIds.includes(widget.id)
  const dragState = useRef<DragState | null>(null)

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function handlePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const wasSelected = selectedWidgetIds.includes(widget.id)

    // Changing selection here (rather than deferring to pointer-up) lets the
    // drag below immediately pick up the right group of origins. If the
    // widget is already part of the current selection we leave it alone so a
    // drag moves the whole group; the click-vs-drag distinction is then
    // resolved on pointer-up (collapse/toggle only when nothing moved).
    if (!wasSelected) {
      selectWidget(widget.id, additive ? { additive: true } : undefined)
    }

    const activeIds = useDashboardStore.getState().selectedWidgetIds
    const liveWidgets = useDashboardStore.getState().dashboard.widgets
    const origins = new Map(
      activeIds.map((id) => {
        const w = liveWidgets.find((ww) => ww.id === id)
        return [id, { x: w?.x ?? 0, y: w?.y ?? 0 }]
      })
    )

    dragState.current = { startX: e.clientX, startY: e.clientY, origins, moved: false, additive, wasSelected }
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
      const liveWidgets = useDashboardStore.getState().dashboard.widgets
      updateWidgets(
        liveWidgets.map((w) => {
          const origin = drag.origins.get(w.id)
          return origin ? { ...w, x: snap(origin.x + dx), y: snap(origin.y + dy) } : w
        })
      )
    }
  }

  function handlePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    const drag = dragState.current
    dragState.current = null
    if (drag && !drag.moved && drag.wasSelected) {
      selectWidget(widget.id, drag.additive ? { additive: true } : undefined)
    }
  }

  return { selected, selectedWidgetIds, handlePointerDown, handlePointerMove, handlePointerUp }
}
