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

export type WidgetAction = KeypressAction | UpdateStateAction | SendDcsCommandAction

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
  align?: HorizontalAlign
  verticalAlign?: VerticalAlign
  padding?: number
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
  action: WidgetAction
  // Off (default): only "states[0]" is editable; a lightened version of its
  // color stands in for "clicked" automatically. On: every state is exposed
  // and independently configurable in the properties panel.
  statesEnabled?: boolean
  states: WidgetState[]
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
  action: WidgetAction
  statesEnabled?: boolean
  states: WidgetState[]
}

export type Widget = ButtonWidget | MorphButtonWidget

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

export interface Dashboard {
  id: string
  name: string
  backgroundColor: string
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

export type ClientToServer =
  | {
      type: 'hello'
      role: 'edit' | 'view'
      viewport?: { width: number; height: number }
      userAgent?: string
      deviceId?: string
    }
  | { type: 'dashboard:update'; dashboard: Dashboard }
  | { type: 'action:trigger'; widgetId: string }
  | { type: 'background-image:upload'; dataUrl: string }
  | { type: 'background-image:clear' }
  | { type: 'device:rename'; deviceId: string; name: string }
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

export type ServerToClient =
  | { type: 'dashboard:sync'; dashboard: Dashboard }
  | { type: 'action:error'; widgetId: string; message: string }
  | { type: 'devices:sync'; devices: DeviceInfo[] }
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

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default',
  name: 'Untitled Dashboard',
  backgroundColor: '#14161b',
  backgroundFit: 'cover',
  backgroundAnchor: 'center',
  variables: [],
  eventSources: [],
  widgets: []
}
