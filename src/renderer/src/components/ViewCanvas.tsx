import { useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { isBoarderoniAndroidApp, setKeepScreenOn } from '../androidBridge'
import { getKeepScreenOnPreference } from '../id'
import { getEffectiveStates } from '@shared/states'
import { morphFootprint } from '@shared/morph'
import { resolveColor, resolveNumericExpr, toVariableMap, type VariableMap } from '@shared/expr'
import { findSubDeck, getSubDeckWidgets } from '@shared/subDecks'
import type {
  AdjusterWidget,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  MorphButtonWidget,
  RockerSwitchWidget,
  StatefulWidget,
  ToggleSwitchWidget,
  Widget
} from '@shared/types'
import { OverlayPanel } from './OverlayPanel'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import { MorphButtonWidgetContent } from './widgets/MorphButtonWidget'
import { GaugeWidgetContent } from './widgets/GaugeWidget'
import { ScreenCaptureWidgetContent } from './widgets/ScreenCaptureWidget'
import { AdjusterWidgetContent } from './widgets/AdjusterWidget'
import { EncoderWidgetContent } from './widgets/EncoderWidget'
import { RockerSwitchWidgetContent } from './widgets/RockerSwitchWidget'
import { DialSwitchWidgetContent } from './widgets/DialSwitchWidget'
import { ToggleSwitchWidgetContent } from './widgets/ToggleSwitchWidget'
import { DropdownWidgetContent } from './widgets/DropdownWidget'
import { useAdjusterDrag } from '../useAdjusterDrag'
import { useMorphSliderDrag } from '../useMorphSliderDrag'
import { useEncoderDrag } from '../useEncoderDrag'
import { useSwitchPosition } from '../useSwitchPosition'
import { useDialSwitchDrag } from '../useDialSwitchDrag'
import { useToggleSwitchDrag } from '../useToggleSwitchDrag'
import { isMiddlePosition as isMiddleTogglePosition } from './widgets/ToggleSwitchWidget'
import { useDropdownDrag } from '../useDropdownDrag'
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

// Same two-interaction-mode split as DialSwitchView below, plus momentary
// handling (see SwitchPosition.momentary) in both: a momentary position
// (only ever the first/last, never the middle) selects immediately on
// press, and springs back to the middle position the instant you release —
// tap mode does that itself here (onZonePointerDown/onZonePointerUp);
// drag mode's own spring-back lives inside useToggleSwitchDrag.ts, since it
// also has to fire mid-drag, not just on release.
function ToggleSwitchView({ widget, variables }: { widget: ToggleSwitchWidget; variables: VariableMap }): React.JSX.Element {
  const { activeIndex, select } = useSwitchPosition(widget, variables)
  const { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp } = useToggleSwitchDrag(widget, select)
  const count = widget.positions.length
  const middleIndex = count % 2 === 1 ? (count - 1) / 2 : -1

  if (widget.interactionMode === 'drag') {
    return (
      <ToggleSwitchWidgetContent
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

  function handleZonePointerUp(index: number): void {
    const isMomentary = !isMiddleTogglePosition(index, count) && (widget.positions[index]?.momentary ?? false)
    if (isMomentary && middleIndex >= 0) select(middleIndex)
  }

  return (
    <ToggleSwitchWidgetContent
      widget={widget}
      variables={variables}
      interactive
      activeIndex={activeIndex}
      onZonePointerDown={select}
      onZonePointerUp={handleZonePointerUp}
    />
  )
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

// press/release fire on every hold regardless of where it ends; select
// (via useSwitchPosition's own select — same 'select' action:trigger every
// switch type uses, and same local "remember what this device last picked"
// behavior) only fires when useDropdownDrag resolves the release to a real
// position, not a drag-off-the-end miss — see its own comment.
function DropdownView({ widget, variables }: { widget: DropdownWidget; variables: VariableMap }): React.JSX.Element {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const { activeIndex, select } = useSwitchPosition(widget, variables)
  const { held, dragIndex, handlePointerDown, handlePointerMove, handlePointerUp } = useDropdownDrag(
    widget,
    activeIndex,
    () => triggerWidget(widget.id, 'press'),
    () => triggerWidget(widget.id, 'release'),
    select
  )
  return (
    <DropdownWidgetContent
      widget={widget}
      variables={variables}
      interactive
      activeIndex={activeIndex}
      held={held}
      dragIndex={dragIndex}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}

// press()/release() double as the real server triggers (events.press/
// events.release), not just the visual "Clicked" state they drove before —
// see EventfulWidget/SequenceStep in shared/types.ts. Shared by
// TriggerableViewWidget (plain buttons) and MorphView below — both need the
// exact same press/release bookkeeping, but MorphView also needs its own
// unconditionally-called useMorphSliderDrag, which is why morph got split
// into its own top-level dispatch (mirroring AdjusterView/EncoderView)
// instead of living inside TriggerableViewWidget as a conditional branch:
// React's rules of hooks don't allow useMorphSliderDrag to be called from
// inside an `if (widget.type === 'morph')` block in a component that's also
// rendered for plain buttons.
function usePressRelease(widgetId: string): { pressed: boolean; press: () => void; release: () => void } {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const [pressed, setPressed] = useState(false)
  // Guards against firing 'release' twice for one gesture — pointerup and
  // pointercancel/pointerleave can both land for the same pointer in some
  // browsers (e.g. a drag that slides off the element then lifts outside
  // it). Each already independently called release() for the visual state
  // before press/release carried a real server-side side effect; a
  // double-fire now would run the release sequence twice.
  const releasedRef = useRef(true)

  function press(): void {
    setPressed(true)
    releasedRef.current = false
    triggerWidget(widgetId, 'press')
  }

  function release(): void {
    setPressed(false)
    if (releasedRef.current) return
    releasedRef.current = true
    triggerWidget(widgetId, 'release')
  }

  return { pressed, press, release }
}

// Today's plain-button interactive rendering — press/release + tap-to-
// trigger. Typed StatefulWidget narrowed to ButtonWidget by ViewWidget's own
// dispatch below (morph now goes through MorphView instead) — kept as
// StatefulWidget rather than ButtonWidget only because getEffectiveStates
// takes the shared type.
function TriggerableViewWidget({
  widget,
  variables,
  error
}: {
  widget: StatefulWidget
  variables: VariableMap
  error?: string
}): React.JSX.Element {
  const { pressed, press, release } = usePressRelease(widget.id)
  const [defaultState, clickedState] = getEffectiveStates(widget, variables)
  const state = pressed && clickedState ? clickedState : defaultState

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

// Owns both the shared press/release bookkeeping (see usePressRelease above
// — a morph button fires the exact same press/release events a plain
// button does) and useMorphSliderDrag, unconditionally, same as
// AdjusterView/EncoderView own their own drag hook — safe to call
// unconditionally here because this component is only ever mounted for an
// actual MorphButtonWidget (see ViewWidget's dispatch), never for a plain
// button. useMorphSliderDrag itself is cheap to run even when
// isMorphSliderActive(widget) is false (its handlers just never get wired
// to any DOM element, since MorphButtonWidgetContent only renders the
// handle when active).
function MorphView({ widget, variables, error }: { widget: MorphButtonWidget; variables: VariableMap; error?: string }): React.JSX.Element {
  const { pressed, press, release } = usePressRelease(widget.id)
  const [defaultState, clickedState] = getEffectiveStates(widget, variables)
  const state = pressed && clickedState ? clickedState : defaultState
  const { dragFraction, handlePointerDown, handlePointerMove, handlePointerUp } = useMorphSliderDrag(widget, variables)
  const sliderFraction = dragFraction ?? (widget.valueExpr ? (resolveNumericExpr(widget.valueExpr, variables) ?? 0) / 100 : 0)

  // Morph blocks own their own pointer handling (see MorphButtonWidgetContent)
  // instead of a single full-bounding-box wrapper, since an irregular shape's
  // bounding box includes area that isn't actually part of any block (a U's
  // notch) — a wrapper div there would show "pressed" for taps that don't
  // land on any real block.
  return (
    <MorphButtonWidgetContent
      widget={widget}
      state={state}
      interactive
      variables={variables}
      onPress={press}
      onRelease={release}
      error={error}
      sliderFraction={sliderFraction}
      onSliderPointerDown={handlePointerDown}
      onSliderPointerMove={handlePointerMove}
      onSliderPointerUp={handlePointerUp}
    />
  )
}

// Dispatches on widget.type before any type-specific hooks run — Gauge is
// passive (no action, no pointer handling at all), and Adjuster/Encoder/Morph
// each own their own drag hook (AdjusterView/EncoderView/MorphView above),
// none of which fits TriggerableViewWidget's plain press/release +
// getEffectiveStates model on their own.
function ViewWidget({
  widget,
  variables,
  deckId,
  error
}: {
  widget: Widget
  variables: VariableMap
  deckId: string | null
  error?: string
}): React.JSX.Element {
  if (widget.type === 'gauge') return <GaugeWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'screen-capture') return <ScreenCaptureWidgetContent widget={widget} variables={variables} deckId={deckId} />
  if (widget.type === 'adjuster') return <AdjusterView widget={widget} variables={variables} />
  if (widget.type === 'encoder') return <EncoderView widget={widget} variables={variables} />
  if (widget.type === 'morph') return <MorphView widget={widget} variables={variables} error={error} />
  if (widget.type === 'switch-rocker') return <RockerSwitchView widget={widget} variables={variables} />
  if (widget.type === 'switch-dial') return <DialSwitchView widget={widget} variables={variables} />
  if (widget.type === 'switch-toggle') return <ToggleSwitchView widget={widget} variables={variables} />
  if (widget.type === 'dropdown') return <DropdownView widget={widget} variables={variables} />
  return <TriggerableViewWidget widget={widget} variables={variables} error={error} />
}

// One deck view's worth of widgets, absolutely positioned within whatever
// positioned box contains this — the fullscreen root canvas below, or an
// OverlayPanel's own smaller box. Extracted so both render sites share the
// exact same morph-footprint/keying logic instead of duplicating it.
export function ScreenWidgetsLayer({
  widgets,
  variables,
  deckId,
  errors
}: {
  widgets: Widget[]
  variables: VariableMap
  deckId: string | null
  errors: Record<string, string>
}): React.JSX.Element {
  return (
    <>
      {widgets.map((widget) => {
        const rendered = widget.type === 'morph' ? morphFootprint(widget) : widget
        return (
          <div
            key={widget.id}
            className={`view-canvas__widget${widget.type === 'morph' ? ' view-canvas__widget--morph' : ''}`}
            style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
          >
            <ViewWidget widget={widget} variables={variables} deckId={deckId} error={errors[widget.id]} />
          </div>
        )
      })}
    </>
  )
}

export function ViewCanvas(): React.JSX.Element {
  // Selected separately from the whole `dashboard` (rather than one
  // `s.dashboard` selector destructured below) so this component doesn't
  // re-render on every variables:sync tick, which leaves widgets/subDecks
  // references unchanged.
  const rootWidgets = useDashboardStore((s) => s.dashboard.widgets)
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks)
  const activeSubDeckId = useDashboardStore((s) => s.activeSubDeckId)
  const activeOverlay = useDashboardStore((s) => s.activeOverlay)
  const closeOverlay = useDashboardStore((s) => s.closeOverlay)
  const widgets = useMemo(
    () => getSubDeckWidgets({ widgets: rootWidgets, subDecks }, activeSubDeckId),
    [rootWidgets, subDecks, activeSubDeckId]
  )
  // Guards against a stale reference — the sub-deck an open overlay names
  // may have been deleted (from the editor) while it was showing.
  const overlaySubDeck = activeOverlay ? findSubDeck({ subDecks }, activeOverlay.subDeckId) : undefined
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

  // Applies the persisted preference to the native side once per mount —
  // DeviceSettingsModal's checkbox re-applies it live on every toggle, this
  // is just what makes it stick across app relaunches without the modal
  // ever having to be opened.
  useEffect(() => {
    if (isBoarderoniAndroidApp()) setKeepScreenOn(getKeepScreenOnPreference())
  }, [])

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

  // The 5-finger gesture's keyboard equivalent — for opening this same
  // modal from a regular desktop browser (e.g. testing the appUrl link from
  // MobileAppModal in Chrome), where there's no touchscreen to 5-finger tap.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'i') return
      e.preventDefault()
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
      <ScreenWidgetsLayer widgets={widgets} variables={variableMap} deckId={deckId} errors={errors} />
      {activeOverlay && overlaySubDeck && (
        <OverlayPanel
          subDeck={overlaySubDeck}
          edge={activeOverlay.edge}
          size={activeOverlay.size}
          sizeUnit={activeOverlay.sizeUnit}
          variables={variableMap}
          deckId={deckId}
          errors={errors}
          backgroundColor={resolvedBackgroundColor}
          backgroundImageVersion={backgroundImageVersion}
          backgroundFit={backgroundFit}
          backgroundAnchor={backgroundAnchor}
          onDismiss={closeOverlay}
        />
      )}
      {settingsOpen && <DeviceSettingsModal onClose={() => setSettingsOpen(false)} />}
      <ToastStack />
    </div>
  )
}
