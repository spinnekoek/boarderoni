import type {
  DcsBiosFieldCatalogEntry,
  DcsBiosCommandCatalogEntry,
  DcsBiosInputInterface,
  DcsBiosSettings,
  DcsBiosStatus,
  DcsBiosWorkerStats
} from './dcsBiosTypes'

export interface KeypressAction {
  kind: 'keypress'
  keys: string[]
  // 'press' (default when omitted): atomic press-then-release — the only
  // behavior that existed before this field, still what every existing
  // widget does. 'down'/'up' press or release only, with nothing pairing
  // them automatically — pairing a 'down' step with a later 'up' step
  // (typically with a DelayStep between them, see SequenceStep) is how an
  // "advanced" held-key sequence is built, using the same generic sequence
  // mechanism as any other multi-step action rather than a separate editor.
  mode?: 'press' | 'down' | 'up'
}

// JS function body, evaluated (see shared/expr.ts) with `states` — the
// current value of every Variable, keyed by name — in scope. Runs
// server-side on trigger (see main/index.ts's triggerAction); the returned
// value is expected to be a plain object of {variableName: newValue}, and
// every key present gets merged into Dashboard.variables (creating new
// variables for names that don't exist yet). More action kinds (macro, REST
// call, ...) can join this union later.
export interface UpdateStateAction {
  kind: 'update-state'
  code: string
}

// Only offered in the properties panel while 'dcsbios' is enabled in
// Settings (see appSettings.ts) — or if a widget already has one configured,
// so disabling the kind later doesn't silently break existing buttons.
// `aircraft` scopes which aircraft's command catalog this was picked from
// (independent of any EventSource — a button isn't tied to one), so
// re-opening the editor can re-fetch/highlight the same command.
// `interface` is carried alongside `identifier` since the same identifier
// can expose more than one interface (e.g. a switch commonly has both
// `action`/TOGGLE and `set_state`/an explicit position) — each is a wholly
// separate selectable command with its own argument shape.
// `argument` is the static value sent unless `argumentExpr` is set, in which
// case that's evaluated (see shared/expr.ts's tryEvaluateExpression, same
// mechanism as UpdateStateAction.code) with `variables` in scope and the
// result sent instead — same fx-toggle pattern as an EventSourceMapping's
// own `expr`.
export interface SendDcsCommandAction {
  kind: 'send-dcs-command'
  aircraft: string
  identifier: string
  interface: DcsBiosInputInterface
  argument: string
  argumentExpr?: string
}

// Which deck view an action targets: the deck's own main view (its root
// `widgets`), or one specific sub-deck by id. A tiny discriminated union
// rather than a bare nullable id string so "go back to the main deck" is a
// real, self-documenting case instead of a magic null/empty-string
// sentinel. Named distinctly from ScreenRegion/ScreenCaptureWidget's
// "screen" (a physical monitor) — this is a deck-internal view, unrelated.
export type SubDeckTarget = { type: 'main-deck' } | { type: 'sub-deck'; subDeckId: string }

// Switches which deck view is fullscreen on the triggering client — same
// visual effect as picking a different deck from the deck picker, but
// instant (no socket reconnect) since a sub-deck lives in the same
// Dashboard document (see SubDeck below). Client-local: two devices
// connected to the same deck can be on two different views at once (see
// runActionStep in main/index.ts, which replies to the triggering
// WebSocket only, never broadcasts this). Implicitly closes any open
// overlay (see OpenOverlayAction) — a fullscreen switch replaces the whole
// view an overlay would have been layered on top of.
export interface NavigateSubDeckAction {
  kind: 'navigate-subdeck'
  target: SubDeckTarget
}

export type OverlayEdge = 'top' | 'bottom' | 'left' | 'right'
export type OverlaySizeUnit = 'px' | 'percent'

// Slides a sub-deck in as a panel anchored to one edge of the screen,
// layered over whatever's currently fullscreen — a lighter-weight
// alternative to NavigateSubDeckAction for e.g. a settings/menu panel that
// shouldn't replace the whole view. Always names a specific sub-deck
// (unlike NavigateSubDeckAction.target, there's no 'main-deck' case here —
// "slide the main deck in as a panel over itself" isn't a meaningful
// action). Only one overlay open at a time on a given client; opening a
// second one replaces whichever was already open, and the client also
// supports dismissing it locally (tap outside, no server round trip) —
// see CloseOverlayAction for the explicit, sequenceable alternative meant
// for a close/back button placed inside the panel itself.
export interface OpenOverlayAction {
  kind: 'open-overlay'
  subDeckId: string
  edge: OverlayEdge
  size: number
  sizeUnit: OverlaySizeUnit
}

// Dismisses whichever overlay (if any) is currently open on the device
// that triggers this — a no-op if none is open. Round-trips through the
// server like every other action kind (rather than being intercepted
// client-side) so it composes with delays/other steps in the same
// sequence, same reasoning as NavigateSubDeckAction/OpenOverlayAction.
export interface CloseOverlayAction {
  kind: 'close-overlay'
}

// The default for a freshly-added sequence step — does nothing when run
// (see runActionStep in main/index.ts). Lets a step exist as a placeholder
// (e.g. mid-sequence, or while deciding what it should do) without silently
// firing a keypress with no keys bound, which is what an empty-default
// KeypressAction used to do.
export interface NoneAction {
  kind: 'none'
}

// One placeholder's resolved value within a CallRestAction — same
// value/argumentExpr split as SendDcsCommandAction.argument/argumentExpr:
// `expr` (when set) takes precedence over the static `value`. `placeholder`
// matches a {{name}} token found in the target RestDataSource's
// outgoing.payloadTemplate at execution time (see extractPlaceholders in
// shared/restPlaceholders.ts) — a stale entry whose token no longer exists
// in the template is simply ignored, not an error.
export interface CallRestPlaceholderValue {
  placeholder: string
  value: string
  expr?: string
}

// Posts a configured RestDataSource's outgoing payload (see main/index.ts's
// runCallRestAction). Only offered in the properties panel for a
// currently-enabled, outgoing-configured RestDataSource — or if a widget
// already has one configured, so disabling/deleting the source later
// doesn't silently break existing buttons (same convention
// SendDcsCommandAction's own comment describes for 'dcsbios').
export interface CallRestAction {
  kind: 'call-rest'
  dataSourceId: string
  values: CallRestPlaceholderValue[]
}

export type WidgetAction =
  | NoneAction
  | KeypressAction
  | UpdateStateAction
  | SendDcsCommandAction
  | NavigateSubDeckAction
  | OpenOverlayAction
  | CloseOverlayAction
  | CallRestAction

// A pause between two steps in an event's sequence (see SequenceStep) —
// not a field on the following action step, so it can be added/removed/
// reordered as its own list entry, independent of whatever action (if any)
// comes after it.
export interface DelayStep {
  kind: 'delay'
  id: string
  delayMs: number
}

// One WidgetAction embedded in an event's sequence. `id` is independent of
// anything inside `action` — stable list identity for the properties
// panel's reorder/delete, same convention as WidgetLabel.id/WidgetState.id.
export interface ActionStep {
  kind: 'action'
  id: string
  action: WidgetAction
}

// One interaction event's full sequence is SequenceStep[], run in array
// order by runSequence (main/index.ts), aborting at the first step that
// throws. Deliberately a flat, explicit, timestamp-free list — a future
// macro recorder can just push {kind:'action',...}/{kind:'delay',...}
// entries onto this same array as it records, with no separate data model
// to reconcile.
export type SequenceStep = DelayStep | ActionStep

// Which interaction moments a widget can attach a sequence to. Only
// AdjusterWidget uses 'move' (continuous, while dragging); 'increment'/
// 'decrement' are EncoderWidget's own (one per completed step of rotation)
// and, separately, DialSwitchWidget's own (one per selection that lands on a
// higher/lower position index — see DialSwitchWidget.events' own comment).
// 'select' is a switch widget's (RockerSwitchWidget/DialSwitchWidget/
// ToggleSwitchWidget/DropdownWidget) own per-POSITION trigger moment, but
// deliberately NOT resolved through eventKindsFor/getEventSteps below —
// unlike every other kind here, which position's sequence runs depends on
// which position was picked, so it's carried as the 'action:trigger'
// message's own `value` (the target position's index) and dispatched
// specially in triggerAction (main/index.ts) instead. It's still a member of
// this union so that message's `event` field can legally carry it.
// 'positionChange' is the root-level counterpart that runs alongside it
// regardless of which position fired it — see RockerSwitchWidget.events'
// own comment. See eventKindsFor/getEventSteps in shared/widgetEvents.ts,
// the single source of truth for which of the rest apply to which widget
// type.
export type WidgetEventKind = 'press' | 'release' | 'move' | 'increment' | 'decrement' | 'select' | 'positionChange'

// x/y/w/h are absolute CSS pixels on the dashboard canvas — not grid units.
// A widget is always rendered at exactly this pixel size on every client, no
// responsive scaling, so what you place inside a device's bounds rectangle
// in the editor is exactly what fits on that device's screen.
export type HorizontalAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'center' | 'bottom'

