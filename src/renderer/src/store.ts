import { create } from 'zustand'
import { SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN, DECK_CLOSE_CODE_DENIED } from '@shared/constants'
import {
  DEFAULT_DASHBOARD,
  type ApprovedDeviceSummary,
  type ClientToServer,
  type CustomVariant,
  type Dashboard,
  type DeckSummary,
  type DeviceInfo,
  type OverlayEdge,
  type OverlaySizeUnit,
  type RestDataSource,
  type RestDataSourceStatus,
  type RestWebhookTarget,
  type ScreenRegion,
  type SequenceStep,
  type ServerToClient,
  type StepPath,
  type SubDeck,
  type Widget,
  type WidgetEventKind
} from '@shared/types'
import {
  getSubDeckWidgets,
  setSubDeckWidgets,
  getSubDeckGridSize,
  setSubDeckGridSize,
  getSubDeckCanvasSize,
  setSubDeckCanvasSize,
  findWidgetAnywhere,
  reconcileDashboard
} from '@shared/subDecks'
import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosSettings, DcsBiosStatus, DcsBiosWorkerStats } from '@shared/dcsBiosTypes'
import type { DcsViewportsSettings, DcsViewportsStatus } from '@shared/dcsViewportsTypes'
import { registerCustomFonts, type CustomFont } from '@shared/fonts'
import type { CustomSound } from '@shared/sounds'
import { playSound } from './soundPlayer'
import { getDeviceId, getDeviceToken, setDeviceToken, setLastDeckId, clearLastDeckId, nextId } from './id'
import { syncCustomFontFaces } from './customFontFaces'
import { useConfirmStore } from './confirmStore'
import { pushRemoteDebugLog } from './debugConsoleStore'
import { useHistoryStore } from './historyStore'

// A slide-over sub-deck currently open on the view client — client-local,
// never persisted/synced beyond the single subdeck:open-overlay message
// that set it (see OpenOverlayAction's own comment in shared/types.ts).
export interface ActiveOverlay {
  subDeckId: string
  edge: OverlayEdge
  size: number
  sizeUnit: OverlaySizeUnit
}

// A widget action-sequence failure surfaced prominently on the deployed view
// client (see ToastStack.tsx) — distinct from `errors` (below), which is
// keyed only by widgetId and drives a small inline indicator on the widget
// itself. `id` is client-generated and independent of `widgetId`, since one
// widget can stack multiple toasts over time.
export interface ActionErrorToast {
  id: string
  widgetId: string
  widgetLabel?: string
  event?: WidgetEventKind
  path?: StepPath
  stepKind?: SequenceStep['kind']
  message: string
  createdAt: number
}

// A field catalog fetch is either not yet requested (absent from the map),
// in flight, resolved, or failed — EventSourcesModal's field browser (see
// components/EventSourcesModal.tsx) renders a different state for each.
export type DcsBiosFieldCatalogState = 'loading' | { error: string } | DcsBiosFieldCatalogEntry[]
// Same idea, for a "Send DCS command" action's command browser (see
// PropertiesPanel.tsx's SendDcsCommandActionEditor).
export type DcsBiosCommandCatalogState = 'loading' | { error: string } | DcsBiosCommandCatalogEntry[]

type Mode = 'edit' | 'view'

