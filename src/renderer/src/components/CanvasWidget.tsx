import { useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { applySpacing } from '../layout'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
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

interface ResizeState {
  startX: number
  startY: number
  origW: number
  origH: number
}

export function CanvasWidget({ widget, zoom }: { widget: Widget; zoom: number }): React.JSX.Element {
  const selectedWidgetIds = useDashboardStore((s) => s.selectedWidgetIds)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const spacing = useDashboardStore((s) => s.dashboard.spacing ?? 0)
  const activeStateIndex = useDashboardStore((s) => s.activeStateIndex)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)

  const selected = selectedWidgetIds.includes(widget.id)
  // Follow whichever tab is active in the properties panel — but only while
  // this is the sole selected widget, so an unselected (or multi-selected)
  // widget always shows its resting Default look.
  const isSolePreviewTarget = selected && selectedWidgetIds.length === 1 && (widget.statesEnabled ?? false)
  const previewState = isSolePreviewTarget ? (widget.states[activeStateIndex] ?? widget.states[0]) : widget.states[0]
  const dragState = useRef<DragState | null>(null)
  const resizeState = useRef<ResizeState | null>(null)
  const [resizing, setResizing] = useState(false)

  function snap(value: number): number {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)
  }

  function patch(fields: Partial<Widget>): void {
    updateWidgets(widgets.map((w) => (w.id === widget.id ? { ...w, ...fields } : w)))
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

  function handleResizePointerDown(e: React.PointerEvent): void {
    e.stopPropagation()
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: widget.w, origH: widget.h }
    setResizing(true)
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

  const rendered = applySpacing(widget.x, widget.y, widget.w, widget.h, spacing)

  return (
    <div
      className={`canvas-widget${selected ? ' canvas-widget--selected' : ''}`}
      style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