// Each label is an independently-styled/positioned text layer within the
// button's box — no auto-stacking, so two labels sharing the same
// align/verticalAlign simply overlap. Keybindings stay on the widget itself
// (see ButtonWidget.action) since they trigger the button, not a label.
export interface WidgetLabel {
  id: string
  text: string
  // When set, evaluated (see resolveLabelText in shared/expr.ts) and used
  // instead of `text` — same expression mechanism as ColorAppearance's
  // colorExpr below, just returning display text instead of a color.
  textExpr?: string
  fontFamily?: string
  fontSize?: number
  textColor?: string
  // Same idea as ColorAppearance's colorExpr (see resolveTextColor in
  // shared/expr.ts) — independent of textExpr, which drives the label's
  // displayed text content, not its color.
  textColorExpr?: string
  textOpacity?: number
  // The label's own background fill, independent of whatever widget it sits
  // on top of. Unset (the default) is fully transparent — see
  // renderWidgetLabel in labels.tsx, which skips withOpacity entirely rather
  // than resolving a literal 'transparent' through it. No colorExpr/auto
  // mode, matching ColorPickerButton's own "plain background color field"
  // precedent (no derived value to fall back to here).
  backgroundColor?: string
  backgroundOpacity?: number
  // Where this label's box sits within the widget it belongs to (or, for a
  // detent-anchored label, within its own small wrapper — see labelAnchor
  // below).
  align?: HorizontalAlign
  verticalAlign?: VerticalAlign
  // How the text itself is set within that box — independent of `align`
  // above, so e.g. a label box pinned to the right edge can still have its
  // (possibly multi-line, via a ␤ token) text centered within itself rather
  // than also hugging the right. Unset defaults to `align`, matching the
  // single shared value this used to be before the two were split.
  textAlign?: HorizontalAlign
  padding?: number
  // DialSwitchWidget only — where THIS label sits relative to its position's
  // detent dot. Unset (the default) places it radially outward along that
  // detent's own angle, just past the dial's rim, so it reads correctly
  // regardless of which side of the ring it's on. A fixed side instead pins
  // just this one label there, independent of every other label — e.g. one
  // label that collides with something else on the dashboard can be pinned
  // aside without disturbing the rest (including its own position's other
  // labels, if it has more than one).
  labelAnchor?: 'top' | 'bottom' | 'left' | 'right'
  // DialSwitchWidget only — how far THIS label sits from its detent dot, in
  // the same 0-100 viewBox units as DialSwitchWidget.detentRadius. Only
  // affects automatic (radial) placement, i.e. labelAnchor unset — a label
  // pinned to a fixed side ignores this. Unset uses the fixed LABEL_OFFSET.
  labelDistance?: number
}

// Purely geometric per-side appearance shared by anything rendered as a
// bordered/rounded box: a plain button's per-state look, and a morph block's
// per-state override (see MorphBlockStateOverride below) — both need the
// exact same three knobs, just sourced differently (always-manual for a
// plain button; auto-fit-computed-or-manual for a morph block).
export interface BoxAppearance {
  // Per-side inset (px) on top of the widget's own x/y/w/h. Negative values
  // (down to -1) expand the box outward instead of shrinking it.
  spacingTop?: number
  spacingRight?: number
  spacingBottom?: number
  spacingLeft?: number
  // Per-corner border radius (px).
  radiusTopLeft?: number
  radiusTopRight?: number
  radiusBottomLeft?: number
  radiusBottomRight?: number
  // Per-side border thickness (px) — 0 removes that side's border entirely
  // (used by morph auto-fit to drop the border on a seam between two
  // touching blocks, on top of the -1 spacing/0 radius there).
  borderWidthTop?: number
  borderWidthRight?: number
  borderWidthBottom?: number
  borderWidthLeft?: number
}

// Fill/border color+opacity, shared by a widget's own per-state look and a
// morph block's per-state override (see MorphBlockStateOverride below) — a
// block's override falls back to the widget's own state fields wherever
// it's unset (see effectiveBlockColor in shared/morph.ts), so by default
// every block matches the widget and only diverges where you explicitly
// override it.
export interface ColorAppearance {
  color?: string
  // When set, evaluated (see resolveColor in shared/expr.ts) with `states`
  // in scope and used instead of `color` — a JS expression instead of a
  // fixed value, e.g. to derive this look from a Variable's current value.
  colorExpr?: string
  borderColor?: string
  // Same idea as colorExpr, but for borderColor (see resolveBorderColor in
  // shared/expr.ts). Independent of colorExpr — a widget can have a static
  // background with an expression-driven border, or vice versa.
  borderColorExpr?: string
  backgroundOpacity?: number
  borderOpacity?: number
}

// A named, independently-styled visual variant of a widget. "Default" (the
// first entry, always present) is the idle look; "Clicked" (conventionally
// the second entry) is shown while the button is held on the view client.
// Anything past those two is inert for now — no runtime mechanism switches to
// them yet, that's future state-machine work — but they're fully editable so
// design work can get ahead of it.
export interface WidgetState extends BoxAppearance, ColorAppearance {
  id: string
  name: string
  labels: WidgetLabel[]
  // CSS z-index override for this state, independent of every other
  // state's — e.g. a "Clicked" state can pop above neighboring widgets
  // while held, overriding the default paint-order stacking (see
  // useDashboardStore's bringToFront/sendToBack for the array-order
  // fallback every widget uses when this is unset).
  zIndex?: number
  // Marks the one state that plays while the button is held on the view
  // client (see getEffectiveStates in shared/states.ts) — a structural flag,
  // not derived from `name`, so renaming some other state to "Clicked"
  // doesn't make it activate on tap. Set only on the state created by
  // enabling states the first time, or by "Reset states"; never on a
  // manually-added state.
  isClicked?: boolean
}

export interface ButtonWidget {
  id: string
  type: 'button'
  x: number
  y: number
  w: number
  h: number
  // Two interaction moments a button can fire a sequence from — press
  // (pointerdown) and release (pointerup/cancel/leave). See SequenceStep;
  // either can be empty (no steps configured for that moment).
  events: { press: SequenceStep[]; release: SequenceStep[] }
  // Off (default): only "states[0]" is editable; a lightened version of its
  // color stands in for "clicked" automatically. On: every state is exposed
  // and independently configurable in the properties panel.
  statesEnabled?: boolean
  states: WidgetState[]
  // Optional JS expression (see shared/expr.ts) returning the exact `name`
  // of the state that should be the "base" state on the view client — e.g.
  // `return variables.BATTERY_SW === 0 ? 'Default' : 'Active';`. Only
  // meaningful when statesEnabled is on; falls back to states[0] if unset,
  // throws, or names a state that doesn't exist. Independent of isClicked —
  // the resolved state still gets swapped for the Clicked one while pressed.
  activeStateExpr?: string
}

// Grid-relative, NOT normalized to a 0-based origin — col/row 0 always maps
// to the widget's own (x, y) regardless of which blocks actually exist, so
// extending a shape "up" or "left" (negative col/row) never requires
// rewriting x/y or other blocks to compensate (normalizeMorphBlocks folds
// this back to 0-based after every add/remove). Must stay 4-connected (every
// block reachable from any other via shared edges) — that's what "acting as
// one button" depends on.
export interface MorphCell {
  col: number
  row: number
}

// A block's per-state appearance. With autoFit on (the default for a new
// block), any side touching another block of this SAME widget is computed
// automatically (spacing -1, radius 0, border 0 on that side — see
// effectiveBlockAppearance in shared/morph.ts) and its fields here are
// ignored/disabled in the UI; a side with no neighbor always falls back to
// the manual value here regardless of autoFit. With autoFit off, every side
// is manual, same as a plain button's state. Color fields are unrelated to
// autoFit — always either an explicit per-block override or inherited from
// the widget's own state (see ColorAppearance above); nothing stops two
// blocks of the same widget from ending up different colors if you set them
// that way yourself.
export interface MorphBlockStateOverride extends BoxAppearance, ColorAppearance {
  autoFit?: boolean
}

// One base cell of a morph button. Its appearance can differ per widget
// state (e.g. auto-fit merged in "Default", manually pulled apart in some
// other state) — keyed by WidgetState.id rather than a parallel array so
// reordering/adding/removing states doesn't require reindexing every block.
export interface MorphBlock extends MorphCell {
  id: string
  perState: Record<string, MorphBlockStateOverride>
}

