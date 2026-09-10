import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { isBoarderoniAndroidApp, setKeepScreenOn, setDebugLogging, connectionLost } from '../androidBridge'
import { getKeepScreenOnPreference, getDebugLoggingPreference } from '../id'
import { getEffectiveStates } from '@shared/states'
import { morphFootprint } from '@shared/morph'
import {
  resolveColor,
  resolveNumericExpr,
  resolveWidgetVisible,
  toVariableMap,
  widgetVariableDependencies,
  type VariableMap
} from '@shared/expr'
import { findSubDeck, getSubDeckCanvasSize, getSubDeckWidgets } from '@shared/subDecks'
import type {
  AdjusterKnobWidget,
  AdjusterSliderWidget,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  MorphButtonWidget,
  RockerSwitchWidget,
  StatefulWidget,
  ToggleSwitchWidget,
  Widget,
  WidgetState
} from '@shared/types'
import { OverlayPanel } from './OverlayPanel'
import { LetterboxedCanvas } from './LetterboxedCanvas'
import { ButtonWidgetContent } from './widgets/ButtonWidget'
import { MorphButtonWidgetContent } from './widgets/MorphButtonWidget'
import { BarGaugeWidgetContent, ArcGaugeWidgetContent } from './widgets/GaugeWidget'
import { ScreenCaptureWidgetContent } from './widgets/ScreenCaptureWidget'
import { DcsViewportWidgetContent } from './widgets/DcsViewportWidget'
import { AdjusterWidgetContent } from './widgets/AdjusterWidget'
import { EncoderWidgetContent } from './widgets/EncoderWidget'
import { RockerSwitchWidgetContent } from './widgets/RockerSwitchWidget'
import { DialSwitchWidgetContent } from './widgets/DialSwitchWidget'
import { ToggleSwitchWidgetContent } from './widgets/ToggleSwitchWidget'
import { DropdownWidgetContent } from './widgets/DropdownWidget'
import { LabelWidgetContent } from './widgets/LabelWidget'
import { LineWidgetContent } from './widgets/LineWidget'
import { useAdjusterDrag } from '../useAdjusterDrag'
import { useMultiPressArbiter } from '../useMultiPressArbiter'
import { useMorphSliderDrag } from '../useMorphSliderDrag'
import { useEncoderDrag } from '../useEncoderDrag'
import { useSwitchPosition } from '../useSwitchPosition'
import { useSwitchGuard } from '../useSwitchGuard'
import { useDialSwitchDrag } from '../useDialSwitchDrag'
import { useToggleSwitchDrag } from '../useToggleSwitchDrag'
import { isMiddlePosition as isMiddleTogglePosition, momentarySpringBackIndex } from './widgets/ToggleSwitchWidget'
import { useDropdownDrag } from '../useDropdownDrag'
import { DeviceSettingsModal } from './DeviceSettingsModal'
import { ToastStack } from './ToastStack'

const SETTINGS_GESTURE_FINGER_COUNT = 5

// How long the WebSocket can stay disconnected before falling back to the
// native Android searching/found-connect screen — see the effect below for
// the full reasoning. Long enough that store.ts's own 1.5s retry loop gets
// several real attempts first; short enough that a tablet left frozen on a
// dead session doesn't sit that way indefinitely.
const CONNECTION_LOST_GRACE_MS = 30000

// Owns the drag hook — kept separate from the dispatcher below so the hook
// only ever mounts for an actual AdjusterWidget, not conditionally within a
// component that also handles other widget types.
function AdjusterView({
  widget,
  variables
}: {
  widget: AdjusterSliderWidget | AdjusterKnobWidget
  variables: VariableMap
}): React.JSX.Element {
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
  const { activeIndex, select, settleInactive } = useSwitchPosition(widget, variables)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  // Root-level press/release (see RockerSwitchWidget.events' own doc
  // comment) — fires on every physical press/release of the widget
  // regardless of which segment (if any) it lands on, layered on top of
  // (not replacing) the per-segment onClick that fires 'select' inside
  // RockerSwitchWidgetContent itself. A plain overlay wrapper rather than
  // threading new props through the Content component, which already has
  // its own pointer handling to not disturb.
  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={() => triggerWidget(widget.id, 'press')}
      onPointerUp={() => triggerWidget(widget.id, 'release')}
      onPointerCancel={() => triggerWidget(widget.id, 'release')}
    >
      <RockerSwitchWidgetContent
        widget={widget}
        variables={variables}
        interactive
        activeIndex={activeIndex}
        onSelect={select}
        onRelease={settleInactive}
      />
    </div>
  )
}