interface DashboardStore {
  // Null until a deck is chosen in the picker — the single source of truth
  // for "which screen is showing" (see App.tsx).
  deckId: string | null
  dashboard: Dashboard
  // Edit mode only — which deck view the toolbar/canvas/properties panel is
  // currently designing. null = the deck's own main view; otherwise a
  // Dashboard.subDecks id. Distinct from activeSubDeckId/activeOverlay
  // below, which are view-mode runtime state driven by server pushes, not
  // a toolbar choice.
  editingSubDeckId: string | null
  // View mode only — which deck view is fullscreen right now, driven
  // exclusively by incoming subdeck:navigate messages (see NavigateSubDeckAction's
  // own comment in shared/types.ts for why this is per-client, never set
  // locally in response to a click).
  activeSubDeckId: string | null
  // View mode only — the currently-open slide-over panel, if any. Only one
  // at a time; a new subdeck:open-overlay message replaces whatever was
  // open. Cleared locally by closeOverlay() (tap-outside-to-dismiss, no
  // server round trip) as well as by an incoming subdeck:navigate/
  // subdeck:close-overlay message.
  activeOverlay: ActiveOverlay | null
  mode: Mode
  connected: boolean
  errors: Record<string, string>
  // Capped (see action:error handler) — bounds memory even if nothing is
  // ever mounted to dismiss these (e.g. stray errors while in edit mode,
  // where ToastStack isn't rendered).
  toasts: ActionErrorToast[]
  selectedWidgetIds: string[]
  // Canvas drill-down selection within the sole-selected widget — a morph
  // block id (targets the properties panel's spacing/radius/border
  // sub-panel) or a rocker switch position id (just a visual highlight, see
  // CanvasWidget.tsx's isSoleSelection-gated onPositionSelect). Reset to null
  // on every widget-selection change (see selectWidget/pasteWidgets/
  // removeWidget(s)) — never meaningful across two different widgets anyway.
  selectedBlockId: string | null
  // Which of the selected widget's states the editor canvas previews (its
  // properties panel tab) — reset to 0 (Default) on every selection change.
  activeStateIndex: number
  devices: DeviceInfo[]
  // View mode only: true between sendHello and either a dashboard:sync
  // (approved) or device:denied (denied) — see ViewCanvas's waiting screen.
  devicePending: boolean
  // View mode only: the desktop explicitly denied this device. Sticky —
  // unlike a normal disconnect, the socket close handler won't auto-retry
  // (see DECK_CLOSE_CODE_DENIED), so this stays true until the app restarts.
  deviceDenied: boolean
  // Devices whose first hello arrived unapproved, queued for any trusted
  // client (edit or an already-approved view device) to approve/deny — see
  // DeviceApprovalBanner.tsx, mounted in both edit and view mode.
  pendingApprovals: DeviceInfo[]
  // View mode, no deck chosen yet: the lobby connection's deck list (see
  // connectLobby) — null until it arrives, distinct from an empty array
  // (no decks exist yet). Edit mode's DeckPicker still fetches its own copy
  // over REST instead, since it's always trusted regardless of this.
  decks: DeckSummary[] | null
  // Edit mode's Devices modal only — the master approved-device list (see
  // requestApprovedDevices/revokeDeviceApproval), for revoking access.
  approvedDevices: ApprovedDeviceSummary[]
  // DCS-BIOS plugin support — all null/empty until first requested,
  // fetched once app-wide and cached rather than per Plugin instance
  // (see renderer/src/plugins/DcsBiosConfigPanel.tsx). null means "not yet
  // requested," distinct from an empty result.
  dcsBiosAircraft: { id: string; name: string }[] | null
  dcsBiosFieldCatalogs: Record<string, DcsBiosFieldCatalogState>
  dcsBiosCommandCatalogs: Record<string, DcsBiosCommandCatalogState>
  dcsBiosStatus: DcsBiosStatus | null
  dcsBiosStats: DcsBiosWorkerStats | null
  dcsBiosSettings: DcsBiosSettings | null
  // Result of the most recent "Browse…"/inline validation call in the
  // DCS-BIOS settings panel — transient UI feedback, not persisted.
  dcsBiosDocsDirValidation: { docsDir: string; valid: boolean; aircraftCount: number } | null
  dcsBiosPickedFolder: string | null
  // Result of the most recent "Test" send from a Send DCS command action's
  // editor (see PropertiesPanel.tsx) — transient UI feedback, not persisted.
  dcsBiosSendCommandResult: { ok: boolean; error?: string } | null
  // "Enabled plugins" gate (see appSettings.ts) — null until first
  // requested. EventSourcesModal's add-picker filters PLUGIN_TYPES by this.
  enabledPlugins: string[] | null
  // App-wide, user-created REST data sources (see main/restDataSources.ts) —
  // incoming-only now (see RestDataSource's own comment on the split from
  // RestWebhookTarget below) — empty until first requested. PluginsModal's
  // RestDataSourcesSettingsPanel manages the full list.
  restDataSources: RestDataSourceStatus[]
  restDataSourcesLanAddress: string | null
  // App-wide, user-created REST webhook targets (see
  // main/restWebhookTargets.ts) — the outgoing counterpart, split out of
  // what used to be restDataSources' own outgoing half. Empty until first
  // requested. PropertiesPanel's ActionFields reads it to offer a "Call
  // <name>" action per enabled target.
  restWebhookTargets: RestWebhookTarget[]
  // The MCP server's own settings (see main/mcpServerSettings.ts) — null
  // until first requested (McpServerSettingsPanel does so on mount, same
  // convention as requestRestDataSources). Whether the server actually RUNS
  // is the separate 'mcp' entry in enabledPlugins above; this is just the
  // bearer token + live listen status.
  mcpServerSettings: { bearerToken: string; port: number; listening: boolean; listenError?: string } | null
  // App-wide, user-uploaded fonts (see main/customFonts.ts) — empty until
  // first synced. Unlike restDataSources, arrives unasked as part of
  // sendInitialState (see its own comment in main/index.ts), so it's rarely
  // actually empty in practice; requestCustomFonts below exists mainly for
  // FontsModal to have something to call on mount, matching every other
  // panel's own convention.
  customFonts: CustomFont[]
  // App-wide, user-uploaded sounds (see main/customSounds.ts) — same
  // arrives-unasked-via-sendInitialState lifecycle as customFonts above, and
  // needed by every client for the same reason: a sound:play carries only a
  // soundId, so without the library there's no filename to resolve it with.
  customSounds: CustomSound[]
  // App-wide, user-saved widget-variant presets (see CustomVariant's own
  // comment in shared/types.ts) — empty until first synced. Editor-only
  // (never sent to a 'view' client, unlike customFonts above — see
  // custom-variants:get's own comment), so it arrives unasked as part of
  // sendInitialState the same way, just gated server-side instead of here.
  customVariants: CustomVariant[]
  saveCustomVariant: (name: string, widgets: Widget[]) => void
  deleteCustomVariant: (variantId: string) => void
  // ScreenCaptureWidget's Properties monitor dropdown — null until first
  // requested (see PropertiesPanel.tsx, fetched once its Region section
  // mounts), same "null vs. empty" convention as dcsBiosAircraft above.
  screenCaptureDisplays: { id: number; label: string; bounds: ScreenRegion }[] | null
  requestScreenCaptureDisplays: () => void
  // Windows Audio plugin's own device picker (WindowsAudioConfigPanel) and
  // the SetWindowsAudioAction editor's device dropdown — same "null until
  // first requested" convention as screenCaptureDisplays above.
  windowsAudioDevices: { name: string; isDefault: boolean }[] | null
  requestWindowsAudioDevices: () => void
  // Same convention, for "Application" mode's own picker (currently-active
  // app audio sessions, see WindowsAudioTargetPicker.tsx).
  windowsAudioSessions: { name: string; appName: string }[] | null
  requestWindowsAudioSessions: () => void
  // No reply to await here — the picked region reaches every client
  // (including this one) through the normal dashboard:sync broadcast, same
  // as background-image:upload's result does (see screen-capture:pick-region's
  // own comment in shared/types.ts).
  pickScreenCaptureRegion: (widgetId: string, displayId: number) => void
  // Same shape as pickScreenCaptureRegion above, but for the 'screenCapture'
  // plugin's own config.region/config.displayId (see
  // renderer/src/plugins/ScreenCaptureConfigPanel.tsx, rendered inside
  // EventSourcesModal.tsx) instead of a widget.
  pickPluginRegion: (sourceId: string, displayId: number) => void
  requestDcsBiosAircraftList: () => void
  requestDcsBiosFieldCatalog: (aircraft: string) => void
  requestDcsBiosCommandCatalog: (aircraft: string) => void
  sendDcsBiosCommand: (identifier: string, argument: string) => void
  requestDcsBiosSettings: () => void
  updateDcsBiosSettings: (settings: Partial<DcsBiosSettings>) => void
  requestDcsBiosDocsDirValidation: (docsDir: string) => void
  pickDcsBiosDocsFolder: () => void
  dcsViewportsSettings: DcsViewportsSettings | null
  dcsViewportsStatus: DcsViewportsStatus | null
  dcsViewportsDcsInstallDirValidation: { dir: string; valid: boolean } | null
  dcsViewportsSavedGamesDirValidation: { dir: string; valid: boolean } | null
  dcsViewportsPickedDcsInstallFolder: string | null
  dcsViewportsPickedSavedGamesFolder: string | null
  requestDcsViewportsSettings: () => void
  requestDcsViewportsStatus: () => void
  updateDcsViewportsSettings: (settings: Partial<DcsViewportsSettings>) => void
  requestDcsViewportsDcsInstallDirValidation: (dir: string) => void
  requestDcsViewportsSavedGamesDirValidation: (dir: string) => void
  pickDcsViewportsDcsInstallFolder: () => void
  pickDcsViewportsSavedGamesFolder: () => void
  requestAppSettings: () => void
  updateEnabledPlugins: (enabledPlugins: string[]) => void
  requestRestDataSources: () => void
  createRestDataSource: (name: string) => void
  updateRestDataSources: (sources: RestDataSource[]) => void
  regenerateRestDataSourceToken: (sourceId: string) => void
  deleteRestDataSource: (sourceId: string) => void
  requestMcpServerSettings: () => void
  regenerateMcpServerToken: () => void
  requestRestWebhookTargets: () => void
  createRestWebhookTarget: (name: string) => void
  updateRestWebhookTargets: (targets: RestWebhookTarget[]) => void
  deleteRestWebhookTarget: (targetId: string) => void
  requestCustomFonts: () => void
  requestCustomSounds: () => void
  uploadCustomSound: (dataUrl: string, label: string, filename: string) => void
  deleteCustomSound: (soundId: string) => void
  updateCustomSoundStartAt: (soundId: string, startAtMs: number) => void
  // dataUrl comes from a plain <input type="file"> + FileReader.readAsDataURL
  // (see FontsModal.tsx), same client-reads-the-file-itself shape as
  // uploadBackgroundImage below — necessary here for the same reason: an
  // Android view client (no filesystem-picker main process to hand this to)
  // could eventually get a font-upload UI of its own without touching this
  // path at all.
  uploadCustomFont: (dataUrl: string, label: string, filename: string) => void
  deleteCustomFont: (fontId: string) => void
  // null resets to the shared default — see CustomFont.lineHeight's own
  // comment in shared/fonts.ts.
  updateCustomFontLineHeight: (fontId: string, lineHeight: number | null) => void
  connect: (mode: Mode, deckId: string) => void
  // View mode, no deck chosen yet — establishes approval (and the deck
  // list, once approved) before any specific deck is even in the picture.
  // Separate from connect() rather than connect(mode, ''): deckId staying
  // null here is what keeps App.tsx showing the picker instead of
  // ViewCanvas, and connect()'s reconnect/close handling is all built
  // around dashboard-bearing state a lobby connection never has.
  connectLobby: () => void
  // Tears down the current connection and returns to the deck picker (the
  // "← Decks" button in edit mode, "Change deck" in the view-mode device
  // settings modal).
  disconnect: () => void
  requestApprovedDevices: () => void
  revokeDeviceApproval: (deviceId: string) => void
  // options.final mirrors triggerWidget's own final param (see its doc
  // comment) — pass { final: false } for a throttled in-flight drag tick
  // (see useWidgetDrag's scheduleSend) so the server debounces its disk
  // save instead of writing on every frame; omitted/true for everything
  // else (one-off edits, a drag's own final tick), unchanged from before.
  updateWidgets: (widgets: Widget[], options?: { final?: boolean }) => void
  // Replaces the whole dashboard outright — the common tail every other
  // mutating action below already ends with (`set({dashboard}); send(...)`),
  // pulled out on its own for historyStore.ts's undo/redo to apply a
  // restored snapshot through the exact same sync path as any normal edit,
  // with no server-side special-casing needed.
  restoreDashboard: (dashboard: Dashboard) => void
  updateDashboardMeta: (
    fields: Partial<
      Pick<
        Dashboard,
        'name' | 'backgroundColor' | 'backgroundColorExpr' | 'backgroundFit' | 'backgroundAnchor' | 'variables' | 'plugins' | 'globalActions'
      >
    >
  ) => void
  uploadBackgroundImage: (dataUrl: string) => void
  clearBackgroundImage: () => void
  // Patches whichever screen is currently being edited (main deck or the
  // open sub-deck) — see getSubDeckGridSize/setSubDeckGridSize in
  // shared/subDecks.ts. Read the current value via the useGridSize() hook
  // below, not a field on this store — it's derived from
  // dashboard.gridSize/subDecks + editingSubDeckId, not its own piece of
  // state to keep in sync by hand.
  setGridSize: (value: number) => void
  // Same per-screen patching as setGridSize above, but for the reference
  // canvas size used by the deployed view's letterboxing (see
  // ViewCanvas.tsx and SubDeck.canvasWidth's own comment in shared/types.ts).
  // Read the current value via useCanvasSize() below, same reasoning as
  // useGridSize().
  setCanvasSize: (width: number, height: number) => void
  // Edit mode's toolbar screen switcher. Also resets selection state — a
  // selection made on one deck view has no meaning on another, same as
  // selectWidget(null) already does on every other selection-invalidating
  // change.
  setEditingSubDeck: (subDeckId: string | null) => void
  // Creates a new sub-deck and immediately switches the editor into it,
  // same "jump straight into it" convention pasteWidgets already follows
  // for a freshly pasted batch.
  addSubDeck: (name: string) => void
  renameSubDeck: (id: string, name: string) => void
  // If the removed sub-deck was the one being edited, falls back the editor
  // to the main view rather than leaving it pointed at a deleted screen.
  removeSubDeck: (id: string) => void
  addWidget: (widget: Widget) => void
  pasteWidgets: (widgets: Widget[]) => void
  bringToFront: (ids: string[]) => void
  sendToBack: (ids: string[]) => void
  removeWidget: (id: string) => void
  removeWidgets: (ids: string[]) => void
  // Move-only grouping (see groupId's own comment in shared/types.ts).
  // Regrouping an existing group (or forming a fresh one from a plain
  // multi-select) both just reassign a brand-new groupId to every id given —
  // a widget belongs to at most one group, so this always overwrites
  // whatever groupId (if any) each widget had before.
  groupWidgets: (ids: string[]) => void
  ungroupWidgets: (ids: string[]) => void
  // event selects which of the widget's events[...] sequences to run. value
  // is set only for a live AdjusterWidget drag — see the 'action:trigger' WS
  // message shape in types.ts. final: false marks an in-flight drag tick
  // (debounced server-side save instead of a synchronous one); omit/true for
  // a press/release event or the drag's final commit on pointer-up.
  triggerWidget: (id: string, event: WidgetEventKind, value?: number, final?: boolean) => void
  // View mode's tap-outside-the-scrim dismiss — pure client-local state
  // change, distinct from the server-round-tripped CloseOverlayAction (see
  // its own comment in shared/types.ts) triggered by an in-panel widget.
  closeOverlay: () => void
  dismissToast: (id: string) => void
  // exact: true skips the group-expansion below even when the target widget
  // has a groupId — selects just that one widget, used by useWidgetDrag's
  // "collapse a multi-selection down to the clicked widget" re-click handler
  // to drill into one group member instead of re-expanding to the whole
  // group.
  selectWidget: (id: string | null, options?: { additive?: boolean; exact?: boolean }) => void
  // Marquee (shift-drag) selection — replaces the current selection by
  // default, or unions with it when additive (shift-drag always passes
  // additive, matching shift-click's existing meaning elsewhere).
  selectWidgets: (ids: string[], options?: { additive?: boolean }) => void
  selectBlock: (id: string | null) => void
  setActiveStateIndex: (index: number | ((current: number) => number)) => void
  renameDevice: (deviceId: string, name: string) => void
  approveDevice: (deviceId: string) => void
  denyDevice: (deviceId: string) => void
}