// A button whose hit area is a union of grid blocks rather than one
// rectangle — e.g. a U-shaped run of blocks that still triggers one action
// and shows one label/state, like several ButtonWidgets fused into one.
// cellW/cellH size every block uniformly; there's no per-block size. Labels,
// keys, and the states list itself are shared by the whole widget (one set
// of states for all blocks) — color, spacing, radius, and border (via
// perState on each block) can all differ block to block.
export interface MorphButtonWidget {
  id: string
  type: 'morph'
  x: number
  y: number
  cellW: number
  cellH: number
  blocks: MorphBlock[]
  // Same press/release event model as ButtonWidget — shared by the whole
  // fused-block widget, one pair of sequences for all blocks. `move` is
  // optional (existing saved dashboards predate it) and only meaningful
  // when isMorphSliderActive(widget) (see shared/morph.ts) — read sites
  // default a missing array to [], same as a missing `move` kind on any
  // other non-adjuster widget already falls back to "no steps."
  events: { press: SequenceStep[]; release: SequenceStep[]; move?: SequenceStep[] }
  statesEnabled?: boolean
  states: WidgetState[]
  activeStateExpr?: string
  // Opt-in drag handle that follows the shape's own longest block-to-block
  // path (see findMorphSliderPath in shared/morph.ts) — only meaningful,
  // and only ever actually active, when the shape is a loop-free path of
  // 2+ blocks; see isMorphSliderActive, the single source of truth for
  // whether the slider actually renders/fires regardless of this flag.
  sliderEnabled?: boolean
  // Same meaning as AdjusterWidget.valueExpr below: where the handle sits
  // (0-100, along the path) while not being dragged, e.g. reflecting
  // another variable back into the visual. Falls back to 0 if unset or
  // unresolved.
  valueExpr?: string
}

// Passive value display — a filled bar or arc showing valueExpr's result
// against min/max. No action: nothing to trigger, so it's never clickable
// on the view client.
// One ring of evenly-spaced tick marks around an arc-style GaugeWidget's
// sweep, each optionally labeled with its own auto-computed value — e.g. a
// speedometer's major (numbered) and minor (unnumbered) ticks, each its own
// independent GaugeTickSet so they can be sized/colored/spaced completely
// differently. Multiple sets are addable/removable in the properties panel
// (see GaugeWidget.tickSets), same list convention as SwitchPosition arrays
// elsewhere. Rendered the same way DialSwitchWidget's own 'tick' detent
// shape is (a small rect, rotated to point radially — see DETENT_SIZE in
// DialShapeGraphic.tsx), so a tick set's color/border/size read the same as
// everywhere else a "tick" appears in this app.
export interface GaugeTickSet {
  id: string
  // How many ticks span min..max inclusive — 2 draws exactly one at each
  // end; anything higher adds evenly-spaced ticks between them. Default 5.
  count?: number
  color?: string
  opacity?: number
  borderColor?: string
  borderWidth?: number
  // Each tick's radial length, in the same 0-100 viewBox units as
  // GaugeWidget's own arc radius. Default 6.
  size?: number
  // Each tick's thickness along the arc (not radially). Default 2.
  thickness?: number
  // Distance from the gauge's true center to a tick's INNER edge. Unset
  // defaults to just outside the arc's own stroke.
  distance?: number
  showLabels?: boolean
  labelColor?: string
  labelFontSize?: number
  // Decimal places shown on each tick's auto-generated value label. Default 0.
  labelDecimals?: number
  // Extra distance from a tick's own outer edge to its label — same
  // "distance past the anchor point" convention as WidgetLabel.labelDistance
  // elsewhere.
  labelDistance?: number
}

export interface GaugeWidget {
  id: string
  type: 'gauge'
  x: number
  y: number
  w: number
  h: number
  // JS function body (see resolveNumericExpr in shared/expr.ts), `variables`
  // in scope, must return a number — any other outcome (throw, wrong type,
  // NaN/Infinity) falls back to `min`.
  valueExpr: string
  min: number
  max: number
  style: 'bar' | 'arc'
  orientation?: 'horizontal' | 'vertical' // bar only, default 'horizontal'
  startAngle?: number // arc only, degrees, default 135
  endAngle?: number // arc only, degrees, default 405 (270° sweep)
  fill: ColorAppearance
  track: ColorAppearance
  labels: WidgetLabel[]
  // The whole widget's own backing fill, behind track/fill/ticks/indicator
  // alike — Bar and Arc both. Unset (the default) is fully transparent, same
  // "skip withOpacity entirely rather than resolve a literal 'transparent'"
  // convention as WidgetLabel.backgroundColor in labels.tsx.
  backgroundColor?: string
  backgroundOpacity?: number
  // Arc style only. When the sweep is less than a full circle, the arc's
  // own bounding box (not the full circle it's a slice of) is fit to the
  // widget's box — see arcBoundsUnit in arcPath.ts — so e.g. a single
  // quarter-circle sweep fills the whole widget instead of sitting tiny in
  // one corner of a viewBox sized for the full circle, with the true center
  // landing wherever that bounding box puts it (the opposite corner from
  // the missing sweep). Tick marks/labels are deliberately excluded from
  // that fit — they're allowed to extend past the widget's own edges rather
  // than shrinking the arc further to make room for them.
  tickSets?: GaugeTickSet[]
  // Arc style only — a needle pointing at the current value, drawn with the
  // same needlePoints math DialSwitchWidget's own needle uses. Off by
  // default (the arc fill already shows the value), so an existing
  // dashboard's gauge renders unchanged until this is deliberately turned
  // on.
  showIndicator?: boolean
  // 'needle' (default) is the same tapered pointer DialSwitchWidget uses;
  // 'square' is a plain radial bar instead.
  indicatorShape?: 'needle' | 'square'
  indicatorColor?: string
  // Where the needle/square's own drawn shape starts/ends, as distances
  // from the gauge's true center — NOT necessarily starting at center, so
  // e.g. a needle can float as a short segment out near the arc instead of
  // always running from the pivot. Defaults: start 0, end ~70% of the arc
  // radius (today's old fixed indicatorLength, unchanged in effect).
  indicatorStartDistance?: number
  indicatorEndDistance?: number
  // Half-width — the needle/square's own thickness, perpendicular to its
  // radial direction.
  indicatorWidth?: number
  // The hub the needle/square appears to pivot from — always drawn at the
  // true center (distance 0) regardless of indicatorStartDistance, and
  // independent of the needle/square's own color/border. Size 0 draws none.
  indicatorCenterSize?: number
  // Defaults to indicatorColor (so an untouched hub reads as part of the
  // needle rather than a separately-colored overlay) — deliberately never
  // fill/track, same reasoning as indicatorColor itself.
  indicatorCenterColor?: string
  indicatorCenterBorderColor?: string
  indicatorCenterBorderWidth?: number
  // Bar style only — an arc has no rectangular box to round/border, so these
  // are hidden from the properties panel (and not applied to the outer
  // container) whenever style is 'arc'. Per-corner/per-side, same as
  // BoxAppearance's own radius/border fields, so the properties panel can
  // reuse CornersInputGrid/SidesInputGrid as-is.
  radiusTopLeft?: number
  radiusTopRight?: number
  radiusBottomLeft?: number
  radiusBottomRight?: number
  borderWidthTop?: number
  borderWidthRight?: number
  borderWidthBottom?: number
  borderWidthLeft?: number
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
  zIndex?: number
}

// A drag-to-set-a-value control — a slider (linear drag) or knob (rotary
// drag). Reuses the exact same WidgetAction kinds/editor as ButtonWidget
// (keypress/update-state/send-dcs-command are all equally available —
// nothing here is specific to any one data source), just with the live drag
// position additionally exposed as `variables.$value` while dragging (see
// evaluateMappingExpression in shared/expr.ts, the same convention an
// EventSourceMapping's own `expr` already uses) for whichever expression
// field the chosen action kind reads.
export interface AdjusterWidget {
  id: string
  type: 'adjuster'
  x: number
  y: number
  w: number
  h: number
  style: 'slider' | 'knob'
  orientation?: 'horizontal' | 'vertical' // slider only, default 'vertical'
  startAngle?: number // knob only, degrees, default 135
  endAngle?: number // knob only, degrees, default 405
  min: number
  max: number
  // Rest-position fallback for the handle while not being dragged (e.g.
  // reflect a variable back into the visual) — same mechanism as Gauge's
  // valueExpr. Falls back to `min` if unset/unresolved.
  valueExpr?: string
  // Same press/release model as ButtonWidget, plus 'move' — fires
  // continuously (throttled) while dragging, with the live position exposed
  // as `variables.$value` same as press/release get for their own moment
  // (initial touch position for press, final settled position for release).
  events: { press: SequenceStep[]; release: SequenceStep[]; move: SequenceStep[] }
  fill: ColorAppearance
  track: ColorAppearance
  labels: WidgetLabel[]
  // Slider style only — a knob has no rectangular box to round/border, same
  // reasoning as GaugeWidget's own radius/border fields above.
  radiusTopLeft?: number
  radiusTopRight?: number
  radiusBottomLeft?: number
  radiusBottomRight?: number
  borderWidthTop?: number
  borderWidthRight?: number
  borderWidthBottom?: number
  borderWidthLeft?: number
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
  zIndex?: number
}