// Same two-interaction-mode split as DialSwitchView below, plus momentary
// handling (see SwitchPosition.momentary) in both: a momentary position
// (only ever the first/last, never the middle) selects immediately on
// press, and springs back — to the middle on a 3-position switch, or
// whichever of Top/Bottom isn't the momentary one on a 2-position switch
// (see momentarySpringBackIndex) — the instant you release. Tap mode does
// that itself here (onZonePointerDown/onZonePointerUp); drag mode's own
// spring-back lives inside useToggleSwitchDrag.ts, since it also has to fire
// mid-drag, not just on release.
function ToggleSwitchView({ widget, variables }: { widget: ToggleSwitchWidget; variables: VariableMap }): React.JSX.Element {
  // ToggleSwitchWidget has no settleToInactive of its own (RockerSwitchWidget
  // only — see useSwitchPosition.ts) so this is never actually null; the `?? 0`
  // just satisfies the hook's shared, nullable-for-Rocker return type.
  const { activeIndex: rawActiveIndex, select } = useSwitchPosition(widget, variables)
  const activeIndex = rawActiveIndex ?? 0
  const { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp } = useToggleSwitchDrag(widget, activeIndex, select, variables)
  const { open: guardOpen, toggle: guardToggleLocal } = useSwitchGuard(widget, variables)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const count = widget.positions.length
  // Fires the widget's own configurable guardToggle action (see
  // ToggleSwitchWidget.events' own comment) alongside the local open/closed
  // flip every tap on the guard already did — the only hook available for a
  // real side effect (a DCS-BIOS command, an update-state) off pressing the
  // cover itself, since guardOpenExpr only ever reads a variable back, never
  // writes one. $value is 1 if this tap is opening the guard, 0 if closing.
  function guardToggle(): void {
    triggerWidget(widget.id, 'guardToggle', guardOpen ? 0 : 1)
    guardToggleLocal()
  }
  // The properties panel enforces at most one momentary position on a
  // 2-position switch — see PropertiesPanel.tsx's Momentary section — so
  // this is really "is there a momentary position at all," not "which one."
  const hasMomentary = widget.positions.some((p) => p.momentary ?? false)

  const content =
    widget.interactionMode === 'drag' ? (
      <ToggleSwitchWidgetContent
        widget={widget}
        variables={variables}
        interactive
        activeIndex={activeIndex}
        dragIndex={dragIndex}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        guardOpen={guardOpen}
        onGuardToggle={guardToggle}
      />
    ) : (
      <ToggleSwitchWidgetContent
        widget={widget}
        variables={variables}
        interactive
        activeIndex={activeIndex}
        // A 2-position toggle with no momentary position has no "direction"
        // tapping it should have to respect — it's just on/off, so any zone
        // flips it regardless of which one was actually pressed (unlike 3
        // positions, where each zone still has to pick its own specific
        // position — you can't "toggle" onto a specific middle throw). See
        // this behavior's own bug report: pressing the zone opposite the
        // current position used to be the only way to flip it; the same-side
        // zone did nothing. Momentary needs the opposite of that: pressing a
        // SPECIFIC zone has to select that exact position (so the momentary
        // one only ever fires while its own zone is actually held, not
        // whichever one happens to not be active), so this flip-either-zone
        // convenience only applies once there's no momentary position to
        // respect.
        onZonePointerDown={count === 2 && !hasMomentary ? () => select(activeIndex === 0 ? 1 : 0) : select}
        onZonePointerUp={(index) => {
          const isMomentary = !isMiddleTogglePosition(index, count) && (widget.positions[index]?.momentary ?? false)
          if (isMomentary) {
            const target = momentarySpringBackIndex(index, count)
            if (target >= 0) select(target)
          }
        }}
        guardOpen={guardOpen}
        onGuardToggle={guardToggle}
      />
    )

  // Root-level press/release (see ToggleSwitchWidget.events' own doc
  // comment) — layered on top of, not replacing, the tap/drag handling
  // above (same overlay-wrapper approach as RockerSwitchView).
  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={() => triggerWidget(widget.id, 'press')}
      onPointerUp={() => triggerWidget(widget.id, 'release')}
      onPointerCancel={() => triggerWidget(widget.id, 'release')}
    >
      {content}
    </div>
  )
}