let socket: WebSocket | null = null
// Set by disconnect() just before closing, so the close listener below knows
// this was a deliberate "back to picker" close rather than a network drop —
// without it, the existing auto-reconnect would silently redial the same
// deck 1.5s after the user chose to leave it.
let intentionalDisconnect = false
// Drives syncClock() on a recurring cadence for as long as `socket` above is
// open — created in connect()'s 'open' handler, cleared in its 'close'
// handler (both below). Module-level for the same reason `socket` is: this
// is connection lifecycle state, not something any component renders.
let clockSyncInterval: ReturnType<typeof setInterval> | null = null

function send(message: ClientToServer): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

// Estimated serverClock - clientClock, in ms — see syncClock/'time:sync-
// reply' below. 0 (assume clocks agree) until the first reply arrives, same
// as before this existed; deliberately module-level rather than store state
// since nothing renders it directly, it only ever corrects a computation.
let clockOffsetMs = 0
// True once at least one 'time:sync-reply' has landed — see
// reportLagFromServerTime below, which withholds reporting until then rather
// than reporting through a clockOffsetMs still at its stale/zero default.
let hasClockOffset = false
// Re-measured periodically (not just once at connect) so a device whose
// clock drifts — or one that was mid-adjustment (e.g. NTP catching up right
// after boot) when it first connected — doesn't stay stuck with a stale
// offset for the rest of a long session.
const CLOCK_SYNC_INTERVAL_MS = 30_000
// Floor between device:lag-report sends — dashboard:sync can fire every
// animation frame mid-drag, and reporting on every single one would just add
// another flood of messages on top of the exact problem this is meant to
// diagnose.
const LAG_REPORT_MIN_INTERVAL_MS = 1000
let lastLagReportAt = 0

function syncClock(): void {
  send({ type: 'time:sync', clientSentAt: Date.now() })
}

