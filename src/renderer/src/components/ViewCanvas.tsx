import { useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { getEffectiveStates } from '@shared/states'
import { morphFootprint } from '@shared/morph'
import { resolveColor, toVariableMap, type VariableMap } from '@shared/expr'
import type { AdjusterWidget, DialSwitchWidget, EncoderWidget, RockerSwitchWidget, StatefulWidget, Widget } from '@shared/types'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import { MorphButtonWidgetContent } from './widgets/MorphButtonWidget'
import { GaugeWidgetContent } from './widgets/GaugeWidget'
import { AdjusterWidgetContent } from './widgets/AdjusterWidget'
import { EncoderWidgetContent } from './widgets/EncoderWidget'
import { RockerSwitchWidgetContent } from './widgets/RockerSwitchWidget'
import { DialSwitchWidgetContent } from './widgets/DialSwitchWidget'
import { useAdjusterDrag } from '../useAdjusterDrag'
import { useEncoderDrag } from '../useEncoderDrag'
import { useSwitchPosition } from '../useSwitchPosition'
import { useDialSwitchDrag } from '../useDialSwitchDrag'
import { DeviceSettingsModal } from './DeviceSettingsModal'
import { ToastStack } from './ToastStack'

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

// Owns the drag hook — same split reasoning as AdjusterView above, so
// useEncoderDrag only ever mounts for an actual EncoderWidget.
function EncoderView({ widget, variables }: { widget: EncoderWidget; variables: VariableMap }): React.JSX.Element {
  const { dragSpinDegrees, handlePointerDown, handlePointerMove, handlePointerUp } = useEncoderDrag(widget, variables)
  return (
    <EncoderWidgetContent
      widget={widget}
      variables={variables}
      interactive
      dragSpinDegrees={dragSpinDegrees}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}

// Tapping a position fires its onSelect sequence (via useSwitchPosition's
// select, same 'select' action:trigger every switch type uses) and updates
// which position this client shows, purely locally unless
// activePositionExpr overrides it — see useSwitchPosition.ts and
// SwitchWidgetBase's own comment in shared/types.ts for why a switch's
// position is deliberately NOT synced dashboard state. RockerSwitchWidget
// only ever works this way; DialSwitchWidget can also use a drag gesture
// instead — see DialSwitchView below.
function RockerSwitchView({ widget, variables }: { widget: RockerSwitchWidget; variables: VariableMap }): React.JSX.Element {
  const { activeIndex, select } = useSwitchPosition(widget, variables)
  return <RockerSwitchWidgetContent widget={widget} variables={variables} interactive activeIndex={activeIndex} onSelect={select} />
}

// Two interaction modes (see widget.interactionMode) share the same
// useSwitchPosition: 'tap' wires its select straight to onSelect, identical
// to RockerSwitchView above. 'drag' hands that same select to
// useDialSwitchDrag instead, which only calls it once on release, after the
// drag has resolved to a position — see useDialSwitchDrag.ts. Both hooks are
// always called (rules of hooks); only one drives what's actually rendered.
function DialSwitchView({ widget, variables }: { widget: DialSwitchWidget; variables: VariableMap }): React.JSX.Element {
  const { activeIndex, select } = useSwitchPosition(widget, variables)
  const { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp } = useDialSwitchDrag(widget, select)

  if (widget.interactionMode === 'drag') {
    return (
      <DialSwitchWidgetContent
        widget={widget}
        variables={variables}
        interactive
        activeIndex={activeIndex}
        dragIndex={dragIndex}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    )
  }
  return <DialSwitchWidgetContent widget={widget} variables={variables} interactive activeIndex={activeIndex} onSelect={select} />
}

// Today's button/morph interactive rendering — press/release + tap-to-
// trigger. Typed StatefulWidget (not the full Widget union) since it's the
// only branch that touches getEffectiveStates/states/activeStateExpr.
// press()/release() now double as the real server triggers (events.press/
// events.release), not just the visual "Clicked" state they drove before —
// see EventfulWidget/SequenceStep in shared/types.ts.
function TriggerableViewWidget({
  widget,
  variables,
  error
}: {
  widget: StatefulWidget
  variables: VariableMap
  error?: string
}): React.JSX.Element {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const [pressed, setPressed] = useState(false)
  // Guards against firing 'release' twice for one gesture — pointerup and
  // pointercancel/pointerleave can both land for the same pointer in some
  // browsers (e.g. a drag that slides off the element then lifts outside
  // it). Each already independently called release() for the visual state
  // before press/release carried a real server-side side effect; a
  // double-fire now would run the release sequence twice.
  const releasedRef = useRef(true)
  const [defaultState, clickedState] = getEffectiveStates(widget, variables)
  const state = pressed && clickedState ? clickedState : defaultState

  function press(): void {
    setPressed(true)
    releasedRef.current = false
    triggerWidget(widget.id, 'press')
  }

  function release(): void {
    setPressed(false)
    if (releasedRef.current) return
    releasedRef.current = true
    triggerWidget(widget.id, 'release')
  }

  // Keyboard/assistive-tech activation dispatches a synthetic `click` with
  // no pointer events at all — e.detail === 0 is the standard signal a
  // click was keyboard/AT-synthesized (a real pointer click always reports
  // detail >= 1), used here (and in MorphButtonWidget.tsx's per-block
  // onClick) to fire the same press+release pair pointer gestures do below,
  // so that activation path isn't silently broken by moving the real
  // trigger off the native onClick.
  function handleKeyboardActivate(): void {
    press()
    release()
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
      <ButtonWidgetContent
        widget={widget}
        state={state}
        interactive
        variables={variables}
        onKeyboardActivate={handleKeyboardActivate}
        error={error}
      />
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
  error
}: {
  widget: Widget
  variables: VariableMap
  error?: string
}): React.JSX.Element {
  if (widget.type === 'gauge') return <GaugeWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'adjuster') return <AdjusterView widget={widget} variables={variables} />
  if (widget.type === 'encoder') return <EncoderView widget={widget} variables={variables} />
  if (widget.type === 'switch-rocker') return <RockerSwitchView widget={widget} variables={variables} />
  if (widget.type === 'switch-dial') return <DialSwitchView widget={widget} variables={variables} />
  return <TriggerableViewWidget widget={widget} variables={variables} error={error} />
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
            <ViewWidget widget={widget} variables={variableMap} error={errors[widget.id]} />
          </div>
        )
      })}
      {settingsOpen && <DeviceSettingsModal onClose={() => setSettingsOpen(false)} />}
      <ToastStack />
    </div>
  )
}
