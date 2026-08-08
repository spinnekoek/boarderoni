import { useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { getEffectiveStates } from '@shared/states'
import { morphFootprint } from '@shared/morph'
import { resolveColor, toVariableMap, type VariableMap } from '@shared/expr'
import type { AdjusterWidget, StatefulWidget, Widget } from '@shared/types'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import { MorphButtonWidgetContent } from './widgets/MorphButtonWidget'
import { GaugeWidgetContent } from './widgets/GaugeWidget'
import { AdjusterWidgetContent } from './widgets/AdjusterWidget'
import { useAdjusterDrag } from '../useAdjusterDrag'
import { DeviceSettingsModal } from './DeviceSettingsModal'

const SETTINGS_GESTURE_FINGER_COUNT = 5

// Owns the drag hook — kept separate from the dispatcher below so the hook
// only ever mounts for an actual AdjusterWidget, not conditionally within a
// component that also handles other widget types.
function AdjusterView({ widget, variables }: { widget: AdjusterWidget; variables: VariableMap }): React.JSX.Element {
  const { dragFraction, handlePointerDown, handlePointerMove, handlePointerUp } = useAdjusterDrag(widget, variables)
  return (
    <AdjusterWidgetContent
      widget={widget}
      variables={variables}
      interactive
      dragFraction={dragFraction}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}

// Today's button/morph interactive rendering — press/release + tap-to-
// trigger. Typed StatefulWidget (not the full Widget union) since it's the
// only branch that touches getEffectiveStates/states/activeStateExpr.
function TriggerableViewWidget({
  widget,
  variables,
  onTrigger,
  error
}: {
  widget: StatefulWidget
  variables: VariableMap
  onTrigger: () => void
  error?: string
}): React.JSX.Element {
  const [pressed, setPressed] = useState(false)
  const [defaultState, clickedState] = getEffectiveStates(widget, variables)
  const state = pressed && clickedState ? clickedState : defaultState

  function press(): void {
    setPressed(true)
  }

  function release(): void {
    setPressed(false)
  }

  // Morph blocks own their own pointer handling (see MorphButtonWidgetContent)
  // instead of a single full-bounding-box wrapper, since an irregular shape's
  // bounding box includes area that isn't actually part of any block (a U's
  // notch) — a wrapper div there would show "pressed" for taps that don't
  // land on any real block.
  if (widget.type === 'morph') {
    return (
      <MorphButtonWidgetContent
        widget={widget}
        state={state}
        interactive
        variables={variables}
        onTrigger={onTrigger}
        onPress={press}
        onRelease={release}
        error={error}
      />
    )
  }

  function handlePointerDown(e: React.PointerEvent): void {
    press()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
  }

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onPointerDown={handlePointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <ButtonWidgetContent widget={widget} state={state} interactive variables={variables} onTrigger={onTrigger} error={error} />
    </div>
  )
}

// Dispatches on widget.type before any type-specific hooks run — Gauge is
// passive (no action, no pointer handling at all) and Adjuster owns its own
// drag hook (AdjusterView above), neither of which fits
// TriggerableViewWidget's press/release + getEffectiveStates model.
function ViewWidget({
  widget,
  variables,
  onTrigger,
  error
}: {
  widget: Widget
  variables: VariableMap
  onTrigger: () => void
  error?: string
}): React.JSX.Element {
  if (widget.type === 'gauge') return <GaugeWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'adjuster') return <AdjusterView widget={widget} variables={variables} />
  return <TriggerableViewWidget widget={widget} variables={variables} onTrigger={onTrigger} error={error} />
}

export function ViewCanvas(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const variables = useDashboardStore((s) => s.dashboard.variables)
  const backgroundColor = useDashboardStore((s) => s.dashboard.backgroundColor)
  const backgroundColorExpr = useDashboardStore((s) => s.dashboard.backgroundColorExpr)
  const backgroundImageVersion = useDashboardStore((s) => s.dashboard.backgroundImageVersion)
  const deckId = useDashboardStore((s) => s.deckId)
  const backgroundFit = useDashboardStore((s) => s.dashboard.backgroundFit)
  const backgroundAnchor = useDashboardStore((s) => s.dashboard.backgroundAnchor)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const errors = useDashboardStore((s) => s.errors)

  const variableMap = useMemo(() => toVariableMap(variables ?? []), [variables])
  const resolvedBackgroundColor =
    resolveColor({ color: backgroundColor, colorExpr: backgroundColorExpr }, variableMap).color ?? backgroundColor

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
      style={{ backgroundColor: resolvedBackgroundColor }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {backgroundImageVersion && deckId && (
        <div
          className="dashboard-wallpaper"
          style={{
            backgroundImage: `url(${backgroundImageUrl(deckId, backgroundImageVersion)})`,
            ...backgroundImageStyle(backgroundFit ?? 'cover', backgroundAnchor ?? 'center')
          }}
        />
      )}
      {widgets.map((widget) => {
        const rendered = widget.type === 'morph' ? morphFootprint(widget) : widget
        return (
          <div
            key={widget.id}
            className={`view-canvas__widget${widget.type === 'morph' ? ' view-canvas__widget--morph' : ''}`}
            style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
          >
            <ViewWidget widget={widget} variables={variableMap} onTrigger={() => triggerWidget(widget.id)} error={errors[widget.id]} />
          </div>
        )
      })}
      {settingsOpen && <DeviceSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