// Computes and (throttled) reports lag right when a fresh server timestamp
// actually arrives — either dashboard:sync's generatedAt or time:heartbeat's
// serverTime (see both handlers below), the latter arriving on a fixed
// cadence regardless of dashboard activity specifically so there's always
// something to measure against even while idle (see main/index.ts's
// HEARTBEAT_BROADCAST_MS). This deliberately does NOT poll Date.now() on its
// own independent timer: an earlier version did, and its poll cadence
// (1500ms) being out of phase with the heartbeat's own broadcast cadence
// (2000ms) produced a sawtooth — every 4th poll happened to land right after
// a heartbeat had just arrived (their LCM is 6000ms = 4 polls), reading
// near-zero, with the other three reading progressively higher. Measuring at
// the moment each fresh timestamp lands avoids that aliasing entirely: what
// gets reported is the actual one-way gap for that specific message, not a
// sample taken at an arbitrary point relative to it.
function reportLagFromServerTime(serverTime: number): void {
  // Withheld (not reported as 0 or as the raw uncorrected value) until the
  // first time:sync-reply lands — otherwise the very first dashboard:sync of
  // a connection (sent immediately in reply to 'hello', almost always ahead
  // of this same connection's own time:sync round trip completing) would
  // report through clockOffsetMs still at its default. The very next
  // heartbeat, at most HEARTBEAT_BROADCAST_MS later, retries once it's set.
  if (!hasClockOffset) return
  const now = Date.now()
  if (now - lastLagReportAt < LAG_REPORT_MIN_INTERVAL_MS) return
  lastLagReportAt = now
  const lagMs = Math.max(0, now + clockOffsetMs - serverTime)
  send({ type: 'device:lag-report', lagMs })
}

// Separate from `socket` on purpose — see connectLobby's comment on why
// it's not just connect(mode, ''). Closed (not left to linger) the moment a
// real deck connection starts, via closeLobby() below.
let lobbySocket: WebSocket | null = null

function closeLobby(): void {
  if (!lobbySocket) return
  const ws = lobbySocket
  lobbySocket = null
  ws.close()
}