// A relative rotary control for DCS-BIOS's `fixed_step` interface (INC/DEC)
// — radio frequency knobs, altimeter pressure, radar range/gain, and any
// other control with no fixed endpoint. Unlike AdjusterWidget, this owns no
// absolute position: dragging in a circular motion (see useEncoderDrag.ts)
// accumulates rotation and fires `increment`/`decrement` once per
// `stepDegrees` crossed, exactly mirroring how a real encoder just reports
// "turned one detent" rather than "now at X." A tap that never crosses the
// threshold instead fires `press`/`release` — many real encoders (CDU data
// knob, HSI course knob) are also push-buttons.
export interface EncoderWidget extends DialShapeStyle {
  id: string
  type: 'encoder'
  x: number
  y: number
  w: number
  h: number
  // Degrees of accumulated drag rotation that fire one increment/decrement
  // step — smaller is more sensitive. Default 15 (see useEncoderDrag.ts).
  stepDegrees?: number
  // Rest-position fallback for the grip marker while not being dragged —
  // same mechanism as AdjusterWidget's own valueExpr, just returning degrees
  // (0 = up, clockwise) instead of a min..max value, since this widget has no
  // fixed range of its own. Typical use: pair with an increment/decrement
  // action that nudges a Variable by stepDegrees, so the grip visually
  // tracks it. Falls back to 0 if unset/unresolved.
  valueExpr?: string
  events: { increment: SequenceStep[]; decrement: SequenceStep[]; press: SequenceStep[]; release: SequenceStep[] }
  // Grip color (used by every dialShape: the needle itself, or the square/
  // circle knob's own color fallback — see DialShapeStyle's squareColor/
  // circleColor, which each fall back to this when unset).
  fill: ColorAppearance
  track: ColorAppearance // dial face color
  labels: WidgetLabel[]
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
  zIndex?: number
}

// One selectable position of a switch widget — its own look and its own
// command, since (unlike a plain button's WidgetState) each position is a
// real, independently-triggerable target, not just a visual variant. `id` is
// stable list identity for the properties panel's reorder/delete, same
// convention as WidgetState.id.
export interface SwitchPosition extends ColorAppearance {
  id: string
  name: string
  labels: WidgetLabel[]
  // Runs once, server-side, when this position is tapped (see triggerAction's
  // switch branch in main/index.ts) — same SequenceStep[] mechanism as a
  // button's press/release, just keyed by position instead of by event kind.
  onSelect: SequenceStep[]
  // This position's look while it's the active one — `color`/`colorExpr`
  // above are the unselected/idle look. Both unset (the default) means
  // "Auto": derived by lightening the resolved unselected color by
  // AUTO_CLICKED_LIGHTEN, same treatment ButtonWidget's auto-derived
  // "Clicked" state gets (see pickAutoActiveColor in shared/color.ts) —
  // computed at render time, not stored, so it always tracks a live/
  // expression-driven base color instead of going stale.
  activeColor?: string
  activeColorExpr?: string
  // Independent of the unselected color's own backgroundOpacity — same
  // "each distinct color field gets its own opacity" convention every other
  // color pair in this app follows (e.g. background vs border).
  activeOpacity?: number
  // ToggleSwitchWidget only — Rocker/Dial/Dropdown leave this unused, same
  // as they leave DetentStyle's dial-only fields unused elsewhere. Only
  // meaningful on a toggle's first/last position (never its middle one,
  // which has no momentary config at all — see the properties panel's own
  // gating): pressing/dragging to a momentary position selects it (fires
  // onSelect) only while held, springing back to the middle position (fires
  // ITS onSelect too) the instant you release — see ToggleSwitchView in
  // ViewCanvas.tsx and useToggleSwitchDrag.ts.
  momentary?: boolean
}

// Shared by RockerSwitchWidget/DialSwitchWidget below — everything about a
// discrete N-position switch (2+) for DCS-BIOS's `set_state` interface EXCEPT
// its visual shape, which the two concrete widget types (a segmented rocker
// vs. a labeled rotary dial are different enough widgets, not style variants
// of one — see their own comments) provide independently.
//
// Unlike ButtonWidget's states, each SwitchPosition is directly selectable
// (not just a visual look). Tapping one always fires its own onSelect
// sequence server-side — but which position then LOOKS active is otherwise
// deliberately client-local, not persisted/broadcast dashboard state: a
// physical switch on one tablet shouldn't visually flip on someone else's
// phone just because they share a deck, unless the user explicitly wires
// that up. `activePositionExpr`, when set, names the active position by
// `name` — same convention as ButtonWidget.activeStateExpr — evaluated
// against the (globally-synced) Variables, so a switch only shows the same
// position everywhere when its position is deliberately derived from shared
// state. Unset (the default), each connected client just remembers whichever
// position it last tapped, locally (see useSwitchPosition.ts) — exactly like
// a real switch's position is a property of the physical panel in front of
// you, not something every other panel in the cockpit shares. What's
// deliberately still NOT here: which position is "current" — see above.
interface SwitchWidgetBase {
  positions: SwitchPosition[] // at least 2, in throw/rotation order
  activePositionExpr?: string
  zIndex?: number
}

// A segmented rocker/toggle switch — gear lever, master arm, band switch.
// Positions render as adjoining segments stacked along `orientation`.
export interface RockerSwitchWidget extends SwitchWidgetBase {
  id: string
  type: 'switch-rocker'
  x: number
  y: number
  w: number
  h: number
  orientation?: 'horizontal' | 'vertical' // default 'vertical'
  track: ColorAppearance // base container behind the segments
  // Root-level, alongside (not instead of) each position's own onSelect —
  // see SwitchPosition.onSelect's own comment. `press`/`release` fire on
  // every physical press/release of the widget regardless of which segment
  // (if any) it lands on, same press/release convention EventfulWidget
  // types use. `positionChange` fires whenever ANY position is selected,
  // in addition to that position's own onSelect running — with
  // variables.$value/$index (that position's name/index — see TriggerValue
  // in main/index.ts) in scope, so one shared sequence can still tell which
  // position actually fired it, e.g. for a DCS command whose argument
  // depends on which position was picked, without copy-pasting that
  // sequence into every position.
  events: { press: SequenceStep[]; release: SequenceStep[]; positionChange: SequenceStep[] }
  // Labels anchored to the widget as a whole (e.g. a switch name/legend),
  // independent of each position's own labels (SwitchPosition.labels) — same
  // flat-list convention as Gauge/Adjuster/Encoder/Toggle/Dial's own
  // `labels`. Deliberately NOT rotated by rotateAngle below — see its own
  // comment — while a position's own labels (rendered inside the rotated
  // body) do rotate with it.
  labels: WidgetLabel[]
  // Spins the rocker's own body — shape, segments, AND each position's own
  // labels — in place around the widget's center; degrees, clockwise, 0 is
  // unrotated. This widget-level `labels` array above is rendered OUTSIDE
  // that rotated body on purpose, so a legend/title stays upright regardless
  // of how the switch itself is tilted.
  rotateAngle?: number
  // Off (default): matches every other switch widget — the deployed view
  // client defaults to position 0 active until something's actually tapped,
  // then keeps whichever position was last tapped highlighted (see
  // useSwitchPosition.ts). On: there's no default-active position at all
  // (nothing highlighted until a tap, or activePositionExpr resolves one),
  // AND a tap's own highlight doesn't stick — it reverts to nothing active
  // right after, like a self-centering/momentary rocker with no resting
  // "on" look. Either way, tapping a position always fires its onSelect —
  // this only ever affects which segment (if any) LOOKS active, never
  // whether a tap triggers.
  settleToInactive?: boolean
  radiusTopLeft?: number
  radiusTopRight?: number
  radiusBottomLeft?: number
  radiusBottomRight?: number
  borderWidthTop?: number
  borderWidthRight?: number
  borderWidthBottom?: number
  borderWidthLeft?: number
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
}

