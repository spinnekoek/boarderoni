import { useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { CanvasWidget } from './CanvasWidget'
import { DEFAULT_DEVICE_BOUNDS } from '@shared/constants'

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

export function Canvas(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const backgroundColor = useDashboardStore((s) => s.dashboard.backgroundColor)
  const backgroundImageVersion = useDashboardStore((s) => s.dashboard.backgroundImageVersion)
  const backgroundFit = useDashboardStore((s) => s.dashboard.backgroundFit)
  const backgroundAnchor = useDashboardStore((s) => s.dashboard.backgroundAnchor)
  const devices = useDashboardStore((s) => s.devices)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)

  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA)
  const viewportRef = useRef<HTMLDivElement>(null)
  const panState = useRef<PanState | null>(null)

  function handleBackgroundPointerDown(e: React.PointerEvent): void {
    panState.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
  }

  function handleBackgroundPointerMove(e: React.PointerEvent): void {
    const pan = panState.current
    if (!pan) return
    const dx = e.clientX - pan.startX
    const dy = e.clientY - pan.startY
    if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) pan.moved = true
    if (pan.moved) setCamera((c) => ({ ...c, x: pan.camX + dx, y: pan.camY + dy }))
  }

  function handleBackgroundPointerUp(): void {
    const moved = panState.current?.moved
    panState.current = null
    if (!moved) selectWidget(null)
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

  const deviceRects = devices.length > 0 ? devices : [{ id: 'default', ...DEFAULT_DEVICE_BOUNDS }]

  return (
    <div className="canvas-viewport" ref={viewportRef} onWheel={handleWheel}>
      <div className="canvas-toolbar">
        <span className="canvas-toolbar__zoom">{Math.round(camera.zoom * 100)}%</span>
        <button className="canvas-toolbar__button" onClick={() => setCamera(INITIAL_CAMERA)}>
          Reset view
        </button>
        <span className="canvas-toolbar__devices">
          {devices.length === 0
            ? 'No device connected — showing default guide bounds'
            : `${devices.length} device${devices.length > 1 ? 's' : ''} connected`}
        </span>
        <span className="canvas-toolbar__hint">Scroll to zoom · drag empty space to pan</span>
      </div>
      <div
        className="canvas-background"
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
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
          {deviceRects.map((d) => (
            <div key={d.id} className="canvas-device-bounds" style={{ width: d.width, height: d.height }}>
              <span className="canvas-device-bounds__label">
                {d.width}×{d.height}
                {devices.length === 0 ? ' (guide)' : ''}
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
          ))}
          {widgets.map((widget) => (
            <CanvasWidget key={widget.id} widget={widget} zoom={camera.zoom} />
          ))}
        </div>
      </div>
    </div>
  )
}