function isTextInputElement(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

function sendHello(mode: Mode): void {
  if (mode === 'view') {
    send({
      type: 'hello',
      role: mode,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      userAgent: navigator.userAgent,
      deviceId: getDeviceId(),
      deviceToken: getDeviceToken() ?? undefined
    })
  } else {
    send({ type: 'hello', role: mode })
  }
}

// Shared "back to the picker" state, used both by an explicit disconnect()
// and by the close listener's DECK_CLOSE_CODE_UNKNOWN branch below.
function pickerResetState(): Pick<
  DashboardStore,
  | 'deckId'
  | 'connected'
  | 'dashboard'
  | 'devices'
  | 'errors'
  | 'toasts'
  | 'selectedWidgetIds'
  | 'selectedBlockId'
  | 'activeStateIndex'
  | 'editingSubDeckId'
  | 'activeSubDeckId'
  | 'activeOverlay'
> {
  return {
    deckId: null,
    connected: false,
    dashboard: DEFAULT_DASHBOARD,
    devices: [],
    errors: {},
    toasts: [],
    selectedWidgetIds: [],
    selectedBlockId: null,
    activeStateIndex: 0,
    editingSubDeckId: null,
    activeSubDeckId: null,
    activeOverlay: null
  }
}

// Button/Morph keep labels per-state (states[0].labels[0]); Gauge/Adjuster/
// Encoder keep a flat labels[]; the switch widgets keep labels per-position
// (positions[0].labels[0]); ScreenCaptureWidget has no labels concept at
// all — no single field works for all of them, hence the switch. Gauge is
// included even though it can't actually fire an action/error, purely so
// this stays a total function over Widget rather than needing its own
// narrower parameter type.
function widgetDisplayLabel(widget: Widget | undefined): string | undefined {
  if (!widget) return undefined
  if (widget.type === 'button' || widget.type === 'morph') return widget.states?.[0]?.labels?.[0]?.text
  if (widget.type === 'switch-rocker' || widget.type === 'switch-dial' || widget.type === 'switch-toggle' || widget.type === 'dropdown')
    return widget.positions?.[0]?.labels?.[0]?.text
  if (widget.type === 'screen-capture') return undefined
  return widget.labels[0]?.text
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  deckId: null,
  dashboard: DEFAULT_DASHBOARD,
  editingSubDeckId: null,
  activeSubDeckId: null,
  activeOverlay: null,
  mode: 'edit',
  connected: false,
  errors: {},
  toasts: [],
  selectedWidgetIds: [],
  selectedBlockId: null,
  activeStateIndex: 0,
  devices: [],
  devicePending: false,
  deviceDenied: false,
  pendingApprovals: [],
  decks: null,
  approvedDevices: [],
  dcsBiosAircraft: null,
  dcsBiosFieldCatalogs: {},
  dcsBiosCommandCatalogs: {},
  dcsBiosStatus: null,
  dcsBiosStats: null,
  dcsBiosSettings: null,
  dcsBiosDocsDirValidation: null,
  dcsBiosPickedFolder: null,
  dcsBiosSendCommandResult: null,
  dcsViewportsSettings: null,
  dcsViewportsStatus: null,
  dcsViewportsDcsInstallDirValidation: null,
  dcsViewportsSavedGamesDirValidation: null,
  dcsViewportsPickedDcsInstallFolder: null,
  dcsViewportsPickedSavedGamesFolder: null,
  enabledPlugins: null,
  restDataSources: [],
  restDataSourcesLanAddress: null,
  restWebhookTargets: [],
  mcpServerSettings: null,
  customFonts: [],
  customSounds: [],
  customVariants: [],
  screenCaptureDisplays: null,
  windowsAudioDevices: null,
  windowsAudioSessions: null,

  saveCustomVariant: (name, widgets) => {
    send({ type: 'custom-variants:save', name, widgets })
  },

  deleteCustomVariant: (variantId) => {
    send({ type: 'custom-variants:delete', variantId })
  },

  requestWindowsAudioDevices: () => {
    send({ type: 'windows-audio:list-devices' })
  },

  requestWindowsAudioSessions: () => {
    send({ type: 'windows-audio:list-sessions' })
  },

  requestScreenCaptureDisplays: () => {
    send({ type: 'screen-capture:list-displays' })
  },

  pickScreenCaptureRegion: (widgetId, displayId) => {
    send({ type: 'screen-capture:pick-region', widgetId, displayId })
  },

  pickPluginRegion: (sourceId, displayId) => {
    send({ type: 'plugin:pick-region', sourceId, displayId })
  },

  requestDcsBiosAircraftList: () => {
    send({ type: 'dcsbios:list-aircraft' })
  },

  requestDcsBiosFieldCatalog: (aircraft) => {
    set((s) => ({ dcsBiosFieldCatalogs: { ...s.dcsBiosFieldCatalogs, [aircraft]: 'loading' } }))
    send({ type: 'dcsbios:field-catalog', aircraft })
  },

  requestDcsBiosCommandCatalog: (aircraft) => {
    set((s) => ({ dcsBiosCommandCatalogs: { ...s.dcsBiosCommandCatalogs, [aircraft]: 'loading' } }))
    send({ type: 'dcsbios:command-catalog', aircraft })
  },

  sendDcsBiosCommand: (identifier, argument) => {
    send({ type: 'dcsbios:send-command', identifier, argument })
  },

  requestDcsBiosSettings: () => {
    send({ type: 'dcsbios:get-settings' })
  },

  updateDcsBiosSettings: (settings) => {
    send({ type: 'dcsbios:update-settings', settings })
  },

  requestDcsBiosDocsDirValidation: (docsDir) => {
    send({ type: 'dcsbios:validate-docs-dir', docsDir })
  },

  pickDcsBiosDocsFolder: () => {
    send({ type: 'dcsbios:pick-docs-folder' })
  },

  requestDcsViewportsSettings: () => {
    send({ type: 'dcsViewports:get-settings' })
  },

  requestDcsViewportsStatus: () => {
    send({ type: 'dcsViewports:get-status' })
  },

  updateDcsViewportsSettings: (settings) => {
    send({ type: 'dcsViewports:update-settings', settings })
  },

  requestDcsViewportsDcsInstallDirValidation: (dir) => {
    send({ type: 'dcsViewports:validate-dcs-install-dir', dir })
  },

  requestDcsViewportsSavedGamesDirValidation: (dir) => {
    send({ type: 'dcsViewports:validate-saved-games-dir', dir })
  },

  pickDcsViewportsDcsInstallFolder: () => {
    send({ type: 'dcsViewports:pick-dcs-install-folder' })
  },

  pickDcsViewportsSavedGamesFolder: () => {
    send({ type: 'dcsViewports:pick-saved-games-folder' })
  },

  requestAppSettings: () => {
    send({ type: 'app-settings:get' })
  },

  updateEnabledPlugins: (enabledPlugins) => {
    send({ type: 'app-settings:update', enabledPlugins })
  },

  requestRestDataSources: () => {
    send({ type: 'rest-sources:get' })
  },

  createRestDataSource: (name) => {
    send({ type: 'rest-sources:create', name })
  },

  updateRestDataSources: (sources) => {
    send({ type: 'rest-sources:update', sources })
  },

  regenerateRestDataSourceToken: (sourceId) => {
    send({ type: 'rest-sources:regenerate-token', sourceId })
  },

  deleteRestDataSource: (sourceId) => {
    send({ type: 'rest-sources:delete', sourceId })
  },

  requestMcpServerSettings: () => {
    send({ type: 'mcp-server:get' })
  },

  regenerateMcpServerToken: () => {
    send({ type: 'mcp-server:regenerate-token' })
  },

  requestRestWebhookTargets: () => {
    send({ type: 'rest-webhook-targets:get' })
  },

  createRestWebhookTarget: (name) => {
    send({ type: 'rest-webhook-targets:create', name })
  },

  updateRestWebhookTargets: (targets) => {
    send({ type: 'rest-webhook-targets:update', targets })
  },

  deleteRestWebhookTarget: (targetId) => {
    send({ type: 'rest-webhook-targets:delete', targetId })
  },

  requestCustomFonts: () => {
    send({ type: 'fonts:get' })
  },

  requestCustomSounds: () => {
    send({ type: 'sounds:get' })
  },

  uploadCustomSound: (dataUrl, label, filename) => {
    send({ type: 'sounds:upload', dataUrl, label, filename })
  },

  deleteCustomSound: (soundId) => {
    send({ type: 'sounds:delete', soundId })
  },

  updateCustomSoundStartAt: (soundId, startAtMs) => {
    send({ type: 'sounds:update', soundId, startAtMs })
  },

  uploadCustomFont: (dataUrl, label, filename) => {
    send({ type: 'fonts:upload', dataUrl, label, filename })
  },

  deleteCustomFont: (fontId) => {
    send({ type: 'fonts:delete', fontId })
  },

  updateCustomFontLineHeight: (fontId, lineHeight) => {
    send({ type: 'fonts:update', fontId, lineHeight })
  },

  connect: (mode, deckId) => {
    closeLobby()
    // Undo history from whichever deck was open before (if any) has no
    // meaning once this connects to a different one — but connect() is also
    // what the close handler's own auto-reconnect below calls after a
    // network drop, to this SAME deckId, which should leave in-progress
    // undo history alone rather than wiping it out from under the user on
    // every blip.
    if (get().deckId !== deckId) useHistoryStore.getState().clear()
    set({ mode, deckId })
    setLastDeckId(deckId)
    if (socket) return

    const host = window.location.hostname || 'localhost'
    const ws = new WebSocket(`ws://${host}:${SERVER_PORT}/ws?deck=${encodeURIComponent(deckId)}`)
    socket = ws

    ws.addEventListener('open', () => {
      set({ connected: true })
      sendHello(mode)
      syncClock()
      if (clockSyncInterval) clearInterval(clockSyncInterval)
      clockSyncInterval = setInterval(syncClock, CLOCK_SYNC_INTERVAL_MS)
      // Fresh connection, fresh offset — a clockOffsetMs left over from a
      // previous connection (e.g. a brief network drop, same server) is
      // still a reasonable estimate, but hasClockOffset resetting means
      // reportLagFromServerTime withholds reporting again just until the
      // very next time:sync-reply confirms it (or replaces it), rather than
      // ever reporting through a value that's technically stale.
      hasClockOffset = false
      lastLagReportAt = 0
    })

    ws.addEventListener('close', (event) => {
      socket = null
      if (clockSyncInterval) {
        clearInterval(clockSyncInterval)
        clockSyncInterval = null
      }
      if (intentionalDisconnect) {
        intentionalDisconnect = false
        return
      }
      if (event.code === DECK_CLOSE_CODE_UNKNOWN) {
        // The deck this connection named is missing or was deleted — retrying
        // it would just spin forever, so fall back to the picker instead of
        // auto-reconnecting. Also forget it as "last opened" — otherwise the
        // next launch would just try to restore this same dead id again.
        clearLastDeckId()
        set(pickerResetState())
        // A view client's picker reads the deck list from the lobby
        // connection (see connectLobby/DeckPicker), which App.tsx's mount
        // effect only opens when there's NO remembered deck to connect to
        // instead. Falling back here means that never happened this
        // session — without this, the picker sits on "Loading decks…"
        // forever (only a full app restart, with the id now cleared above,
        // would take the connectLobby branch and actually fetch it). Edit
        // mode's picker doesn't need this: it fetches its own list over
        // REST on mount instead.
        if (mode === 'view') get().connectLobby()
        return
      }
      if (event.code === DECK_CLOSE_CODE_DENIED) {
        // Unlike DECK_CLOSE_CODE_UNKNOWN, deliberately not pickerResetState —
        // there's no dead deck id to forget here and, in view mode, no
        // picker to fall back to; App.tsx shows a denied screen instead
        // while deviceDenied stays true.
        set({ connected: false, devicePending: false, deviceDenied: true })
        return
      }
      set({ connected: false })
      setTimeout(() => get().connect(mode, deckId), 1500)
    })

    ws.addEventListener('message', (event) => {
      const message: ServerToClient = JSON.parse(event.data)
      if (message.type === 'dashboard:sync') {
        // Only ever arrives once this connection is actually approved (or
        // never needed to be — edit mode, or an already-trusted device) —
        // see main/index.ts's sendInitialState — so receiving it doubles as
        // "no longer pending."
        // reconcileDashboard (not the raw message.dashboard) preserves
        // widget object identity across syncs wherever content didn't
        // change — see its own comment in shared/subDecks.ts for why that
        // matters: it's what lets ViewWidget/CanvasWidget's React.memo
        // actually skip re-rendering widgets a drag tick didn't touch.
        set({ dashboard: reconcileDashboard(get().dashboard, message.dashboard), devicePending: false })
        reportLagFromServerTime(message.generatedAt)
      } else if (message.type === 'time:heartbeat') {
        // Arrives every HEARTBEAT_BROADCAST_MS regardless of dashboard
        // activity — see reportLagFromServerTime's own comment for why that
        // matters: without this, an idle-but-healthy connection would look
        // like it's falling further behind the longer nobody edits anything,
        // simply because there'd be nothing new to have received.
        reportLagFromServerTime(message.serverTime)
      } else if (message.type === 'time:sync-reply') {
        // Standard NTP-style offset estimate, assuming symmetric latency
        // each way: the server's clock reading corresponds to the midpoint
        // of this round trip on the client's own clock (clientSentAt +
        // rtt/2), so offset (serverClock - clientClock) is serverTime minus
        // that midpoint. Overwrites any previous estimate outright rather
        // than averaging — a fresh measurement is always at least as good as
        // one from CLOCK_SYNC_INTERVAL_MS ago, and averaging would only slow
        // down how fast a real drift gets corrected.
        {
          const rtt = Date.now() - message.clientSentAt
          clockOffsetMs = message.serverTime - message.clientSentAt - rtt / 2
          hasClockOffset = true
        }
      } else if (message.type === 'device:token') {
        // Persisted so the NEXT hello (a reconnect, or this app relaunching)
        // already carries it — this session's own live socket doesn't need
        // it locally at all, since the server already marked this exact
        // connection trusted server-side the instant it sent this (see
        // main/index.ts's device:approve handler). Clearing devicePending
        // here too: dashboard:sync/decks:list normally does that (see
        // sendInitialState's own callers), but this message can arrive
        // fractionally before either on a slow connection, and there's no
        // reason to leave the waiting screen up a moment longer than
        // necessary once approval has visibly happened.
        setDeviceToken(message.token)
        set({ devicePending: false })
      } else if (message.type === 'device:pending') {
        set({ devicePending: true })
      } else if (message.type === 'device:denied') {
        set({ devicePending: false, deviceDenied: true })
      } else if (message.type === 'device:approval-requested') {
        set((s) => ({
          pendingApprovals: [...s.pendingApprovals.filter((d) => d.id !== message.device.id), message.device]
        }))
      } else if (message.type === 'device:approved-list') {
        set({ approvedDevices: message.devices })
      } else if (message.type === 'variables:sync') {
        // The periodic full keyframe (see ServerToClient's own comment) —
        // same effect as a dashboard:sync as far as `dashboard.variables` is
        // concerned, but leaves `dashboard.widgets`/`plugins`/`devices`
        // etc. at their existing references instead of replacing the whole
        // object graph.
        set((s) => ({ dashboard: { ...s.dashboard, variables: message.variables } }))
      } else if (message.type === 'variables:delta') {
        // Changed-only update (see ServerToClient's own comment) — merge by
        // id into the existing array rather than replacing it outright, same
        // "preserve reference identity for anything untouched" reasoning as
        // reconcileDashboard, so a widget whose expression doesn't reference
        // any of these names doesn't re-render just because SOME variable
        // elsewhere changed.
        set((s) => {
          const existing = s.dashboard.variables ?? []
          const byId = new Map(existing.map((v) => [v.id, v]))
          for (const v of message.variables) byId.set(v.id, v)
          const merged = existing.map((v) => byId.get(v.id)!)
          for (const v of message.variables) if (!existing.some((e) => e.id === v.id)) merged.push(v)
          return { dashboard: { ...s.dashboard, variables: merged } }
        })
      } else if (message.type === 'subdeck:navigate') {
        set({
          activeSubDeckId: message.target.type === 'sub-deck' ? message.target.subDeckId : null,
          activeOverlay: null
        })
      } else if (message.type === 'subdeck:open-overlay') {
        set({
          activeOverlay: { subDeckId: message.subDeckId, edge: message.edge, size: message.size, sizeUnit: message.sizeUnit }
        })
      } else if (message.type === 'subdeck:close-overlay') {
        set({ activeOverlay: null })
      } else if (message.type === 'action:error') {
        set((s) => ({ errors: { ...s.errors, [message.widgetId]: message.message } }))
        const widget = findWidgetAnywhere(get().dashboard, message.widgetId)
        const toast: ActionErrorToast = {
          id: nextId(),
          widgetId: message.widgetId,
          widgetLabel: widgetDisplayLabel(widget),
          event: message.detail?.event,
          path: message.detail?.path,
          stepKind: message.detail?.stepKind,
          message: message.message,
          createdAt: Date.now()
        }
        set((s) => ({ toasts: [...s.toasts, toast].slice(-5) }))
      } else if (message.type === 'action:log') {
        pushRemoteDebugLog(message.message)
      } else if (message.type === 'devices:sync') {
        set({ devices: message.devices })
      } else if (message.type === 'windows-audio:devices') {
        set({ windowsAudioDevices: message.devices })
      } else if (message.type === 'windows-audio:sessions') {
        set({ windowsAudioSessions: message.sessions })
      } else if (message.type === 'screen-capture:displays') {
        set({ screenCaptureDisplays: message.displays })
      } else if (message.type === 'dcsbios:aircraft-list') {
        set({ dcsBiosAircraft: message.aircraft })
      } else if (message.type === 'dcsbios:field-catalog') {
        set((s) => ({ dcsBiosFieldCatalogs: { ...s.dcsBiosFieldCatalogs, [message.aircraft]: message.fields } }))
      } else if (message.type === 'dcsbios:field-catalog-error') {
        set((s) => ({ dcsBiosFieldCatalogs: { ...s.dcsBiosFieldCatalogs, [message.aircraft]: { error: message.message } } }))
      } else if (message.type === 'dcsbios:status') {
        const { type: _type, ...status } = message
        set({ dcsBiosStatus: status })
      } else if (message.type === 'dcsbios:stats') {
        const { type: _type, ...stats } = message
        set({ dcsBiosStats: stats })
      } else if (message.type === 'dcsbios:settings') {
        const { type: _type, ...settings } = message
        set({ dcsBiosSettings: settings })
      } else if (message.type === 'dcsbios:docs-dir-validation') {
        const { type: _type, ...validation } = message
        set({ dcsBiosDocsDirValidation: validation })
      } else if (message.type === 'dcsbios:docs-folder-picked') {
        set({ dcsBiosPickedFolder: message.path })
      } else if (message.type === 'dcsbios:command-catalog') {
        set((s) => ({ dcsBiosCommandCatalogs: { ...s.dcsBiosCommandCatalogs, [message.aircraft]: message.commands } }))
      } else if (message.type === 'dcsbios:command-catalog-error') {
        set((s) => ({ dcsBiosCommandCatalogs: { ...s.dcsBiosCommandCatalogs, [message.aircraft]: { error: message.message } } }))
      } else if (message.type === 'dcsbios:send-command-result') {
        set({ dcsBiosSendCommandResult: { ok: message.ok, error: message.error } })
      } else if (message.type === 'dcsViewports:settings') {
        const { type: _type, ...settings } = message
        set({ dcsViewportsSettings: settings })
      } else if (message.type === 'dcsViewports:status') {
        const { type: _type, ...status } = message
        set({ dcsViewportsStatus: status })
      } else if (message.type === 'dcsViewports:dcs-install-dir-validation') {
        set({ dcsViewportsDcsInstallDirValidation: { dir: message.dir, valid: message.valid } })
      } else if (message.type === 'dcsViewports:saved-games-dir-validation') {
        set({ dcsViewportsSavedGamesDirValidation: { dir: message.dir, valid: message.valid } })
      } else if (message.type === 'dcsViewports:dcs-install-folder-picked') {
        set({ dcsViewportsPickedDcsInstallFolder: message.path })
      } else if (message.type === 'dcsViewports:saved-games-folder-picked') {
        set({ dcsViewportsPickedSavedGamesFolder: message.path })
      } else if (message.type === 'app-settings:settings') {
        set({ enabledPlugins: message.enabledPlugins })
      } else if (message.type === 'rest-sources:list') {
        set({ restDataSources: message.sources, restDataSourcesLanAddress: message.lanAddress })
      } else if (message.type === 'rest-webhook-targets:list') {
        set({ restWebhookTargets: message.targets })
      } else if (message.type === 'mcp-server:settings') {
        set({
          mcpServerSettings: { bearerToken: message.bearerToken, port: message.port, listening: message.listening, listenError: message.listenError }
        })
      } else if (message.type === 'fonts:list') {
        set({ customFonts: message.fonts })
        // Both side effects outside the render tree, not component effects —
        // every client (editor and Android view) needs its @font-face rules
        // AND its resolveFont-visible lineHeight overrides current the
        // moment this arrives, not just whichever component happens to be
        // mounted and reading customFonts right now (e.g. a ViewCanvas label
        // using a font the Settings modal, where uploads happen, isn't even
        // open to react to).
        syncCustomFontFaces(message.fonts)
        registerCustomFonts(message.fonts)
      } else if (message.type === 'sounds:list') {
        set({ customSounds: message.sounds })
      } else if (message.type === 'sound:play') {
        // Resolved against the library rather than the message carrying a
        // filename, so a sound renamed after an action was authored still
        // plays. An unknown id (deleted since, or a sounds:list that hasn't
        // landed yet) is a silent no-op — same posture as the server side.
        const sound = get().customSounds.find((s) => s.id === message.soundId)
        if (sound) playSound(sound, message.volume, message.startAtMs)
      } else if (message.type === 'custom-variants:list') {
        set({ customVariants: message.variants })
      } else if (message.type === 'dashboard:external-change') {
        // Only ever arrives in edit mode — the server only broadcasts this
        // to edit-role sockets in the first place (see
        // broadcastToEditClients in main/index.ts), so there's no need to
        // gate on `mode` here too. Fire-and-forget: the confirm dialog is
        // async, but nothing here needs to await its result — send() below
        // is what actually asks the server to reload, once the user says so.
        useConfirmStore
          .getState()
          .confirm('This dashboard changed on disk, outside the app. Reload it? Any unsaved changes here will be lost.', {
            confirmLabel: 'Reload',
            cancelLabel: 'Keep editing'
          })
          .then((ok) => {
            if (ok) send({ type: 'dashboard:reload' })
          })
      }
    })

    if (mode === 'view') {
      // Android shrinks window.innerHeight when the on-screen keyboard opens
      // (e.g. focusing the device settings modal's name field), which would
      // otherwise get reported as the device's real viewport and shrink its
      // guide bounds on the desktop. Skip the resize while a text field is
      // focused; focusout re-syncs once the keyboard has had a moment to
      // close back down.
      window.addEventListener('resize', () => {
        if (isTextInputElement(document.activeElement)) return
        sendHello(mode)
      })
      document.addEventListener(
        'focusout',
        (e) => {
          if (isTextInputElement(e.target as Element | null)) {
            setTimeout(() => sendHello(mode), 250)
          }
        },
        true
      )
    }
  },

  connectLobby: () => {
    if (lobbySocket || socket) return

    const host = window.location.hostname || 'localhost'
    const ws = new WebSocket(`ws://${host}:${SERVER_PORT}/ws`)
    lobbySocket = ws

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          role: 'view',
          viewport: { width: window.innerWidth, height: window.innerHeight },
          userAgent: navigator.userAgent,
          deviceId: getDeviceId(),
          deviceToken: getDeviceToken() ?? undefined
        } satisfies ClientToServer)
      )
    })

    ws.addEventListener('close', (event) => {
      // Superseded by closeLobby() (a real deck got picked) — that's an
      // intentional teardown, not a drop, so don't reconnect a lobby
      // nothing needs anymore.
      if (lobbySocket !== ws) return
      lobbySocket = null
      if (event.code === DECK_CLOSE_CODE_DENIED) {
        set({ devicePending: false, deviceDenied: true })
        return
      }
      setTimeout(() => get().connectLobby(), 1500)
    })

    ws.addEventListener('message', (event) => {
      const message: ServerToClient = JSON.parse(event.data)
      if (message.type === 'device:pending') {
        set({ devicePending: true })
      } else if (message.type === 'device:denied') {
        set({ devicePending: false, deviceDenied: true })
      } else if (message.type === 'device:token') {
        // Load-bearing here, not just on the deck socket (see connect()'s
        // own copy): a device approved while sitting on the PICKER gets its
        // token over THIS connection. Without persisting it here, approval
        // appeared to work — the deck list arrives either way — but nothing
        // was ever written to localStorage, so the next hello (the deck
        // socket opened the moment a deck is tapped) carried no token and
        // the server correctly asked for approval a second time. That's the
        // approve-twice-on-first-connect bug: one prompt for the lobby, one
        // for the deck, with only the second one actually sticking.
        setDeviceToken(message.token)
        set({ devicePending: false })
      } else if (message.type === 'device:approval-requested') {
        set((s) => ({
          pendingApprovals: [...s.pendingApprovals.filter((d) => d.id !== message.device.id), message.device]
        }))
      } else if (message.type === 'decks:list') {
        set({ decks: message.decks, devicePending: false })
      }
    })
  },

  disconnect: () => {
    intentionalDisconnect = true
    socket?.close()
    socket = null
    clearLastDeckId()
    set(pickerResetState())
    useHistoryStore.getState().clear()
    // Same reasoning as the DECK_CLOSE_CODE_UNKNOWN close handler above: a
    // view client's picker only gets its deck list from the lobby
    // connection, which App.tsx's mount effect skips whenever a remembered
    // deck id sends it straight into connect() instead. Without this, an
    // explicit "Change deck" after that kind of launch leaves the picker on
    // "Loading decks…" forever, since no lobby connection ever existed this
    // session to send decks:list.
    if (get().mode === 'view') get().connectLobby()
  },

  updateWidgets: (widgets, options) => {
    useHistoryStore.getState().recordBeforeMutation({ final: options?.final })
    const dashboard = setSubDeckWidgets(get().dashboard, get().editingSubDeckId, widgets)
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard, final: options?.final ?? true })
  },

  restoreDashboard: (dashboard) => {
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  updateDashboardMeta: (fields) => {
    useHistoryStore.getState().recordBeforeMutation()
    const dashboard = { ...get().dashboard, ...fields }
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  uploadBackgroundImage: (dataUrl) => {
    useHistoryStore.getState().recordBeforeMutation()
    send({ type: 'background-image:upload', dataUrl })
  },

  clearBackgroundImage: () => {
    useHistoryStore.getState().recordBeforeMutation()
    send({ type: 'background-image:clear' })
  },

  setGridSize: (value) => {
    useHistoryStore.getState().recordBeforeMutation()
    const dashboard = setSubDeckGridSize(get().dashboard, get().editingSubDeckId, Math.max(1, Math.round(value)))
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  setCanvasSize: (width, height) => {
    useHistoryStore.getState().recordBeforeMutation()
    const dashboard = setSubDeckCanvasSize(get().dashboard, get().editingSubDeckId, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  addWidget: (widget) => {
    get().updateWidgets([...getSubDeckWidgets(get().dashboard, get().editingSubDeckId), widget])
  },

  // Pasted widgets replace the current selection with themselves, so a
  // pasted batch is immediately draggable as a group without an extra click.
  pasteWidgets: (widgets) => {
    get().updateWidgets([...getSubDeckWidgets(get().dashboard, get().editingSubDeckId), ...widgets])
    set({ selectedWidgetIds: widgets.map((w) => w.id), selectedBlockId: null, activeStateIndex: 0 })
  },

  // Widgets render (and thus paint-stack) in array order — last wins any
  // overlap. These reorder within the array without touching x/y/etc, so a
  // widget can be pulled on top of (or pushed under) whatever it visually
  // overlaps without an explicit per-widget z-index.
  bringToFront: (ids) => {
    const idSet = new Set(ids)
    const widgets = getSubDeckWidgets(get().dashboard, get().editingSubDeckId)
    get().updateWidgets([...widgets.filter((w) => !idSet.has(w.id)), ...widgets.filter((w) => idSet.has(w.id))])
  },

  sendToBack: (ids) => {
    const idSet = new Set(ids)
    const widgets = getSubDeckWidgets(get().dashboard, get().editingSubDeckId)
    get().updateWidgets([...widgets.filter((w) => idSet.has(w.id)), ...widgets.filter((w) => !idSet.has(w.id))])
  },

  removeWidget: (id) => {
    get().updateWidgets(getSubDeckWidgets(get().dashboard, get().editingSubDeckId).filter((w) => w.id !== id))
    set((s) => ({ selectedWidgetIds: s.selectedWidgetIds.filter((w) => w !== id), selectedBlockId: null }))
  },

  removeWidgets: (ids) => {
    const idSet = new Set(ids)
    get().updateWidgets(getSubDeckWidgets(get().dashboard, get().editingSubDeckId).filter((w) => !idSet.has(w.id)))
    set((s) => ({ selectedWidgetIds: s.selectedWidgetIds.filter((w) => !idSet.has(w)), selectedBlockId: null }))
  },

  groupWidgets: (ids) => {
    const idSet = new Set(ids)
    const groupId = nextId()
    const widgets = getSubDeckWidgets(get().dashboard, get().editingSubDeckId)
    get().updateWidgets(widgets.map((w) => (idSet.has(w.id) ? { ...w, groupId } : w)))
  },

  ungroupWidgets: (ids) => {
    const idSet = new Set(ids)
    const widgets = getSubDeckWidgets(get().dashboard, get().editingSubDeckId)
    get().updateWidgets(widgets.map((w) => (idSet.has(w.id) ? { ...w, groupId: undefined } : w)))
  },

  setEditingSubDeck: (subDeckId) => {
    set({ editingSubDeckId: subDeckId, selectedWidgetIds: [], selectedBlockId: null, activeStateIndex: 0 })
  },

  addSubDeck: (name) => {
    useHistoryStore.getState().recordBeforeMutation()
    const subDeck: SubDeck = { id: nextId(), name, widgets: [] }
    const dashboard = { ...get().dashboard, subDecks: [...(get().dashboard.subDecks ?? []), subDeck] }
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
    get().setEditingSubDeck(subDeck.id)
  },

  renameSubDeck: (id, name) => {
    useHistoryStore.getState().recordBeforeMutation()
    const dashboard = {
      ...get().dashboard,
      subDecks: (get().dashboard.subDecks ?? []).map((sd) => (sd.id === id ? { ...sd, name } : sd))
    }
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
  },

  removeSubDeck: (id) => {
    useHistoryStore.getState().recordBeforeMutation()
    const dashboard = { ...get().dashboard, subDecks: (get().dashboard.subDecks ?? []).filter((sd) => sd.id !== id) }
    set({ dashboard })
    send({ type: 'dashboard:update', dashboard })
    if (get().editingSubDeckId === id) get().setEditingSubDeck(null)
  },

  triggerWidget: (id, event, value, final) => {
    // Optimistically clear any error from a previous attempt — otherwise a
    // stale red banner sticks on the widget forever, even after fixing
    // whatever caused it, since nothing else ever removes an entry here. A
    // fresh action:error re-populates it if this attempt fails too.
    set((s) => {
      if (!(id in s.errors)) return {}
      const errors = { ...s.errors }
      delete errors[id]
      return { errors }
    })
    send({ type: 'action:trigger', widgetId: id, event, ...(value !== undefined && { value }), ...(final === false && { final }) })
  },

  closeOverlay: () => {
    set({ activeOverlay: null })
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  selectWidget: (id, options) => {
    if (id === null) {
      set({ selectedWidgetIds: [], selectedBlockId: null, activeStateIndex: 0 })
      return
    }
    if (options?.additive) {
      set((s) => ({
        selectedWidgetIds: s.selectedWidgetIds.includes(id)
          ? s.selectedWidgetIds.filter((w) => w !== id)
          : [...s.selectedWidgetIds, id],
        selectedBlockId: null,
        activeStateIndex: 0
      }))
      return
    }
    // First click on a grouped-but-unselected widget selects the whole
    // group (every widget sharing its groupId), not just the one clicked —
    // the properties panel's existing multi-select UI takes it from there.
    // Skipped when `exact` is set (the collapse-on-reclick path in
    // useWidgetDrag's handlePointerUp), which always drills into just the
    // one widget regardless of grouping.
    let resolvedIds = [id]
    if (!options?.exact) {
      const widgets = getSubDeckWidgets(get().dashboard, get().editingSubDeckId)
      const target = widgets.find((w) => w.id === id)
      if (target?.groupId) {
        resolvedIds = widgets.filter((w) => w.groupId === target.groupId).map((w) => w.id)
      }
    }
    set((s) => {
      // A no-op re-click on an already-sole-selected widget (see
      // useWidgetDrag's handlePointerUp, which re-confirms selection on
      // every clean click so a multi-select can collapse to one) must not
      // clobber a block selection made in this same click's pointerdown.
      if (
        s.selectedWidgetIds.length === resolvedIds.length &&
        resolvedIds.every((rid) => s.selectedWidgetIds.includes(rid))
      ) {
        return {}
      }
      return { selectedWidgetIds: resolvedIds, selectedBlockId: null, activeStateIndex: 0 }
    })
  },

  selectWidgets: (ids, options) => {
    set((s) => ({
      selectedWidgetIds: options?.additive ? Array.from(new Set([...s.selectedWidgetIds, ...ids])) : ids,
      selectedBlockId: null,
      activeStateIndex: 0
    }))
  },

  selectBlock: (id) => {
    set({ selectedBlockId: id })
  },

  setActiveStateIndex: (indexOrUpdater) => {
    set((s) => ({
      activeStateIndex: typeof indexOrUpdater === 'function' ? indexOrUpdater(s.activeStateIndex) : indexOrUpdater
    }))
  },

  renameDevice: (deviceId, name) => {
    send({ type: 'device:rename', deviceId, name })
  },

  approveDevice: (deviceId) => {
    send({ type: 'device:approve', deviceId })
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((d) => d.id !== deviceId) }))
  },

  denyDevice: (deviceId) => {
    send({ type: 'device:deny', deviceId })
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((d) => d.id !== deviceId) }))
  },

  requestApprovedDevices: () => {
    send({ type: 'device:list-approved' })
  },

  revokeDeviceApproval: (deviceId) => {
    send({ type: 'device:revoke', deviceId })
  }
}))

// The currently-editing screen's own grid size — main deck or whichever
// sub-deck is open (see getSubDeckGridSize in shared/subDecks.ts). A small
// hook rather than a plain field on DashboardStore so every consumer
// (Toolbar's input, CanvasWidget/MorphCanvasWidget/useWidgetDrag's snap
// math) gets this resolved the same way instead of recomputing it inline —
// drop-in replacement for the old, single global useEditorSettings(s =>
// s.gridSize).
export function useGridSize(): number {
  const gridSize = useDashboardStore((s) => s.dashboard.gridSize)
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks)
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  return getSubDeckGridSize({ gridSize, subDecks }, editingSubDeckId)
}

// The currently-editing screen's own reference canvas size — same pattern as
// useGridSize() above, for the deployed view's letterboxing (see
// getSubDeckCanvasSize in shared/subDecks.ts).
export function useCanvasSize(): { width: number; height: number } {
  const canvasWidth = useDashboardStore((s) => s.dashboard.canvasWidth)
  const canvasHeight = useDashboardStore((s) => s.dashboard.canvasHeight)
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks)
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  return getSubDeckCanvasSize({ canvasWidth, canvasHeight, subDecks }, editingSubDeckId)
}