// Two interaction modes (see widget.interactionMode) share the same
// useSwitchPosition: 'tap' wires its select straight to onSelect, identical
// to RockerSwitchView above. 'drag' hands that same select to
// useDialSwitchDrag instead, which only calls it once on release, after the
// drag has resolved to a position — see useDialSwitchDrag.ts. Both hooks are
// always called (rules of hooks); only one drives what's actually rendered.
function DialSwitchView({ widget, variables }: { widget: DialSwitchWidget; variables: VariableMap }): React.JSX.Element {
  // DialSwitchWidget has no settleToInactive of its own (RockerSwitchWidget
  // only — see useSwitchPosition.ts) so this is never actually null; the `?? 0`
  // just satisfies the hook's shared, nullable-for-Rocker return type.
  const { activeIndex: rawActiveIndex, select } = useSwitchPosition(widget, variables)
  const activeIndex = rawActiveIndex ?? 0
  const { dragIndex, handlePointerDown, handlePointerMove, handlePointerUp } = useDialSwitchDrag(widget, select, variables)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  // ?? [] guards a dashboard saved before these existed — see
  // ButtonWidget.events' own comment in shared/types.ts for the convention.
  const hasDoublePress = (widget.events.doublePress ?? []).length > 0
  const hasTriplePress = (widget.events.triplePress ?? []).length > 0
  const multiPressEnabled = hasDoublePress || hasTriplePress
  const { registerTap } = useMultiPressArbiter(widget.id, hasDoublePress, hasTriplePress)

  const content =
    widget.interactionMode === 'drag' ? (
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
    ) : (
      <DialSwitchWidgetContent widget={widget} variables={variables} interactive activeIndex={activeIndex} onSelect={select} />
    )

  // Root-level press/release (see DialSwitchWidget.events' own doc comment)
  // — layered on top of, not replacing, the tap/drag handling above (same
  // overlay-wrapper approach as RockerSwitchView).
  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={() => (multiPressEnabled ? registerTap() : triggerWidget(widget.id, 'press'))}
      onPointerUp={() => triggerWidget(widget.id, 'release')}
      onPointerCancel={() => triggerWidget(widget.id, 'release')}
    >
      {content}
    </div>
  )
}

// press/release fire on every hold regardless of where it ends; select
// (via useSwitchPosition's own select — same 'select' action:trigger every
// switch type uses, and same local "remember what this device last picked"
// behavior) only fires when useDropdownDrag resolves the release to a real
// position, not a drag-off-the-end miss — see its own comment.
function DropdownView({ widget, variables }: { widget: DropdownWidget; variables: VariableMap }): React.JSX.Element {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  // DropdownWidget has no settleToInactive of its own (RockerSwitchWidget
  // only — see useSwitchPosition.ts) so this is never actually null; the `?? 0`
  // just satisfies the hook's shared, nullable-for-Rocker return type.
  const { activeIndex: rawActiveIndex, select } = useSwitchPosition(widget, variables)
  const activeIndex = rawActiveIndex ?? 0
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
function usePressRelease(
  widgetId: string,
  options?: {
    // See useMultiPressArbiter's own comment — true while a button with
    // real doublePress/triplePress steps is holding a tap to see if another
    // follows, so this hook's own automatic 'press' trigger doesn't ALSO
    // fire alongside whatever the arbiter itself decides to send. The
    // visual pressed state below is deliberately NOT gated on this — a tap
    // should still look pressed instantly regardless of how its network
    // trigger gets resolved.
    suppressPressTrigger?: boolean
  }
): { pressed: boolean; press: () => void; release: () => void } {
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
    if (!options?.suppressPressTrigger) triggerWidget(widgetId, 'press')
  }

  function release(): void {
    setPressed(false)
    if (releasedRef.current) return
    releasedRef.current = true
    triggerWidget(widgetId, 'release')
  }

  return { pressed, press, release }
}