// A physical panel toggle — gear handle, master arm, BATT switch. A single
// round bezel (always a true circle, same "SVG viewBox scales uniformly"
// convention as DialSwitchWidget's dial face — see ToggleSwitchWidget.tsx's
// own comment) holds one lever that points between 2 or 3 throws (unlike
// Rocker/Dial's arbitrary N — the properties panel caps it) — straight up
// for the first position, straight down for the last (or left/right for
// 'horizontal'). Unlike RockerSwitchWidget's adjoining colored segments,
// only one lever is ever drawn, so per-position look lives in `fill`/`track`
// (fixed, not per-SwitchPosition) — a position's own `color`/`activeColor`
// fields (inherited from SwitchPosition) go unused here, same as
// DialSwitchWidget's ring detents leave DetentStyle's unrelated fields
// unused. With exactly 3 positions, the middle one renders as a plain circle
// instead of a lever pointing sideways — the "center" look a real
// 3-position toggle's neutral throw gets (e.g. a BATT switch's OFF) — see
// ToggleSwitchWidgetContent's isMiddlePosition. Each position's `name` is
// fixed by the properties panel, not freely editable, to "Top"/"Bottom" (2
// positions) or "Top"/"Middle"/"Bottom" (3) — activePositionExpr and each
// position's momentary config (see SwitchPosition.momentary) both key off
// these names, so they can't drift from what's actually rendered where.
// Each position's own labels still place themselves the same way a
// DialSwitch detent's do — via each WidgetLabel's own labelAnchor,
// defaulting to 'auto' (radially outward at that position's own angle).
export interface ToggleSwitchWidget extends SwitchWidgetBase {
  id: string
  type: 'switch-toggle'
  x: number
  y: number
  w: number
  h: number
  // Labels anchored to the widget as a whole (e.g. a switch name/legend),
  // independent of each position's own labels (SwitchPosition.labels) —
  // same flat-list convention as Gauge/Adjuster/Encoder's own `labels`,
  // rendered as absolutely-positioned overlays via renderWidgetLabels.
  labels: WidgetLabel[]
  // Root-level, alongside (not instead of) each position's own onSelect —
  // see RockerSwitchWidget.events' own comment for the full reasoning
  // (same convention here).
  events: { press: SequenceStep[]; release: SequenceStep[]; positionChange: SequenceStep[] }
  orientation?: 'horizontal' | 'vertical' // default 'vertical'
  // 'tap' (default): tap a zone (or its label) to select that position
  // directly. 'drag': press anywhere on the widget and drag toward the
  // position you want, same gesture as DialSwitchWidget's own drag mode —
  // see useToggleSwitchDrag.ts, which (unlike Dial's drag) also fires a
  // momentary position's onSelect live as the drag reaches it, not just on
  // release, since a momentary throw has nothing meaningful to "commit"
  // later — see SwitchPosition.momentary.
  interactionMode?: 'tap' | 'drag'
  track: ColorAppearance // bezel color
  fill: ColorAppearance // lever color
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
  // The bezel's own stroke width, in the same 0-100 viewBox units as
  // bezelRadius below. Defaults to 2 (the width it was hardcoded to before
  // this became configurable) in ToggleSwitchWidget.tsx.
  borderWidth?: number
  // The base/bezel circle's own radius, in the same 0-100 viewBox units as
  // BEZEL_RADIUS (its default) in ToggleSwitchWidget.tsx. The label ring
  // scales off whichever value is effective, so shrinking/growing the bezel
  // doesn't leave labels anchored to the old rim position — leverLength
  // below is independent and NOT clamped to this, so a lever can be sized
  // to intentionally poke out past a shrunk bezel.
  bezelRadius?: number
  // The lever's own length (from the pivot at the bezel's center out to its
  // tip) and border — independent of the bezel's border above. Length
  // defaults to LEVER_LENGTH, border to none (width 0), both in
  // ToggleSwitchWidget.tsx.
  leverLength?: number
  leverBorderColor?: string
  leverBorderWidth?: number
  // The plain circle drawn instead of a lever at an odd-count switch's exact
  // middle position (see isMiddlePosition) — a distinct look from the lever/
  // `fill` above, since a real 3-way toggle's neutral throw often reads as a
  // different center rather than just "the lever pointing at itself". Color/
  // opacity default to `fill`'s own (so an existing dashboard's middle
  // position keeps its prior look until deliberately overridden); size
  // defaults to CIRCLE_RADIUS, border to none (width 0) — all in
  // ToggleSwitchWidget.tsx.
  circleColor?: string
  circleOpacity?: number
  circleRadius?: number
  circleBorderColor?: string
  circleBorderWidth?: number
}

// Shared shape geometry for a small marker — either one of a DialSwitchWidget's
// ring detents, or its dial-center indicator dot. Deliberately excludes fill
// color (per-position for ring detents, a single field for the indicator —
// different enough between the two callers that it stays outside this type)
// and the shape enum itself (each caller keeps its own `*Shape` field so an
// already-saved widget's detentShape survives this type existing at all).
export interface DetentStyle {
  width?: number
  height?: number
  borderWidth?: number
  borderColor?: string
  borderRadius?: number
}

// Independent per-side border width / per-corner border radius for a
// square-shaped indicator — same box-model shape as the per-side fields
// Dropdown/RockerSwitch widgets already use (see SidesInputGrid/
// CornersInputGrid in PropertiesPanel.tsx). Only meaningful when the field
// it's attached to (indicatorSquareBorder) is present AND that indicator's
// shape is 'square' — an SVG <rect> can't express per-side stroke-width or
// per-corner radius on its own, so a 'square' indicator renders as a plain
// HTML div using real CSS border-*-width/border-radius instead, which is
// what this type's fields map onto directly. Any side/corner left unset
// falls back to the owning DetentStyle's own scalar borderWidth/borderRadius
// (and ultimately to DetentShapeEditor's per-shape default), so leaving this
// entirely unset looks identical to the old single-scalar behavior.
export interface SquareBorderStyle {
  widthTop?: number
  widthRight?: number
  widthBottom?: number
  widthLeft?: number
  radiusTopLeft?: number
  radiusTopRight?: number
  radiusBottomLeft?: number
  radiusBottomRight?: number
}

// The dial-shape/indicator vocabulary shared by DialSwitchWidget's own dial
// and EncoderWidget's grip — both widgets extend this instead of duplicating
// it, so a shared renderer (DialShapeGraphic) and shared properties-panel
// fields (DialShapeFields) can drive either widget type from the same props.
// Everything here is optional so an existing saved widget with none of these
// fields set reads exactly as it did before this type existed (a plain
// needle for DialSwitchWidget, the fixed needle grip for EncoderWidget).
export interface DialShapeStyle {
  // What draws the dial's position indicator. 'needle' (the default) is a
  // line from center to the active angle, same as always. 'square'/'circle'
  // instead draw that shape at the dial's center plus a small indicator
  // marker (see indicatorShape/indicatorStyle) at the active angle — on the
  // shape's own top edge for 'square' (it's already rotated to point there),
  // on the shape's rim for 'circle' (which isn't rotated, so the marker
  // itself moves to the active angle instead).
  dialShape?: 'needle' | 'square' | 'circle'
  // Distance from the widget's true center to the dial shape's OWN center
  // (the square/circle knob graphic, not just its indicator marker), along
  // the same rotating axis as the active angle — same polarToCartesian
  // technique as indicatorDistance below, just centered on the shape itself.
  // Unlike every other distance/size field here, this one is deliberately
  // NOT clamped to >= 0 anywhere it's wired up: a negative value is valid
  // and flips the shape to the opposite side of center. Unset/0 is today's
  // behavior (the shape stays centered). 'needle' dialShape ignores this —
  // it has its own fixed length, not a center-offsettable body.
  dialDistance?: number
  // 'square' dialShape only.
  squareWidth?: number
  squareHeight?: number
  squareBorderWidth?: number
  squareBorderRadius?: number
  squareColor?: string
  squareBorderColor?: string
  // 'circle' dialShape only.
  circleSize?: number
  circleBorderWidth?: number
  circleColor?: string
  circleBorderColor?: string
  // 'circle' dialShape only — half-circle notches bitten into the knob's
  // rim, evenly spaced starting at the active indicator angle (so they
  // rotate along with it) rather than at a fixed angle. Unset/0 draws none.
  circleIndentCount?: number
  // Radius, in the same 0-100 viewBox units as circleSize, of each notch.
  circleIndentSize?: number
  // Defaults to the dial face/track color, so a notch reads as the face
  // showing through a bite taken out of the knob rather than a flat dot.
  circleIndentColor?: string
  // Distance from the (possibly dialDistance-offset) shape's own center to
  // each indent, same 0-100 viewBox convention as indicatorDistance. Unset
  // defaults to circleSize/2 (the knob's own rim) — where indents sat before
  // this became configurable.
  circleIndentDistance?: number
  // Reuses the same shape vocabulary/renderer as indicatorShape (see
  // DetentIndicatorShape) instead of an indent always being a plain circle.
  // Unset defaults to 'circle' — today's only look.
  circleIndentShape?: 'circle' | 'square' | 'tick' | 'triangle'
  // The small marker on the dial's own shape (square/circle dialShape only)
  // that shows the active angle — same shape/style vocabulary as a
  // DialSwitchWidget ring detent, just a second independent instance of it
  // since the two markers usually look different in practice. Border color
  // lives in indicatorStyle.borderColor (DetentStyle), same as a ring
  // detent's — deliberately no separate indicatorBorderColor field, so
  // there's exactly one place that sets what the render actually reads.
  // 'none' draws no indicator marker at all — just the bare square/circle
  // knob, e.g. when a dial's own rotation already reads clearly enough
  // without one.
  indicatorShape?: 'circle' | 'square' | 'tick' | 'triangle' | 'none'
  indicatorStyle?: DetentStyle
  indicatorColor?: string
  // Distance from the dial's center to the indicator marker, in the same
  // 0-100 viewBox units as everything else here. Unset defaults to the
  // shape's own edge (squareHeight/2 for 'square', circleSize/2 for
  // 'circle') — where the marker sat before this became configurable.
  indicatorDistance?: number
  // 'square' indicatorShape only — per-side border width / per-corner
  // border radius, overriding indicatorStyle.borderWidth/borderRadius's
  // scalar values field-by-field where set. indicatorStyle.borderColor still
  // applies (one color for all sides, matching Dropdown's own border
  // pattern, which also keeps color as a single field alongside per-side
  // width/radius).
  indicatorSquareBorder?: SquareBorderStyle
}

