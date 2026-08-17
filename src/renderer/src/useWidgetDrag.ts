import { useRef } from 'react'
import { useDashboardStore } from './store'
import { useEditorSettings } from './settingsStore'
import { getSubDeckWidgets } from '@shared/subDecks'
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

// Selection + drag-to-move for a widget on the editor canvas.
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
  // rAF-throttles the in-flight sends below, same pattern/reasoning as
  // useAdjusterDrag's own scheduleSend — pointermove can fire far faster
  // than the WS round trip (and the server's full-dashboard broadcast +
  // disk save) can keep up with, which is what made a drag visibly lag
  // further behind the longer it ran, worse on a larger deck.
  const pendingWidgetsRef = useRef<Widget[] | null>(null)
  const rafScheduledRef = useRef(false)

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function movedWidgets(drag: DragState, dx: number, dy: number): Widget[] {
    const liveWidgets = getSubDeckWidgets(useDashboardStore.getState().dashboard, useDashboardStore.getState().editingSubDeckId)
    return liveWidgets.map((w) => {
      const origin = drag.origins.get(w.id)
      return origin ? { ...w, x: snap(origin.x + dx), y: snap(origin.y + dy) } : w
    })
  }

  // Caps outbound dashboard:update sends to ~once per frame — mirrors
  // useAdjusterDrag's scheduleSend exactly, including the final: false tag
  // that lets the server debounce its disk save on these in-flight ticks
  // (see the dashboard:update handler in main/index.ts).
  function scheduleSend(widgets: Widget[]): void {
    pendingWidgetsRef.current = widgets
    if (rafScheduledRef.current) return
    rafScheduledRef.current = true
    requestAnimationFrame(() => {
      rafScheduledRef.current = false
      const pending = pendingWidgetsRef.current
      pendingWidgetsRef.current = null
      if (pending === null) return
      updateWidgets(pending, { final: false })
    })
  }

  function handlePointerDown(e: React.PointerEvent): void {
    // Right-click is reserved for the context menu (see Canvas's
    // handleWidgetContextMenu) — left un-guarded, it would also arm a drag
    // and, via the matching pointerup, register as a plain click.
    if (e.button !== 0) return
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
    const liveWidgets = getSubDeckWidgets(useDashboardStore.getState().dashboard, useDashboardStore.getState().editingSubDeckId)
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
    if (drag.moved) scheduleSend(movedWidgets(drag, dx, dy))
  }

  function handlePointerUp(e: React.PointerEvent): void {
    e.stopPropagation()
    const drag = dragState.current
    dragState.current = null
    if (drag && drag.moved) {
      // Final, unthrottled send — guarantees the last position commits (and
      // gets its synchronous, non-debounced save) even if a scheduled rAF
      // tick from scheduleSend was still pending; dropping that stale tick
      // here (rather than letting it fire after) is why this clears
      // pendingWidgetsRef first.
      pendingWidgetsRef.current = null
      const dx = (e.clientX - drag.startX) / zoom
      const dy = (e.clientY - drag.startY) / zoom
      updateWidgets(movedWidgets(drag, dx, dy), { final: true })
    }
    if (drag && !drag.moved && drag.wasSelected) {
      selectWidget(widget.id, drag.additive ? { additive: true } : undefined)
    }
  }

  return { selected, selectedWidgetIds, handlePointerDown, handlePointerMove, handlePointerUp }
}