// How long useTriggerableState (below) ignores an activeStateExpr-driven
// flip back to Clicked after this button's own release() already ended the
// local optimistic press — generous relative to a normal DCS-BIOS round trip
// (command out, sim state changes, next export tick, variables:sync back,
// see useSwitchPosition.ts's PENDING_CONFIRM_TIMEOUT_MS for the same
// reasoning on switches), but short enough that a genuinely independent
// state change shortly after release still gets through eventually.
const ECHO_SUPPRESS_TIMEOUT_MS = 1500

// Combines usePressRelease with getEffectiveStates for a button whose
// activeStateExpr reads back the very variable its own press/release actions
// just set (KEK5 is the motivating case: press sends UFC_5=1, release sends
// UFC_5=0, and activeStateExpr shows Clicked whenever variables.UFC_5 === 1)
// — without this, the sequence is: local optimistic Clicked while pressed
// (correct), back to Default on release (correct, the live variable hasn't
// caught up yet), then Clicked AGAIN a beat later once DCS-BIOS actually
// re-exports the round trip of OUR OWN commands — a redundant second flash
// confirming something already shown locally, not new information. Once
// release() fires on an activeStateExpr-bound button, this suppresses
// exactly that echo (falling back to states[0], same as
// resolveBaseState's own default-on-failure fallback in shared/states.ts)
// until activeStateExpr itself confirms back to non-clicked or the timeout
// above gives up — same "hold against a stale/delayed live value" shape as
// useSwitchPosition.ts's `pending`, just suppressing an echo instead of
// asserting a fresh selection.
function useTriggerableState(
  widget: StatefulWidget,
  variables: VariableMap,
  options?: { suppressPressTrigger?: boolean }
): { pressed: boolean; press: () => void; release: () => void; state: WidgetState } {
  const { pressed, press, release: releaseRaw } = usePressRelease(widget.id, options)
  const [defaultState, clickedState] = getEffectiveStates(widget, variables)

  const [suppressEcho, setSuppressEcho] = useState(false)
  const suppressTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (suppressEcho && defaultState !== clickedState) {
      clearTimeout(suppressTimeoutRef.current)
      setSuppressEcho(false)
    }
  }, [defaultState, clickedState, suppressEcho])

  useEffect(() => () => clearTimeout(suppressTimeoutRef.current), [])

  function release(): void {
    releaseRaw()
    if (widget.activeStateExpr) {
      clearTimeout(suppressTimeoutRef.current)
      setSuppressEcho(true)
      suppressTimeoutRef.current = setTimeout(() => setSuppressEcho(false), ECHO_SUPPRESS_TIMEOUT_MS)
    }
  }

  const liveDefaultState = suppressEcho && clickedState && defaultState === clickedState ? widget.states[0] : defaultState
  const state = pressed && clickedState ? clickedState : liveDefaultState

  return { pressed, press, release, state }
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
  // Only a real ButtonWidget ever reaches this component (see its own
  // comment below) — the widget.type check exists purely so TS can see
  // events.doublePress/triplePress exist at all (MorphButtonWidget's own
  // events type has neither).
  // ?? [] guards a dashboard saved before these fields existed — typed as
  // always-present, same "fall back rather than migrate" convention as
  // widget.states elsewhere (see CanvasWidget.tsx's own comment on this).
  const hasDoublePress = widget.type === 'button' && (widget.events.doublePress ?? []).length > 0
  const hasTriplePress = widget.type === 'button' && (widget.events.triplePress ?? []).length > 0
  const multiPressEnabled = hasDoublePress || hasTriplePress
  const { press, release, state } = useTriggerableState(widget, variables, { suppressPressTrigger: multiPressEnabled })
  const { registerTap } = useMultiPressArbiter(widget.id, hasDoublePress, hasTriplePress)

  // Keyboard/assistive-tech activation dispatches a synthetic `click` with
  // no pointer events at all — e.detail === 0 is the standard signal a
  // click was keyboard/AT-synthesized (a real pointer click always reports
  // detail >= 1), used here (and in MorphButtonWidget.tsx's per-block
  // onClick) to fire the same press+release pair pointer gestures do below,
  // so that activation path isn't silently broken by moving the real
  // trigger off the native onClick. Multi-press arbitration deliberately
  // isn't wired in here — assistive tech activation is a discrete "do the
  // thing" signal, not a stream of taps to count.
  function handleKeyboardActivate(): void {
    press()
    release()
  }

  function handlePointerDown(e: React.PointerEvent): void {
    press()
    if (multiPressEnabled) registerTap()
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
  const { press, release, state } = useTriggerableState(widget, variables)
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

interface ViewWidgetProps {
  widget: Widget
  variables: VariableMap
  deckId: string | null
  error?: string
  // Not read by any widget content component — purely a memo-invalidation
  // signal (the store's `customFonts` array reference, see
  // viewWidgetPropsEqual's own comment on why it's compared below). Threaded
  // through as a prop rather than read from the store here so this stays a
  // plain function with no store subscription of its own, same as every
  // other widget content component.
  customFonts: unknown
}

// Only re-render if a variable this SPECIFIC widget's own expressions
// actually reference changed value — not just because `variables` got a
// fresh object reference, which happens on every variables:sync regardless
// of which single variable actually moved (see toVariableMap in
// shared/expr.ts). Without this, a dashboard with one variable ticking once
// a second (e.g. a datetime plugin, or steady DCS-BIOS traffic)
// re-renders EVERY widget on screen every tick — default React.memo (plain
// Object.is per prop) can't tell "variables changed" from "a variable this
// widget doesn't even use changed" apart, which was exactly the cause of a
// reported adjuster-drag stutter recurring on a steady ~1s cadence.
//
// customFonts is checked separately, unconditionally — a label using a
// custom font (WidgetLabel.fontFamily) reads that font's own lineHeight
// override via a plain module-level lookup (registerCustomFonts in
// shared/fonts.ts), not a store subscription, so it's invisible to a normal
// props-equal check. If this widget's very first render lands before that
// font's own fonts:list message is processed (a real race right after
// connect), it bakes in the wrong (default) line-height and then — being
// otherwise fully memoized, correctly, against re-rendering for no reason —
// never gets a second chance to recompute it, staying visibly wrong (a
// multi-line label's lines overlapping) until something else entirely
// happens to force this specific widget to re-render. Comparing customFonts
// here forces exactly the one corrective re-render every widget needs
// whenever that list actually changes, without giving up fine-grained
// memoization the rest of the time.
function viewWidgetPropsEqual(prev: ViewWidgetProps, next: ViewWidgetProps): boolean {
  if (prev.widget !== next.widget || prev.deckId !== next.deckId || prev.error !== next.error) return false
  if (prev.customFonts !== next.customFonts) return false
  if (prev.variables === next.variables) return true
  const deps = widgetVariableDependencies(next.widget)
  if (deps === null) return false
  for (const name of deps) {
    if (prev.variables[name] !== next.variables[name]) return false
  }
  return true
}

// Dispatches on widget.type before any type-specific hooks run — Gauge is
// passive (no action, no pointer handling at all), and Adjuster/Encoder/Morph
// each own their own drag hook (AdjusterView/EncoderView/MorphView above),
// none of which fits TriggerableViewWidget's plain press/release +
// getEffectiveStates model on their own.
// memo'd (with a custom comparator, viewWidgetPropsEqual above, not the
// default shallow-props one) because every widget on a screen otherwise
// re-renders on every single dashboard:sync OR variables:sync, even one
// caused by someone else dragging a single unrelated widget, or a single
// unrelated variable ticking, elsewhere in the deck — see
// reconcileDashboard's own comment in shared/subDecks.ts, which is what
// makes the widget-identity half of this effective (`widget` keeps its old
// reference across a sync whenever THIS widget's own content didn't
// change); viewWidgetPropsEqual's per-widget variable-dependency scoping is
// what makes the variables half of it effective too.
const ViewWidget = memo(function ViewWidget({
  widget,
  variables,
  deckId,
  error
}: ViewWidgetProps): React.JSX.Element {
  // customFonts itself isn't used here — see ViewWidgetProps' own comment,
  // it's only present so viewWidgetPropsEqual can see it change.
  if (widget.type === 'gauge-bar') return <BarGaugeWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'gauge-arc') return <ArcGaugeWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'label') return <LabelWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'line') return <LineWidgetContent widget={widget} variables={variables} />
  if (widget.type === 'screen-capture') return <ScreenCaptureWidgetContent widget={widget} variables={variables} deckId={deckId} />
  if (widget.type === 'dcs-viewport') return <DcsViewportWidgetContent widget={widget} variables={variables} deckId={deckId} />
  if (widget.type === 'adjuster-slider' || widget.type === 'adjuster-knob') return <AdjusterView widget={widget} variables={variables} />
  if (widget.type === 'encoder') return <EncoderView widget={widget} variables={variables} />
  if (widget.type === 'morph') return <MorphView widget={widget} variables={variables} error={error} />
  if (widget.type === 'switch-rocker') return <RockerSwitchView widget={widget} variables={variables} />
  if (widget.type === 'switch-dial') return <DialSwitchView widget={widget} variables={variables} />
  if (widget.type === 'switch-toggle') return <ToggleSwitchView widget={widget} variables={variables} />
  if (widget.type === 'dropdown') return <DropdownView widget={widget} variables={variables} />
  return <TriggerableViewWidget widget={widget} variables={variables} error={error} />
}, viewWidgetPropsEqual)