// A rotary dial switch — HSI/ADI mode selector, ignition/mag switch.
// Positions render as labeled detents around startAngle..endAngle, with a
// needle pointing at whichever one is active.
export interface DialSwitchWidget extends SwitchWidgetBase, DialShapeStyle {
  id: string
  type: 'switch-dial'
  x: number
  y: number
  w: number
  h: number
  // Labels anchored to the widget as a whole (e.g. a switch name/legend),
  // independent of each position's own labels (SwitchPosition.labels) —
  // same flat-list convention as Gauge/Adjuster/Encoder's own `labels`,
  // rendered as absolutely-positioned overlays via renderWidgetLabels.
  labels: WidgetLabel[]
  // Root-level, alongside (not instead of) each position's own onSelect —
  // see RockerSwitchWidget.events' own comment for press/release/
  // positionChange. increment/decrement are DialSwitchWidget-only (the one
  // switch type that's actually rotary) — same 'Turn CW'/'Turn CCW'
  // vocabulary EncoderWidget already uses, fired when a selection lands on
  // a higher/lower position index than whichever was active before it, in
  // ADDITION to that selection's own onSelect/positionChange — see
  // useSwitchPosition.ts.
  events: {
    press: SequenceStep[]
    release: SequenceStep[]
    positionChange: SequenceStep[]
    increment: SequenceStep[]
    decrement: SequenceStep[]
  }
  startAngle?: number // degrees, default 135
  endAngle?: number // degrees, default 405
  // 'tap' (default): tap a detent directly to select it. 'drag': press
  // anywhere on the widget and drag in the direction of the position you
  // want (can go past the widget's own bounds) — the needle snaps live to
  // whichever position is nearest the drag angle so you can see what
  // releasing would select, same as turning a real rotary switch. Both
  // still fire the same 'select' action:trigger on commit — see
  // useDialSwitchDrag.ts and useSwitchPosition.ts.
  interactionMode?: 'tap' | 'drag'
  track: ColorAppearance // dial face
  fill: ColorAppearance // needle/pointer color
  // Per-label label anchor — see WidgetLabel.labelAnchor.
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
  // How each detent dot is drawn. Unset (the default) is a plain circle;
  // 'tick' and 'triangle' are rotated to point radially outward along that
  // detent's own angle (same convention angleForPosition/labelAnchorPoint
  // use), reading like a real rotary switch's click-stops. 'none' draws no
  // detent marker at all — a position's own label (if it has one) is still
  // tappable in 'tap' interactionMode, same as every other shape; a
  // position with no labels becomes untappable that way and needs drag
  // mode instead.
  detentShape?: 'circle' | 'square' | 'tick' | 'triangle' | 'none'
  // Distance from center to each detent dot, in the same 0-100 viewBox units
  // as everything else here (see DialSwitchWidgetContent). Unset (the
  // default) uses DETENT_RADIUS.
  detentRadius?: number
  // Size/border for whichever detentShape is picked — see DetentStyle. Unset
  // fields fall back to the fixed DETENT_SIZE/CSS defaults for that shape.
  detentStyle?: DetentStyle
}

// A collapsed picker — CDU page selector, radio channel select. Normally
// shows only the active position, sized like a single cell; press and hold
// to reveal the rest stacked along `orientation`, in one of two layouts (see
// expandMode):
//   - 'anchored' (default): the active one stays exactly where it already
//     was and the others fan out around it in list order (4 positions, #2
//     active: #1 renders one slot above, #3/#4 one/two slots below).
//   - 'unanchored': the list always starts at the widget's own x/y footprint
//     regardless of which one is active (position 0 fills it, the rest
//     stack below/right of it in list order) — active is just highlighted
//     wherever it falls.
// Both drag while held to preview, release to commit — see
// useDropdownDrag.ts, which resolves the drag distance to a slot the same
// way useDialSwitchDrag.ts resolves an angle to a detent, just linear
// instead of angular, then maps that slot to a position index per
// expandMode the same way DropdownWidgetContent does for layout.
//
// Deliberately NOT an EventfulWidget or a SwitchWidget: it's both at once
// (own press/release, like Adjuster/Encoder, AND per-position onSelect, like
// the switches) — see its own dedicated branch in triggerAction rather than
// forcing it through either single-purpose union.
export interface DropdownWidget extends SwitchWidgetBase {
  id: string
  type: 'dropdown'
  x: number
  y: number
  w: number
  h: number
  // Which axis the held-open stack fans out along, and which direction it
  // grows in — default 'top-to-bottom'. See shared/dropdownLayout.ts for how
  // this maps to a physical axis/sign, shared by rendering and drag
  // resolution alike.
  orientation?: 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left'
  // 'anchored' (default): active position stays put, others fan around it.
  // 'unanchored': list always starts at the widget's own footprint — see
  // above.
  expandMode?: 'anchored' | 'unanchored'
  events: {
    press: SequenceStep[]
    release: SequenceStep[]
    // Fires alongside (not instead of) whichever position's own onSelect —
    // see RockerSwitchWidget.events' own comment for the full reasoning.
    positionChange: SequenceStep[]
  }
  track: ColorAppearance // cell background behind every position, held or not
  radiusTopLeft?: number
  radiusTopRight?: number
  radiusBottomLeft?: number
  radiusBottomRight?: number
  borderWidthTop?: number
  borderWidthRight?: number
  borderWidthBottom?: number
  borderWidthLeft?: number
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
}

// Absolute virtual-desktop pixel coordinates — the same coordinate space
// Electron's own `display.bounds` uses, so a region picked on any monitor
// (see displayId below) is captured correctly without needing to also
// track "relative to which display's origin."
export interface ScreenRegion {
  x: number
  y: number
  width: number
  height: number
}

// A live view of a region of the desktop's own screen, streamed to every
// connected client — passive, like GaugeWidget: nothing to trigger, so it's
// never clickable on the view client. `region` is unset until "Pick
// region" (see ScreenCaptureWidget's own properties-panel section) has
// been used at least once; the widget renders a placeholder until then.
export interface ScreenCaptureWidget {
  id: string
  type: 'screen-capture'
  x: number
  y: number
  w: number
  h: number
  // Which physical display `region` was picked on (Electron's stable
  // per-display Display.id) — drives the properties panel's monitor
  // dropdown and re-scopes a later re-pick to the right screen. UI-only:
  // capture itself only ever needs `region`, already in absolute
  // virtual-desktop coordinates.
  displayId?: number
  region?: ScreenRegion
  // 'poll' (default): the client re-fetches a fresh JPEG over plain HTTP
  // on its own timer — simplest, stateless, one request per frame. 'mjpeg':
  // a single persistent multipart/x-mixed-replace HTTP connection the
  // server pushes frames into — smoother, and one capture loop serves
  // every simultaneous viewer of this widget, but needs server-side
  // connection lifecycle management. See main/screenCapture.ts.
  streamMode?: 'poll' | 'mjpeg'
  fps?: number // clamped server-side, default 5
  quality?: number // JPEG quality 1-100, default 70
  // Reuses Dashboard's own BackgroundFit vocabulary/UI for consistency —
  // 'tile' isn't meaningful for a live feed and is treated as 'cover'.
  fit?: BackgroundFit
  // Cheap, always-on CSS filter() knobs — applied client-side, no capture-
  // side cost regardless of value. Each defaults to 1 (no-op).
  brightness?: number
  contrast?: number
  saturation?: number
  // Opt-in: unlike the above, this is real per-frame CPU work on the
  // capture side (routed through `sharp` instead of the default
  // nativeImage JPEG encode — see main/screenCapture.ts), so it's off by
  // default rather than always applied.
  sharpen?: boolean
  borderColor?: string
  borderColorExpr?: string
  borderOpacity?: number
  zIndex?: number
}

export type Widget =
  | ButtonWidget
  | MorphButtonWidget
  | GaugeWidget
  | AdjusterWidget
  | EncoderWidget
  | RockerSwitchWidget
  | DialSwitchWidget
  | ToggleSwitchWidget
  | DropdownWidget
  | ScreenCaptureWidget

// A plain draggable/resizable x/y/w/h rectangle in the editor (unlike
// MorphButtonWidget's cellW/cellH+blocks shape) — shared prop type for
// CanvasWidget's generalized drag/resize wrapper.
export type BoxWidget =
  | ButtonWidget
  | GaugeWidget
  | AdjusterWidget
  | EncoderWidget
  | RockerSwitchWidget
  | DialSwitchWidget
  | ToggleSwitchWidget
  | DropdownWidget
  | ScreenCaptureWidget

// Widgets driven by the WidgetState/statesEnabled/activeStateExpr machinery
// — used to narrow getEffectiveStates now that Widget includes types
// without those fields.
export type StatefulWidget = ButtonWidget | MorphButtonWidget

