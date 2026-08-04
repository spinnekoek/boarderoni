import { useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { useEditorShortcuts } from '../useEditorShortcuts'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { morphFootprint } from '@shared/morph'
import { toVariableMap } from '@shared/expr'
import { CanvasWidget } from './CanvasWidget'
import { MorphCanvasWidget } from './MorphCanvasWidget'
import { ContextMenu } from './ContextMenu'
import { DEVICE_PRESETS } from '../devicePresets'
import { displayDeviceName } from '@shared/deviceName'

interface Camera {
  x: number
  y: number
  zoom: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const INITIAL_CAMERA: Camera = { x: 80, y: 80, zoom: 1 }
const PAN_THRESHOLD = 3

interface PanState {
  startX: number
  startY: number
  camX: number
  camY: number
  moved: boolean
}

interface ContextMenuState {
  x: number
  y: number
  widgetIds: string[] | null
}

interface WorldPoint {
  x: number
  y: number
}

interface MarqueeState {
  start: WorldPoint
  current: WorldPoint
}

export function Canvas(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const backgroundColor = useDashboardStore((s) => s.dashboard.backgroundColor)
  const backgroundImageVersion = useDashboardStore((s) => s.dashboard.backgroundImageVersion)
  const backgroundFit = useDashboardStore((s) => s.dashboard.backgroundFit)
  const backgroundAnchor = useDashboardStore((s) => s.dashboard.backgroundAnchor)
  const devices = useDashboardStore((s) => s.devices)
  const variables = useDashboardStore((s) => s.dashboard.variables)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const selectWidgets = useDashboardStore((s) => s.selectWidgets)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const selectedDeviceId = useEditorSettings((s) => s.selectedDeviceId)

  useEditorShortcuts()

  const variableMap = useMemo(() => toVariableMap(variables ?? []), [variables])

  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const panState = useRef<PanState | null>(null)

  // Converts a viewport-relative screen point into the same world space
  // widget x/y/w/h live in — inverse of the canvas-layer's own translate+
  // scale transform (see handleWheel below for the matching forward math).
  function screenToWorld(clientX: number, clientY: number): WorldPoint {
    const rect = viewportRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - camera.x) / camera.zoom,
      y: (clientY - rect.top - camera.y) / camera.zoom
    }
  }

  function handleBackgroundPointerDown(e: React.PointerEvent): void {
    // Right-click opens the context menu instead (see handleBackgroundContextMenu) — left un-guarded, it would also arm a pan.
    if (e.button !== 0) return
    if (e.shiftKey) {
      const point = screenToWorld(e.clientX, e.clientY)
      setMarquee({ start: point, current: point })
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // best-effort, see CanvasWidget's handlePointerDown
      }
      return
    }
    panState.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
  }

  function handleBackgroundContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, widgetIds: null })
  }

  // Right-clicking a widget that's already part of the current multi-select
  // keeps the whole selection (so the menu's actions apply to all of it);
  // right-clicking anything else collapses selection down to just that one,
  // matching how a plain click would.
  function handleWidgetContextMenu(e: React.MouseEvent, widgetId: string): void {
    e.preventDefault()
    e.stopPropagation()
    const { selectedWidgetIds } = useDashboardStore.getState()
    if (!selectedWidgetIds.includes(widgetId)) selectWidget(widgetId)
    setContextMenu({ x: e.clientX, y: e.clientY, widgetIds: useDashboardStore.getState().selectedWidgetIds })
  }

  function handleBackgroundPointerMove(e: React.PointerEvent): void {
    if (marquee) {
      setMarquee((m) => (m ? { ...m, current: screenToWorld(e.clientX, e.clientY) } : m))
      return
    }
    const pan = panState.current
    if (!pan) return
    const dx = e.clientX - pan.startX
    const dy = e.clientY - pan.startY
    if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) pan.moved = true
    if (pan.moved) setCamera((c) => ({ ...c, x: pan.camX + dx, y: pan.camY + dy }))
  }

  function handleBackgroundPointerUp(): void {
    if (marquee) {
      const left = Math.min(marquee.start.x, marquee.current.x)
      const right = Math.max(marquee.start.x, marquee.current.x)
      const top = Math.min(marquee.start.y, marquee.current.y)
      const bottom = Math.max(marquee.start.y, marquee.current.y)
      const ids = widgets
        .filter((widget) => {
          const box = widget.type === 'morph' ? morphFootprint(widget) : widget
          return box.x < right && box.x + box.w > left && box.y < bottom && box.y + box.h > top
        })
        .map((widget) => widget.id)
      selectWidgets(ids, { additive: true })
      setMarquee(null)
      return
    }
    // Only deselect for a pointerup this element's own pointerdown actually
    // started (panState set) — otherwise an interactive child that stops
    // propagation on pointerdown/click but not pointerup would bubble its
    // release here and get incorrectly treated as "clicked empty background."
    const pan = panState.current
    panState.current = null
    if (pan && !pan.moved) selectWidget(null)
  }

  function handleWheel(e: React.WheelEvent): void {
    e.preventDefault()
    const rect = viewportRef.current!.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.001)

    setCamera((c) => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor))
      const worldX = (cursorX - c.x) / c.zoom
      const worldY = (cursorY - c.y) / c.zoom
      return { zoom: newZoom, x: cursorX - worldX * newZoom, y: cursorY - worldY * newZoom }
    })
  }

  const activePreset = DEVICE_PRESETS.find((d) => d.id === selectedDeviceId)
  const activeConnected = devices.find((d) => d.id === selectedDeviceId)
  const activeDevice = activePreset ?? activeConnected ?? DEVICE_PRESETS[0]
  const activeDeviceLabel = activePreset?.label ?? (activeConnected ? displayDeviceName(activeConnected) : DEVICE_PRESETS[0].label)
  const connectedCount = devices.filter((d) => d.connected).length

  return (
    <div className="canvas-viewport" ref={viewportRef} onWheel={handleWheel}>
      <div className="canvas-toolbar">
        <span className="canvas-toolbar__zoom">{Math.round(camera.zoom * 100)}%</span>
        <button className="canvas-toolbar__button" onClick={() => setCamera(INITIAL_CAMERA)}>
          Reset view
        </button>
        <span className="canvas-toolbar__devices">
          {connectedCount === 0 ? 'No devices connected' : `${connectedCount} device${connectedCount > 1 ? 's' : ''} connected`}
        </span>
        <span className="canvas-toolbar__hint">Scroll to zoom · drag empty space to pan · hold Shift and drag to box-select</span>
      </div>
      <div
        className="canvas-background"
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        onContextMenu={handleBackgroundContextMenu}
        style={
          snapToGrid
            ? {
                backgroundColor,
                backgroundSize: `${gridSize * camera.zoom}px ${gridSize * camera.zoom}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`
              }
            : { backgroundColor, backgroundImage: 'none' }
        }
      >
        <div className="canvas-layer" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          <div className="canvas-device-bounds" style={{ width: activeDevice.width, height: activeDevice.height }}>
            <span className="canvas-device-bounds__label">
              {activeDeviceLabel} — {activeDevice.width}×{activeDevice.height}
              {activeConnected && !activeConnected.connected ? ' (disconnected)' : ''}
            </span>
            {backgroundImageVersion && (
              <div className="canvas-device-bounds__clip">
                <div
                  className="dashboard-wallpaper"
                  style={{
                    backgroundImage: `url(${backgroundImageUrl(backgroundImageVersion)})`,
                    ...backgroundImageStyle(backgroundFit ?? 'cover', backgroundAnchor ?? 'center')
                  }}
                />
              </div>
            )}
          </div>
          {widgets.map((widget) =>
            widget.type === 'morph' ? (
              <MorphCanvasWidget
                key={widget.id}
                widget={widget}
                zoom={camera.zoom}
                variables={variableMap}
                onContextMenu={(e) => handleWidgetContextMenu(e, widget.id)}
              />
            ) : (
              <CanvasWidget
                key={widget.id}
                widget={widget}
                zoom={camera.zoom}
                variables={variableMap}
                onContextMenu={(e) => handleWidgetContextMenu(e, widget.id)}
              />
            )
          )}
          {marquee && (
            <div
              className="canvas-marquee"
              style={{
                left: Math.min(marquee.start.x, marquee.current.x),
                top: Math.min(marquee.start.y, marquee.current.y),
                width: Math.abs(marquee.current.x - marquee.start.x),
                height: Math.abs(marquee.current.y - marquee.start.y)
              }}
            />
          )}
        </div>
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} widgetIds={contextMenu.widgetIds} onClose={() => setContextMenu(null)} />
      )}
    </div>
  )
}
