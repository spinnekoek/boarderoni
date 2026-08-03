import { useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { applySpacing } from '../layout'
import { getEffectiveStates } from '@shared/states'
import type { Widget } from '@shared/types'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import { DeviceSettingsModal } from './DeviceSettingsModal'

const SETTINGS_GESTURE_FINGER_COUNT = 5

function ViewWidget({
  widget,
  onTrigger,
  error
}: {
  widget: Widget
  onTrigger: () => void
  error?: string
}): React.JSX.Element {
  const [pressed, setPressed] = useState(false)
  const [defaultState, clickedState] = getEffectiveStates(widget)

  function handlePointerDown(e: React.PointerEvent): void {
    setPressed(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
  }

  function release(): void {
    setPressed(false)
  }

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onPointerDown={handlePointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <ButtonWidgetContent widget={widget} state={pressed && clickedState ? clickedState : defaultState} interactive onTrigger={onTrigger} error={error} />
    </div>
  )
}

export function ViewCanvas(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const spacing = useDashboardStore((s) => s.dashboard.spacing ?? 0)
  const backgroundColor = useDashboardStore((s) => s.dashboard.backgroundColor)
  const backgroundImageVersion = useDashboardStore((s) => s.dashboard.backgroundImageVersion)
  const backgroundFit = useDashboardStore((s) => s.dashboard.backgroundFit)
  const backgroundAnchor = useDashboardStore((s) => s.dashboard.backgroundAnchor)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const errors = useDashboardStore((s) => s.errors)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // Guards against re-opening on every touchmove while 5+ fingers stay down,
  // and resets once every finger has lifted so the next 5-finger touch can
  // open it again.
  const gestureFiredRef = useRef(false)

  function handleTouchStart(e: React.TouchEvent): void {
    if (e.touches.length >= SETTINGS_GESTURE_FINGER_COUNT && !gestureFiredRef.current) {
      gestureFiredRef.current = true
      setSettingsOpen(true)
    }
  }

  function handleTouchEnd(e: React.TouchEvent): void {
    if (e.touches.length === 0) gestureFiredRef.current = false
  }

  return (
    <div
      className="view-canvas"
      style={{ backgroundColor }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {backgroundImageVersion && (
        <div
          className="dashboard-wallpaper"
          style={{
            backgroundImage: `url(${backgroundImageUrl(backgroundImageVersion)})`,
            ...backgroundImageStyle(backgroundFit ?? 'cover', backgroundAnchor ?? 'center')
          }}
        />
      )}
      {widgets.map((widget) => {
        const rendered = applySpacing(widget.x, widget.y, widget.w, widget.h, spacing)
        return (
          <div
            key={widget.id}
            className="view-canvas__widget"
            style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
          >
            <ViewWidget widget={widget} onTrigger={() => triggerWidget(widget.id)} error={errors[widget.id]} />
          </div>
        )
      })}
      {settingsOpen && <DeviceSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