// Widgets that can fire an event's SequenceStep[] — used to narrow Widget
// for triggerAction, eventKindsFor/getEventSteps (shared/widgetEvents.ts),
// actionTitle, and the properties panel's event-sequence editor. GaugeWidget
// is deliberately excluded — it stays fully actionless. The switch widgets
// are ALSO excluded despite being triggerable — their sequences are keyed by
// position, not by a static per-type set of event kinds, so they can't be
// resolved through getEventSteps's (widget, event) -> steps shape; they're
// handled as their own branch in triggerAction instead. Mirrors StatefulWidget's
// own narrowing convention immediately above. DropdownWidget is excluded for
// the same reason PLUS it has its own press/release, unlike the switches —
// see its own comment and triggerAction's dropdown branch.
export type EventfulWidget = ButtonWidget | MorphButtonWidget | AdjusterWidget | EncoderWidget

// The three switch widget types, narrowed together wherever code (triggerAction,
// the properties panel's shared positions editor, ...) treats them
// identically via SwitchWidgetBase's common fields.
export type SwitchWidget = RockerSwitchWidget | DialSwitchWidget | ToggleSwitchWidget

// 'cover'/'contain'/'stretch' scale the image proportionally or not, 'tile'
// repeats it at native size, 'none' places it at native size unscaled — the
// last of which pairs with backgroundAnchor for a fixed-position logo.
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'tile' | 'none'
export type BackgroundAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

// Loosely-typed on purpose — whatever a variable's controlling widget's
// update-state action last returned for it (see UpdateStateAction above).
export type VariableValue = string | number | boolean

// Named piece of shared, internal, live state — set by an update-state
// action, read by any widget's colorExpr/textExpr elsewhere on the
// dashboard via `states.<name>`. `id` is just for stable list identity in
// the editor (drag-reorder, delete) — expressions reference variables by
// `name`, so renaming one is a manual find-and-fix in whatever expressions
// used the old name, not something this app can track for you.
export interface Variable {
  id: string
  name: string
  value: VariableValue
}

// Lightweight stand-in for a Dashboard in the deck picker's list — avoids
// shipping every deck's full widget array just to render a row of names.
export interface DeckSummary {
  id: string
  name: string
}

// One field of an event source's output routed into a Variable. `field` is
// a key from that source kind's metadata (see EVENT_SOURCE_TYPES in
// shared/eventSources.ts) — the raw value for it comes from the matching
// main-process producer (see main/eventSourceProducers.ts). `expr`, if set,
// is evaluated (see evaluateMappingExpression in shared/expr.ts) with the
// raw value exposed as `variables.$value`, alongside every existing
// Variable — same expression mechanism as everywhere else in the app, just
// with one extra reserved key in scope.
export interface EventSourceMapping {
  id: string
  field: string
  variableName: string
  expr?: string
}

// A configured, persistent instance of an event source (e.g. "the clock"),
// continuously producing named fields and feeding a subset of them into
// Variables via `mappings`. `kind` is deliberately an open string rather
// than a union — every kind shares this exact shape (mappings + opaque
// config), so a union would only add friction when a new kind is added,
// unlike WidgetAction where each kind's payload actually differs. `config`
// is unused by the only kind implemented so far ('datetime') — reserved for
// a future kind's own settings, e.g. a webhook's path or a poller's
// interval.
export interface EventSource {
  id: string
  kind: string
  name: string
  mappings: EventSourceMapping[]
  config?: Record<string, unknown>
}

// Reuses the exact {id, field, variableName, expr} shape EventSourceMapping
// already has — `field` here is a flattened dot/index path into the incoming
// JSON body (e.g. "data.temperature", "items.0.value"; see
// shared/flattenJson.ts), not a catalog key from EVENT_SOURCE_TYPES.
export type RestIncomingMapping = EventSourceMapping

// A configured, persistent, app-wide REST integration — unlike EventSource,
// this is NOT per-Dashboard and NOT one of EVENT_SOURCE_TYPES' fixed kinds:
// the user creates any number of these from the Settings page (see
// main/restDataSources.ts), each independently named, ported, and tokened.
export interface RestDataSource {
  id: string
  name: string
  enabled: boolean
  incoming: {
    port: number
    // Generated server-side at creation (see createRestDataSource in
    // main/restDataSources.ts) — checked against an incoming request's
    // Authorization: Bearer <token> header (see main/restIncoming.ts).
    bearerToken: string
    // Which deck's Variables this source's mappings write into (Variables
    // are per-Dashboard — see Dashboard.variables — so an app-wide REST
    // source has to pick one).
    targetDeckId: string
    mappings: RestIncomingMapping[]
  }
  outgoing: {
    url: string
    // Raw JSON text with {{placeholderName}} tokens used as bare (unquoted)
    // JSON values — substitution always does JSON.stringify(resolvedValue)
    // (see runCallRestAction in main/index.ts), so a template like
    // {"temp": {{temperature}}, "unit": {{unit}}} works whether a
    // placeholder resolves to a number, string, or boolean.
    payloadTemplate: string
  }
}

// RestDataSource plus its live http.createServer status (see
// main/restIncoming.ts) — what actually travels over the wire in
// rest-sources:list, and what the renderer store/Settings panel work with.
export type RestDataSourceStatus = RestDataSource & { listening: boolean; listenError?: string }

// One additional, nameable view within a deck — its own widgets, same
// shape/behavior as the deck's own root view, reachable via
// NavigateSubDeckAction/OpenOverlayAction. Deliberately one level deep
// only: a SubDeck has no subDecks of its own, so SubDeckTarget/
// OpenOverlayAction's subDeckId can never point at anything but 'main-deck'
// or one of Dashboard.subDecks's own entries. Shares the parent deck's
// background/variables/eventSources — only the widget list differs per
// view. Widget ids stay globally unique across the whole Dashboard (every
// widget everywhere is minted from the same nextId()/randomUUID() pool),
// so a widget can be found by id without knowing which view owns it — see
// findWidgetAnywhere in shared/subDecks.ts.
export interface SubDeck {
  id: string
  name: string
  widgets: Widget[]
}

export interface Dashboard {
  id: string
  name: string
  backgroundColor: string
  // Same idea as ColorAppearance's colorExpr (see resolveColor in
  // shared/expr.ts, reused here directly since this is the same
  // color/colorExpr shape) — independent of backgroundColor, which stays as
  // the fallback for whatever the expression doesn't return.
  backgroundColorExpr?: string
  // The image itself lives server-side and is fetched over plain HTTP at
  // /background-image — embedding it as a data URL here would mean every
  // dashboard:update (including per-frame widget drags) re-sends the whole
  // image over the WebSocket to every client.
  backgroundImageVersion?: number
  backgroundImageMime?: string
  backgroundFit?: BackgroundFit
  backgroundAnchor?: BackgroundAnchor
  // Optional (rather than always-present) so a dashboard saved before this
  // existed still loads — see loadDashboard in main/index.ts, which
  // normalizes it to [] once at load time so nothing downstream has to
  // re-check for undefined.
  variables?: Variable[]
  // Same optional-for-old-dashboards treatment as `variables` above —
  // normalized to [] once at load time (see loadDeckDashboard in
  // main/index.ts).
  eventSources?: EventSource[]
  widgets: Widget[]
  // Same optional-for-old-dashboards treatment as `variables`/`eventSources`
  // above — normalized to [] once at load time (see loadDeckDashboard in
  // main/index.ts). See SubDeck's own comment for the one-level-deep and
  // shared-background/variables/eventSources rules.
  subDecks?: SubDeck[]
}

export interface DeviceInfo {
  // Stable per-browser id the view client generates once and persists
  // locally (see id.ts's getDeviceId) — NOT tied to any one WebSocket
  // connection, so the same device is recognized across reconnects instead
  // of showing up as a brand new entry every time.
  id: string
  width: number
  height: number
  // Raw navigator.userAgent from the view client — real device names aren't
  // exposed to web content, so this is the only material to work with. See
  // friendlyDeviceName in shared/deviceName.ts for turning it into a label.
  userAgent?: string
  // False once its socket disconnects — the entry itself is kept (not
  // removed) so a device picked in the editor's device dropdown stays picked
  // while it reconnects, instead of the selection silently jumping away.
  connected: boolean
  // User-set name from the view client's device settings modal (5-finger
  // tap). Takes priority over the userAgent-derived friendly name wherever a
  // device is displayed — see displayDeviceName in shared/deviceName.ts.
  customName?: string
}

// One entry in the settings modal's "Approved devices" list — see
// deviceApproval.ts. Distinct from DeviceInfo: this is the persisted,
// global approval record (survives across every deck/session), not a
// specific room's live connection state.
export interface ApprovedDeviceSummary {
  id: string
  // Best-effort snapshot of the device's name at the moment it was
  // approved (customName if it had one yet, else the friendly userAgent
  // label) — not live-updated by a later rename, same tradeoff
  // DeviceInfo.userAgent's snapshot-at-hello already has.
  name: string
  approvedAt: number
}