// Wraps one widget's visibility check + position box + content behind ONE
// memo boundary (viewWidgetPropsEqual — the same per-widget variable-
// dependency scoping ViewWidget itself uses, see its own comment). Previously
// resolveWidgetVisible ran directly in ScreenWidgetsLayer's map body, OUTSIDE
// any memo boundary — a visibleExpr (or any widget's, since this ran for
// every widget regardless of visibility) means a fresh `new Function(...)`
// compiled and run (see tryEvaluateExpression in shared/expr.ts) on EVERY
// widget, on EVERY single variables:sync/delta tick, even the vast majority
// that don't reference whatever one variable just changed. At only a few
// deltas/sec that's still N re-compiles per tick, N being total widget count
// on the deck — independent of message rate or payload size, which is what
// made this show up as steadily climbing device lag under sustained DCS-BIOS
// traffic despite a small, infrequent message stream (buf staying at 0B
// rules out the network/server side entirely — see StatusBar.tsx's own
// device:lag-report tooltip for what buf actually measures).
const ViewWidgetSlot = memo(function ViewWidgetSlot({ widget, variables, deckId, error, customFonts }: ViewWidgetProps): React.JSX.Element | null {
  if (!resolveWidgetVisible(widget, variables)) return null
  const rendered = widget.type === 'morph' ? morphFootprint(widget) : widget
  return (
    <div
      className={`view-canvas__widget${widget.type === 'morph' ? ' view-canvas__widget--morph' : ''}`}
      style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
    >
      <ViewWidget widget={widget} variables={variables} deckId={deckId} error={error} customFonts={customFonts} />
    </div>
  )
}, viewWidgetPropsEqual)