export type ClientToServer =
  | {
      type: 'hello'
      role: 'edit' | 'view'
      viewport?: { width: number; height: number }
      userAgent?: string
      deviceId?: string
    }
  | { type: 'dashboard:update'; dashboard: Dashboard }
  // event selects which of the widget's events[...] sequences to run (see
  // getEventSteps in shared/widgetEvents.ts) — required, not optional: this
  // app's editor/view clients and server always ship from the same build,
  // so there's no legacy-client wire compatibility to preserve here.
  // value is set only while an AdjusterWidget is being dragged — the live
  // position, exposed as `variables.$value` when a sequence step is
  // evaluated (see triggerAction/runSequence in main/index.ts). Absent for a
  // plain button/morph press or release.
  // final is false for every in-flight drag tick (useAdjusterDrag's
  // rAF-throttled 'move' sends) and true for a press/release event or the
  // drag's own final 'move' tick — see runUpdateState's immediate/debounced
  // save split, which this drives: an in-flight tick's variable update
  // still broadcasts live but its disk save is debounced rather than
  // synchronous, the same way an event-source tick's already is, so a fast
  // drag isn't doing a blocking disk write on every single frame. Omitted
  // (rather than defaulted to false) is treated the same as true.
  | { type: 'action:trigger'; widgetId: string; event: WidgetEventKind; value?: number; final?: boolean }
  | { type: 'background-image:upload'; dataUrl: string }
  | { type: 'background-image:clear' }
  | { type: 'device:rename'; deviceId: string; name: string }
  // Sent by any trusted client (edit, or an already-approved view device —
  // see isTrustedSocket in main/index.ts), in response to a
  // device:approval-requested it received.
  | { type: 'device:approve'; deviceId: string }
  | { type: 'device:deny'; deviceId: string }
  // Settings modal only, edit-role only (enforced server-side) — managing
  // the master approved list is an admin action, unlike approve/deny above.
  | { type: 'device:list-approved' }
  | { type: 'device:revoke'; deviceId: string }
  | { type: 'dcsbios:list-aircraft' }
  | { type: 'dcsbios:field-catalog'; aircraft: string }
  | { type: 'dcsbios:get-settings' }
  | { type: 'dcsbios:update-settings'; settings: Partial<DcsBiosSettings> }
  | { type: 'dcsbios:validate-docs-dir'; docsDir: string }
  | { type: 'dcsbios:pick-docs-folder' }
  | { type: 'dcsbios:command-catalog'; aircraft: string }
  | { type: 'dcsbios:send-command'; identifier: string; argument: string }
  | { type: 'app-settings:get' }
  | { type: 'app-settings:update'; enabledDataSources: string[] }
  // Settings modal only, edit-role only (enforced server-side) — same
  // admin-action reasoning as device:list-approved/revoke above.
  | { type: 'rest-sources:get' }
  // Server generates id/incoming.bearerToken (see createRestDataSource in
  // main/restDataSources.ts) — a renderer never mints its own token.
  | { type: 'rest-sources:create'; name: string }
  | { type: 'rest-sources:update'; sources: RestDataSource[] }
  | { type: 'rest-sources:regenerate-token'; sourceId: string }
  | { type: 'rest-sources:delete'; sourceId: string }
  | { type: 'screen-capture:list-displays' }
  // Opens a native full-screen overlay (see main/screenCapture.ts) on the
  // chosen display for a drag-to-select rectangle. Unlike
  // dcsbios:pick-docs-folder, there's no matching reply type here — the
  // picked region is written straight into the widget's own fields on
  // room.dashboard.widgets server-side and delivered via the normal
  // dashboard:sync broadcast, the same way background-image:upload's
  // result reaches every client through backgroundImageVersion rather
  // than a dedicated reply.
  | { type: 'screen-capture:pick-region'; widgetId: string; displayId: number }
  // Same picker, same no-dedicated-reply shape as screen-capture:pick-region
  // above, but writes into the matching entry of
  // room.dashboard.eventSources (by id) instead of a widget — an
  // 'ocrRegion' source's config.region/config.displayId, specifically.
  | { type: 'event-source:pick-region'; sourceId: string; displayId: number }

export type ServerToClient =
  | { type: 'dashboard:sync'; dashboard: Dashboard }
  // Lighter-weight alternative to dashboard:sync for a variables-only change
  // (an update-state action — including every in-flight AdjusterWidget drag
  // tick — or an event-source tick, see applyVariableUpdates in
  // main/index.ts). Carries the full variables array (not just the changed
  // keys) so a brand-new variable's server-assigned id round-trips correctly
  // without the client having to invent one — but skips widgets/eventSources/
  // devices/background image, which don't change here and would otherwise
  // get re-serialized and re-diffed on every single tick for no reason.
  | { type: 'variables:sync'; variables: Variable[] }
  // detail is only present when the failure happened mid-sequence (a
  // DelayStep/ActionStep threw inside runSequence) — omitted (not a
  // sentinel value) for a pre-sequence error like "Widget not found" or
  // "cannot fire this event", which has no step context.
  | { type: 'action:error'; widgetId: string; message: string; detail?: { event: WidgetEventKind; stepIndex: number; stepKind: SequenceStep['kind'] } }
  | { type: 'devices:sync'; devices: DeviceInfo[] }
  // Sent to a 'view' client instead of dashboard:sync when its deviceId
  // hasn't been approved yet — the client shows a waiting screen and gets no
  // dashboard content until either this resolves into a dashboard:sync (approved)
  // or a device:denied arrives and the connection closes (see main/index.ts).
  | { type: 'device:pending' }
  | { type: 'device:denied' }
  // Sent to every currently-trusted client (edit, or an already-approved
  // view device — any of them can approve/deny, not just the desktop) when
  // a not-yet-approved device's first hello arrives.
  | { type: 'device:approval-requested'; device: DeviceInfo }
  // Reply to device:list-approved / device:revoke — the full current list
  // either way, so the settings modal doesn't need to locally patch its
  // copy after a revoke.
  | { type: 'device:approved-list'; devices: ApprovedDeviceSummary[] }
  // Pushed to a 'view' client with no deck chosen yet, once its hello
  // resolves as approved (immediately if already-approved, or the moment a
  // pending one gets approved) — what the picker screen renders instead of
  // dashboard content, which doesn't apply pre-deck-selection. Server push,
  // not client poll, same as everything else here.
  | { type: 'decks:list'; decks: DeckSummary[] }
  | { type: 'dcsbios:aircraft-list'; aircraft: { id: string; name: string }[] }
  | { type: 'dcsbios:field-catalog'; aircraft: string; fields: DcsBiosFieldCatalogEntry[] }
  | { type: 'dcsbios:field-catalog-error'; aircraft: string; message: string }
  | ({ type: 'dcsbios:status' } & DcsBiosStatus)
  | ({ type: 'dcsbios:stats' } & DcsBiosWorkerStats)
  | ({ type: 'dcsbios:settings' } & DcsBiosSettings)
  | { type: 'dcsbios:docs-dir-validation'; docsDir: string; valid: boolean; aircraftCount: number }
  | { type: 'dcsbios:docs-folder-picked'; path: string | null }
  | { type: 'dcsbios:command-catalog'; aircraft: string; commands: DcsBiosCommandCatalogEntry[] }
  | { type: 'dcsbios:command-catalog-error'; aircraft: string; message: string }
  | { type: 'dcsbios:send-command-result'; ok: boolean; error?: string }
  | { type: 'app-settings:settings'; enabledDataSources: string[] }
  // Reply to rest-sources:get/create/update/regenerate-token/delete — the
  // full current list either way, same "don't make the client locally patch
  // its own copy" reasoning as device:approved-list. `listening`/
  // `listenError` reflect that source's actual http.createServer state (see
  // main/restIncoming.ts) — a port left configured but failing to bind
  // (e.g. EADDRINUSE) still round-trips here instead of just vanishing.
  // `lanAddress` is resolved once server-side (see getLanAddress, already
  // used for /api/apk-info) so the Settings panel can build
  // http://<lanAddress>:<port> without a second HTTP round trip.
  | { type: 'rest-sources:list'; sources: RestDataSourceStatus[]; lanAddress: string | null }
  | { type: 'screen-capture:displays'; displays: { id: number; label: string; bounds: ScreenRegion }[] }
  // Targeted at the ONE socket that triggered the navigate-subdeck action,
  // never broadcast — which deck view is "current" is per-client UI state,
  // not shared dashboard state (see NavigateSubDeckAction's own comment).
  // Two clients on the same deck can be on two different views at once.
  | { type: 'subdeck:navigate'; target: SubDeckTarget }
  // Same per-socket-only targeting as subdeck:navigate. subDeckId always
  // names a sub-deck (see OpenOverlayAction's own comment for why
  // 'main-deck' doesn't apply here).
  | { type: 'subdeck:open-overlay'; subDeckId: string; edge: OverlayEdge; size: number; sizeUnit: OverlaySizeUnit }
  | { type: 'subdeck:close-overlay' }

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default',
  name: 'Untitled Dashboard',
  backgroundColor: '#14161b',
  backgroundFit: 'cover',
  backgroundAnchor: 'center',
  variables: [],
  eventSources: [],
  widgets: [],
  subDecks: []
}