// One deck view's worth of widgets, absolutely positioned within whatever
// positioned box contains this — the fullscreen root canvas below, or an
// OverlayPanel's own smaller box. Extracted so both render sites share the
// exact same morph-footprint/keying logic instead of duplicating it.
export function ScreenWidgetsLayer({
  widgets,
  variables,
  deckId,
  errors,
  customFonts
}: {
  widgets: Widget[]
  variables: VariableMap
  deckId: string | null
  errors: Record<string, string>
  customFonts: unknown
}): React.JSX.Element {
  return (
    <>
      {widgets.map((widget) => (
        <ViewWidgetSlot key={widget.id} widget={widget} variables={variables} deckId={deckId} error={errors[widget.id]} customFonts={customFonts} />
      ))}
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
  const rootCanvasWidth = useDashboardStore((s) => s.dashboard.canvasWidth)
  const rootCanvasHeight = useDashboardStore((s) => s.dashboard.canvasHeight)
  const canvasSize = useMemo(
    () => getSubDeckCanvasSize({ canvasWidth: rootCanvasWidth, canvasHeight: rootCanvasHeight, subDecks }, activeSubDeckId),
    [rootCanvasWidth, rootCanvasHeight, subDecks, activeSubDeckId]
  )
  // Guards against a stale reference — the sub-deck an open overlay names
  // may have been deleted (from the editor) while it was showing.
  const overlaySubDeck = activeOverlay ? findSubDeck({ subDecks }, activeOverlay.subDeckId) : undefined
  // The overlay's own reference resolution (a sub-deck can set its own,
  // independent of the root deck's — see getSubDeckCanvasSize's own
  // comment), so OverlayPanel can letterbox-scale its widgets the exact same
  // way the main canvas below does. Without this, an overlay's widgets
  // rendered at their raw authored x/y/w/h against whatever the panel's own
  // real on-screen box happens to be — correct only by coincidence on a
  // screen that happens to match the design resolution, comically oversized
  // on anything smaller (a phone in particular).
  const overlayCanvasSize = useMemo(
    () =>
      activeOverlay
        ? getSubDeckCanvasSize({ canvasWidth: rootCanvasWidth, canvasHeight: rootCanvasHeight, subDecks }, activeOverlay.subDeckId)
        : null,
    [activeOverlay, rootCanvasWidth, rootCanvasHeight, subDecks]
  )
  const variables = useDashboardStore((s) => s.dashboard.variables)
  const backgroundColor = useDashboardStore((s) => s.dashboard.backgroundColor)
  const backgroundColorExpr = useDashboardStore((s) => s.dashboard.backgroundColorExpr)
  const backgroundImageVersion = useDashboardStore((s) => s.dashboard.backgroundImageVersion)
  const deckId = useDashboardStore((s) => s.deckId)
  const connected = useDashboardStore((s) => s.connected)
  const backgroundFit = useDashboardStore((s) => s.dashboard.backgroundFit)
  const backgroundAnchor = useDashboardStore((s) => s.dashboard.backgroundAnchor)
  const errors = useDashboardStore((s) => s.errors)
  // See ViewWidgetProps' own comment — purely a memo-invalidation signal
  // threaded down to every widget, not read directly here.
  const customFonts = useDashboardStore((s) => s.customFonts)
  // The main canvas's own current scale-to-fit factor (see
  // LetterboxedCanvas's onScaleChange) — an open overlay's own px-based edge
  // size (OpenOverlayAction.size/sizeUnit) is authored against the same
  // design resolution the main canvas is, so it needs the same factor
  // applied rather than being a raw device-pixel measurement.
  const [mainScale, setMainScale] = useState(1)

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

  // TEMP DEBUG LOGGING — same "apply the persisted preference once per
  // mount" shape as the keep-screen-on effect above. Remove alongside the
  // rest of the debug logging once diagnosed.
  useEffect(() => {
    if (isBoarderoniAndroidApp()) setDebugLogging(getDebugLoggingPreference())
  }, [])

  // Falls back to the native searching/found-connect screen if the
  // WebSocket stays disconnected for CONNECTION_LOST_GRACE_MS — store.ts's
  // own close handler already retries every 1.5s on its own for a plain
  // drop, so a brief blip reconnects well within this window and this
  // effect's cleanup (re-run on every `connected` change) cancels the timer
  // before it ever fires. Only reachable while this component stays mounted
  // with `connected` false the whole time — every OTHER close path
  // (DECK_CLOSE_CODE_UNKNOWN, DECK_CLOSE_CODE_DENIED, an explicit
  // disconnect()) sends App.tsx to a different screen entirely, unmounting
  // this and clearing the timer for free. Android only: there's no
  // equivalent "native searching screen" to fall back to in a regular
  // browser, and connectionLost() is already a no-op there regardless (see
  // androidBridge.ts).
  useEffect(() => {
    if (!isBoarderoniAndroidApp() || connected) return
    const timer = setTimeout(connectionLost, CONNECTION_LOST_GRACE_MS)
    return () => clearTimeout(timer)
  }, [connected])

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
      <LetterboxedCanvas canvasWidth={canvasSize.width} canvasHeight={canvasSize.height} onScaleChange={setMainScale}>
        {backgroundImageVersion && deckId && (
          <div
            className="dashboard-wallpaper"
            style={{
              backgroundImage: `url(${backgroundImageUrl(deckId, backgroundImageVersion)})`,
              ...backgroundImageStyle(backgroundFit ?? 'cover', backgroundAnchor ?? 'center')
            }}
          />
        )}
        <ScreenWidgetsLayer widgets={widgets} variables={variableMap} deckId={deckId} errors={errors} customFonts={customFonts} />
      </LetterboxedCanvas>
      {activeOverlay && overlaySubDeck && overlayCanvasSize && (
        <OverlayPanel
          subDeck={overlaySubDeck}
          edge={activeOverlay.edge}
          size={activeOverlay.size}
          sizeUnit={activeOverlay.sizeUnit}
          scale={mainScale}
          canvasWidth={overlayCanvasSize.width}
          canvasHeight={overlayCanvasSize.height}
          variables={variableMap}
          deckId={deckId}
          errors={errors}
          customFonts={customFonts}
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
