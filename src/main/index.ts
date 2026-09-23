import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  readFile,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  rmSync,
  copyFileSync,
  statSync,
  watch,
  type FSWatcher
} from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import { Agent as UndiciAgent } from 'undici'
import { Bonjour, type Service } from 'bonjour-service'
import { z } from 'zod'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { SERVER_PORT, MCP_SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN, DECK_CLOSE_CODE_DENIED, MDNS_SERVICE_TYPE, DCS_COMMAND_VALUE_SHORTHAND } from '../shared/constants'
import {
  DEFAULT_DASHBOARD,
  DECK_EXPORT_FORMAT_VERSION,
  type ActionStep,
  type ButtonWidget,
  type CallRestAction,
  type ClientToServer,
  type Dashboard,
  type DeckExportFile,
  type DeckSummary,
  type DcsViewportWidget,
  type DeviceInfo,
  type DialSwitchWidget,
  type DropdownWidget,
  type ToggleSwitchWidget,
  type GlobalAction,
  type PlaySoundAction,
  type Plugin,
  type ConditionStep,
  type KeypressAction,
  type RestDataSource,
  type RestWebhookTarget,
  type RockerSwitchWidget,
  type ScreenRegion,
  type SendDcsCommandAction,
  type SequenceStep,
  type ServerToClient,
  type SetWindowsAudioAction,
  type StepPath,
  type SwitchPosition,
  type Variable,
  type VariableValue,
  type Widget,
  type WidgetAction,
  type WidgetEventKind
} from '../shared/types'
import { getEventSteps, flattenSequenceSteps } from '../shared/widgetEvents'
import { FONT_MIME_BY_EXTENSION, fontExtension, isCustomFontId, customFontIdFromFieldValue } from '../shared/fonts'
import { findSubDeck, findWidgetAnywhere, allDeckWidgets } from '../shared/subDecks'
import { toVariableMap, setExpressionConsoleSink, stringifyExpressionLogArgs } from '../shared/expr'
// tryEvaluateExpression/evaluateMappingExpression come from the sandboxed
// main-process-only version, NOT shared/expr.ts's own — see
// sandboxedExpr.ts's own top comment for why this specific process needs
// the hardened one. Every renderer-facing use of these two (ViewCanvas.tsx,
// states.ts, switchPosition.ts, ...) still imports the plain shared version
// directly — unaffected by this swap.
import { tryEvaluateExpression, evaluateMappingExpression } from './sandboxedExpr'
import { readBody } from './httpBody'
import { extractAllPlaceholders } from '../shared/restPlaceholders'
import { PLUGIN_PRODUCERS } from './plugins'
import { listDisplays, openRegionPicker, captureRegionJpeg, clampFps, clampQuality, addMjpegViewer } from './screenCapture'
import { getAppSettings, updateAppSettings, type AppSettings } from './appSettings'
import { checkForUpdates } from './autoUpdate'
import { getMcpServerSettings, regenerateMcpServerToken } from './mcpServerSettings'
import { syncMcpServer, getMcpListenStatus, type McpDeps } from './mcp/server'
import { getCustomFonts, addCustomFont, addCustomFontWithId, deleteCustomFont, updateCustomFontLineHeight, customFontFile } from './customFonts'
import { getCustomSounds, addCustomSound, addCustomSoundWithId, deleteCustomSound, updateCustomSoundStartAt, customSoundFile } from './customSounds'
import { SOUND_MIME_BY_EXTENSION, soundExtension, soundVolumeToGain } from '../shared/sounds'
import { getCustomVariants, addCustomVariant, deleteCustomVariant } from './customVariants'
import {
  listDevices as listWindowsAudioDevices,
  getSnapshot as getWindowsAudioSnapshot,
  setVolume as setWindowsAudioVolume,
  setMute as setWindowsAudioMute,
  listSessions as listWindowsAudioSessions,
  getSessionSnapshot as getWindowsAudioSessionSnapshot,
  setSessionVolume as setWindowsAudioSessionVolume,
  setSessionMute as setWindowsAudioSessionMute
} from './windowsAudio/connectionManager'
import { getRestDataSources, updateRestDataSources, createRestDataSource, regenerateRestDataSourceToken } from './restDataSources'
import { syncRestIncomingServers, getRestListenStatus } from './restIncoming'
import { getRestWebhookTargets, updateRestWebhookTargets, createRestWebhookTarget } from './restWebhookTargets'
import { verifyDeviceToken, approveDevice, revokeDevice, renameApprovedDevice, listApprovedDevices } from './deviceApproval'
import { displayDeviceName } from '../shared/deviceName'
import {
  listInstalledAircraft,
  getFieldCatalog,
  getCommandCatalog,
  sendCommand as sendDcsBiosCommand,
  getSettings as getDcsBiosSettings,
  updateSettings as updateDcsBiosSettings,
  validateDocsDir,
  getStatus as getDcsBiosStatus,
  onStatusChange as onDcsBiosStatusChange,
  getWorkerStats as getDcsBiosWorkerStats,
  onStatsChange as onDcsBiosStatsChange
} from './dcsBios/connectionManager'
import {
  getSettings as getDcsViewportsSettings,
  updateSettings as updateDcsViewportsSettings,
  validateDcsInstallDir as validateDcsViewportsInstallDir,
  validateSavedGamesDir as validateDcsViewportsSavedGamesDir,
  getStatus as getDcsViewportsStatus,
  refreshStatus as refreshDcsViewportsStatus,
  onStatusChange as onDcsViewportsStatusChange,
  resolveComponentRegion as resolveDcsViewportComponentRegion
} from './dcsViewports'

// A rejected promise anywhere that isn't already inside its own try/catch
// (a plugin producer's async tick, a WS message handler's own async work,
// ...) otherwise surfaces only as a raw UnhandledPromiseRejectionWarning in
// the terminal — easy to miss, and invisible anywhere in-app. This is only a
// safety net for visibility, not recovery: the promise's own rejection is
// already unhandled by the time this fires, so there's nothing left to do
// but log it clearly.
process.on('unhandledRejection', (reason) => {
  console.error('[boarderoni] Unhandled promise rejection:', reason)
})

// Pre-multi-label shape: a single flat `label` string plus its own styling
// fields (including a widget-level `padding`), before they moved into
// ButtonWidget.labels[] (and padding moved from the widget onto each label).
interface LegacyButtonWidget {
  label?: string
  fontFamily?: string
  fontSize?: number
  textColor?: string
  textOpacity?: number
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'center' | 'bottom'
  padding?: number
  // Pre-states shape: labels/color/border/opacity lived flat on the widget
  // itself, before they moved into ButtonWidget.states[].
  labels?: ButtonWidget['states'][number]['labels']
  color?: string
  borderColor?: string
  backgroundOpacity?: number
  borderOpacity?: number
  states?: ButtonWidget['states']
}

// Pre-events shape: one `action: WidgetAction` field per widget, before it
// was replaced by `events: {press,release[,move]}` sequences (see
// SequenceStep/WidgetEventKind in shared/types.ts). Only Button/Morph/
// Adjuster ever had this — Gauge was always actionless.
interface LegacyActionWidget {
  action?: WidgetAction
}

function migrateWidgetEvents(widget: Widget & LegacyActionWidget): Widget {
  if (widget.type === 'gauge-bar' || widget.type === 'gauge-arc') return widget
  if ('events' in widget && widget.events) return widget // already migrated
  if (!widget.action) return widget // tolerate a malformed widget with neither shape

  const step: ActionStep = { kind: 'action', id: randomUUID(), action: widget.action }
  const { action: _action, ...rest } = widget

  if ((widget.type as string) === 'adjuster' || widget.type === 'adjuster-slider' || widget.type === 'adjuster-knob') {
    // Legacy drag behavior fired continuously while dragging — maps to
    // 'move' so a migrated widget's actual trigger moments don't change.
    return { ...rest, events: { press: [], release: [], move: [step] } } as Widget
  }
  // Button/Morph: legacy behavior fired on the native onClick (effectively
  // "tap completed") — maps to 'release', matching where the new
  // pointerdown/pointerup-based wiring fires for the same gesture. 'press'
  // stays empty so a migrated widget's real trigger moment is unchanged.
  return { ...rest, events: { press: [], release: [step] } } as Widget
}

// Pre-split shape: a single 'switch' widget type with a `style` field
// choosing rocker-vs-rotary rendering, plus a server-authoritative
// `currentIndex` broadcast to every client — before it was split into
// RockerSwitchWidget/DialSwitchWidget (each its own widget type, no shared
// style toggle) and currentIndex was dropped in favor of activePositionExpr
// + per-client local selection (see SwitchWidgetBase's own comment in
// shared/types.ts for why a switch's position isn't synced dashboard state).
interface LegacySwitchWidget {
  type?: string
  style?: 'rocker' | 'rotary'
  currentIndex?: number
}

function migrateSwitchWidget(widget: Widget & LegacySwitchWidget): Widget {
  if ((widget.type as string) !== 'switch') return widget as Widget
  const { style, currentIndex: _currentIndex, ...rest } = widget
  return { ...rest, type: style === 'rotary' ? 'switch-dial' : 'switch-rocker' } as Widget
}

// Pre-4-direction shape: DropdownWidget.orientation was just
// 'vertical'/'horizontal' before it split into which physical direction the
// stack grows too (see shared/dropdownLayout.ts) — 'vertical' always grew
// downward and 'horizontal' always grew right, so those map onto whichever
// new value renders identically.
function migrateDropdownOrientation(widget: DropdownWidget): DropdownWidget {
  const orientation = widget.orientation as string | undefined
  if (orientation === 'vertical') return { ...widget, orientation: 'top-to-bottom' }
  if (orientation === 'horizontal') return { ...widget, orientation: 'left-to-right' }
  return widget
}

// Pre-split shape: a single 'gauge' widget type with a `style` field choosing
// bar-vs-arc rendering, before it was split into BarGaugeWidget/ArcGaugeWidget
// (each its own widget type, no shared style toggle) — same split as
// migrateSwitchWidget's own rocker/dial one above. Fields irrelevant to the
// chosen style (e.g. an old bar gauge's arc-only fields, if any were ever
// set) are just left in the object unused — the new narrower TS type simply
// won't reference them.
interface LegacyGaugeWidget {
  type?: string
  style?: 'bar' | 'arc'
}

function migrateGaugeWidget(widget: Widget & LegacyGaugeWidget): Widget {
  if ((widget.type as string) !== 'gauge') return widget as Widget
  const { style, ...rest } = widget
  return { ...rest, type: style === 'arc' ? 'gauge-arc' : 'gauge-bar' } as Widget
}

// Pre-split shape: a single 'adjuster' widget type with a `style` field
// choosing slider-vs-knob rendering, before it was split into
// AdjusterSliderWidget/AdjusterKnobWidget (each its own widget type, no
// shared style toggle) — same split as migrateGaugeWidget's own bar/arc one
// above. Fields irrelevant to the chosen style (e.g. an old slider's knob-
// only fields, if any were ever set) are just left in the object unused —
// the new narrower TS type simply won't reference them.
interface LegacyAdjusterWidget {
  type?: string
  style?: 'slider' | 'knob'
}

function migrateAdjusterWidget(widget: Widget & LegacyAdjusterWidget): Widget {
  if ((widget.type as string) !== 'adjuster') return widget as Widget
  const { style, ...rest } = widget
  return { ...rest, type: style === 'knob' ? 'adjuster-knob' : 'adjuster-slider' } as Widget
}

// labelAnchor started out on the DialSwitchWidget itself (one fixed side for
// every detent), then briefly moved onto each SwitchPosition (one fixed side
// per detent, still shared by every label on it) before landing on each
// WidgetLabel so a single detent's labels can anchor independently of each
// other too. An old value at either abandoned level becomes every label
// beneath it that doesn't already have its own (most specific wins:
// label > position > widget), then both legacy fields are dropped.
interface LegacyDialSwitchWidget {
  labelAnchor?: 'top' | 'bottom' | 'left' | 'right'
}
interface LegacySwitchPosition {
  labelAnchor?: 'top' | 'bottom' | 'left' | 'right'
}

function migrateDialSwitchLabelAnchor(widget: DialSwitchWidget & LegacyDialSwitchWidget): DialSwitchWidget {
  const { labelAnchor: widgetAnchor, ...rest } = widget
  const positions = widget.positions.map((position) => {
    const { labelAnchor: positionAnchor, ...restPosition } = position as typeof position & LegacySwitchPosition
    const anchor = positionAnchor ?? widgetAnchor
    if (anchor === undefined) return restPosition
    return { ...restPosition, labels: restPosition.labels.map((l) => (l.labelAnchor === undefined ? { ...l, labelAnchor: anchor } : l)) }
  })
  return { ...rest, positions }
}

// DialSwitchWidget/ToggleSwitchWidget/RockerSwitchWidget gained their own
// flat, whole-widget `labels[]` (same convention as Gauge/Adjuster/Encoder)
// after already shipping with only per-position labels — a dashboard saved
// before that needs the field backfilled, same as `variables`/`plugins`
// get defaulted in loadDeckDashboard, just per-widget instead of per-dashboard.
function migrateSwitchWidgetTopLevelLabels<T extends DialSwitchWidget | ToggleSwitchWidget | RockerSwitchWidget>(widget: T): T {
  return Array.isArray(widget.labels) ? widget : { ...widget, labels: [] }
}

// RockerSwitchWidget/ToggleSwitchWidget/DialSwitchWidget gained root-level
// press/release/positionChange (alongside, not instead of, each position's
// own onSelect — see RockerSwitchWidget.events' own comment) after already
// shipping with no `events` at all; DropdownWidget already had press/
// release from the start but gained positionChange alongside them the same
// way. A dashboard saved before either needs whichever keys are missing
// backfilled to empty sequences.
function migrateSwitchWidgetPositionChangeEvents<T extends RockerSwitchWidget | ToggleSwitchWidget | DialSwitchWidget | DropdownWidget>(
  widget: T
): T {
  const events = widget.events as { press?: SequenceStep[]; release?: SequenceStep[]; positionChange?: SequenceStep[] } | undefined
  return { ...widget, events: { ...widget.events, press: events?.press ?? [], release: events?.release ?? [], positionChange: events?.positionChange ?? [] } }
}

// DialSwitchWidget-only — its own increment/decrement ('Turn CW'/'Turn CCW',
// same vocabulary EncoderWidget uses — see DialSwitchWidget.events' own
// comment), backfilled the same way.
function migrateDialSwitchIncrementDecrement(widget: DialSwitchWidget): DialSwitchWidget {
  const events = widget.events as { increment?: SequenceStep[]; decrement?: SequenceStep[] } | undefined
  return { ...widget, events: { ...widget.events, increment: events?.increment ?? [], decrement: events?.decrement ?? [] } }
}

// ToggleSwitchWidget gained events.guardToggle (see its own comment in
// shared/types.ts) after already shipping with guardEnabled/guardOpenExpr —
// a dashboard saved before that needs it backfilled to an empty sequence,
// same convention as migrateSwitchWidgetPositionChangeEvents above.
function migrateToggleSwitchGuardEvent(widget: ToggleSwitchWidget): ToggleSwitchWidget {
  const events = widget.events as { guardToggle?: SequenceStep[] }
  return { ...widget, events: { ...widget.events, guardToggle: events.guardToggle ?? [] } }
}

// fireWhileDragging now defaults on for every toggle switch, including ones
// saved before it existed (or before it was flipped on) — not just freshly
// created ones (see Palette.tsx's handleAddToggleSwitch). Unconditional
// rather than an `?? true` backfill: any existing false is itself pre-
// default, from before this migration existed, not a deliberate opt-out.
function migrateToggleSwitchFireWhileDragging(widget: ToggleSwitchWidget): ToggleSwitchWidget {
  if (widget.fireWhileDragging === true) return widget
  return { ...widget, fireWhileDragging: true }
}

// Same backfill as migrateToggleSwitchFireWhileDragging above, for
// DialSwitchWidget's own fireWhileDragging (see its own comment in
// shared/types.ts).
function migrateDialSwitchFireWhileDragging(widget: DialSwitchWidget): DialSwitchWidget {
  if (widget.fireWhileDragging === true) return widget
  return { ...widget, fireWhileDragging: true }
}

// RockerSwitchWidget gained onInactive (see its own comment in
// shared/types.ts) after already shipping with settleToInactive — a
// dashboard saved before that needs it backfilled to an empty sequence, same
// convention as migrateToggleSwitchGuardEvent above.
function migrateRockerSwitchInactiveAction(widget: RockerSwitchWidget): RockerSwitchWidget {
  return Array.isArray(widget.onInactive) ? widget : { ...widget, onInactive: [] }
}

// SwitchWidgetBase.positions is typed as "at least 2" but nothing on the
// load path ever enforced that at runtime — a corrupted/hand-edited
// dashboard.json, or a widget caught mid-migration by an old app version,
// could carry a missing/undersized array. Every render path downstream
// assumes it, so backfill to the same two-position shape Palette.tsx gives a
// freshly-created switch/dropdown, rather than let the render crash blank
// the whole app the next time this deck loads (see ErrorBoundary.tsx).
function backfillSwitchPositions<T extends { positions: SwitchPosition[] }>(widget: T): T {
  if (Array.isArray(widget.positions) && widget.positions.length >= 2) return widget
  return {
    ...widget,
    positions: [
      { id: randomUUID(), name: 'Position 1', labels: [], onSelect: [] },
      { id: randomUUID(), name: 'Position 2', labels: [], onSelect: [] }
    ]
  }
}

function migrateWidget(
  widget: Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget & LegacyGaugeWidget & LegacyAdjusterWidget
): Widget {
  widget = migrateWidgetEvents(widget) as Widget & LegacyButtonWidget & LegacyActionWidget
  widget = migrateSwitchWidget(widget) as Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget
  widget = migrateGaugeWidget(widget) as Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget & LegacyGaugeWidget
  widget = migrateAdjusterWidget(widget) as Widget &
    LegacyButtonWidget &
    LegacyActionWidget &
    LegacySwitchWidget &
    LegacyGaugeWidget &
    LegacyAdjusterWidget

  // Dropdown has its own narrower orientation migration too (see
  // migrateDropdownOrientation) alongside the events backfill every switch
  // type below also gets.
  if (widget.type === 'dropdown') return migrateSwitchWidgetPositionChangeEvents(migrateDropdownOrientation(backfillSwitchPositions(widget)))

  if (widget.type === 'switch-dial') {
    return migrateDialSwitchFireWhileDragging(
      migrateDialSwitchIncrementDecrement(
        migrateSwitchWidgetPositionChangeEvents(
          migrateSwitchWidgetTopLevelLabels(migrateDialSwitchLabelAnchor(backfillSwitchPositions(widget as DialSwitchWidget & LegacyDialSwitchWidget)))
        )
      )
    )
  }

  if (widget.type === 'switch-toggle')
    return migrateToggleSwitchGuardEvent(
      migrateToggleSwitchFireWhileDragging(
        migrateSwitchWidgetPositionChangeEvents(migrateSwitchWidgetTopLevelLabels(backfillSwitchPositions(widget)))
      )
    )

  if (widget.type === 'switch-rocker')
    return migrateRockerSwitchInactiveAction(
      migrateSwitchWidgetPositionChangeEvents(migrateSwitchWidgetTopLevelLabels(backfillSwitchPositions(widget)))
    )

  // Morph/gauge/adjuster/encoder/screen-capture/label/line widgets never
  // existed in any of the legacy shapes below — they're always created with
  // their current shape from the start (morph with states[]/blocks[], the
  // rest with no states[] at all, screen-capture with no labels concept at
  // all, line with no labels/events concept at all). label is the important
  // one to keep out of the block below: its own `label: WidgetLabel`
  // (singular — see LabelWidget's own comment in shared/types.ts for why,
  // deliberately not the flat `labels[]` every other type carries) has
  // nothing to do with the legacy flat-field `label?: string` the block
  // below expects — falling through to it would destructure `label` off as
  // if it were that legacy string, discard it via `...rest`, and leave the
  // widget with no `label` at all.
  if (
    widget.type === 'morph' ||
    widget.type === 'gauge-bar' ||
    widget.type === 'gauge-arc' ||
    widget.type === 'adjuster-slider' ||
    widget.type === 'adjuster-knob' ||
    widget.type === 'encoder' ||
    widget.type === 'screen-capture' ||
    widget.type === 'label' ||
    widget.type === 'line'
  ) {
    return widget
  }

  if (!Array.isArray(widget.labels)) {
    const { label, fontFamily, fontSize, textColor, textOpacity, align, verticalAlign, padding, ...rest } = widget
    widget = {
      ...rest,
      labels: [{ id: randomUUID(), text: label ?? '', fontFamily, fontSize, textColor, textOpacity, align, verticalAlign, padding }]
    }
  }

  if (widget.padding !== undefined) {
    const { padding, ...rest } = widget
    widget = { ...rest, labels: widget.labels!.map((l) => (l.padding === undefined ? { ...l, padding } : l)) }
  }

  // Missing entirely (pre-states-array shape) or emptied out by corruption —
  // widget.states[0] is assumed present everywhere downstream (see
  // ErrorBoundary.tsx), same reasoning as backfillSwitchPositions above.
  if (!Array.isArray(widget.states) || widget.states.length === 0) {
    const { labels, color, borderColor, backgroundOpacity, borderOpacity, ...rest } = widget
    return {
      ...rest,
      statesEnabled: false,
      states: [{ id: randomUUID(), name: 'Default', labels: labels ?? [], color, borderColor, backgroundOpacity, borderOpacity }]
    }
  }

  // The first state's name is fixed as "Default" and the properties panel no
  // longer lets it be renamed — but widgets saved before that restriction
  // existed may still carry an old custom name, which would otherwise be
  // stuck forever since there's no UI path to fix it anymore.
  if (widget.states[0]?.name !== 'Default') {
    widget = { ...widget, states: widget.states!.map((s, i) => (i === 0 ? { ...s, name: 'Default' } : s)) }
  }

  return widget as Widget
}

// Only `electron-vite dev` sets this — it's the one mode where the renderer
// isn't built yet, so we must load it from the Vite dev server instead of
// out/renderer. A production build run via `electron-vite preview` (or a
// packaged installer) has no dev server and app.isPackaged is unreliable for
// telling those apart, so this env var is the only trustworthy signal.
const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const rendererDist = join(__dirname, '../renderer')

// Same fixed name every rebuild, so the desktop always has a stable path to
// serve regardless of which debug/versioned .apk most recently landed here —
// see android/README (or the build step) for what copies the latest build in.
// Kept around for build-android.sh's local-testing loop (a debug build
// dropped here doesn't require cutting a real release to try) — no longer
// what the QR/link in MobileAppModal.tsx points at, see APK_DOWNLOAD_URL.
const APK_PATH = join(__dirname, '../../dist/boarderoni-latest.apk')

// GitHub's "always resolves to whatever release is currently latest"
// redirect — release.yml's release-android job re-uploads a fixed-name copy
// of the APK to every tagged release specifically so this URL never needs
// updating here as new versions ship. Requires that fixed-name upload step
// to keep existing; a plain versioned asset name wouldn't work since this
// URL shape can't wildcard the filename.
const APK_DOWNLOAD_URL = 'https://github.com/spinnekoek/boarderoni/releases/latest/download/boarderoni-latest.apk'

// Used to build the "scan to install" link shown alongside the QR code in
// the desktop editor — window.location.hostname isn't usable there since the
// Electron window itself loads from localhost/devServerUrl, not the LAN
// address a phone would need.
function getLanAddress(): string | null {
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

// Each deck lives in its own directory: decks/<id>/dashboard.json +
// decks/<id>/background-image. Listing decks is a directory scan (see
// listDeckSummaries) rather than a separate manifest file, so there's one
// source of truth on disk.
const decksDir = join(app.getPath('userData'), 'decks')
// Pre-multi-deck layout — a single dashboard.json/background-image pair.
// Migrated into decksDir on first launch after upgrade (see
// migrateLegacyDashboard) and then left in place, untouched, as a harmless
// backup / manual-recovery path.
const legacyDashboardFile = join(app.getPath('userData'), 'dashboard.json')
const legacyBackgroundImageFile = join(app.getPath('userData'), 'background-image')
// Written only after migration fully succeeds — see migrateLegacyDashboard.
const migratedSentinel = join(decksDir, '.migrated')
const windowStateFile = join(app.getPath('userData'), 'window-state.json')

// Deck ids are always server-generated via randomUUID(), but a deck id also
// arrives as client-controlled input (the WS `?deck=` query param, the
// `:id` HTTP route param) before it's ever used to build a filesystem path —
// validate it looks UUID-shaped before any fs call touches it.
const DECK_ID_PATTERN = /^[a-zA-Z0-9-]+$/
function isValidDeckId(id: string): boolean {
  return id.length > 0 && DECK_ID_PATTERN.test(id)
}

function deckDir(deckId: string): string {
  return join(decksDir, deckId)
}
function deckDashboardFile(deckId: string): string {
  return join(deckDir(deckId), 'dashboard.json')
}
function deckBackgroundImageFile(deckId: string): string {
  return join(deckDir(deckId), 'background-image')
}

// Shared "old save -> current shape" normalization — every caller that
// hands a JSON.parse'd (or otherwise untrusted-vintage) Dashboard-shaped
// object to the rest of the app must route it through here first, rather
// than trusting its shape as-is. Three callers: loadDeckDashboard (below),
// migrateLegacyDashboard's one-time file-layout migration, and deck import
// (handleDecksApi) — previously the first two duplicated this inline, which
// meant a new migration step had to be remembered in two places; now it's
// one function all three share.
function normalizeDashboard(loaded: Dashboard & { backgroundImage?: string; eventSources?: Plugin[] }): Dashboard {
  // Migrate off the old shape, which embedded the image as a data URL
  // directly in the dashboard JSON (re-sent over the WebSocket on every
  // single change — see backgroundImageVersion in shared/types.ts).
  delete loaded.backgroundImage
  loaded.widgets = loaded.widgets.map(migrateWidget)
  // Dashboards saved before Variable existed have no `variables` key at
  // all — normalize once here so nothing downstream needs `?? []`.
  loaded.variables = loaded.variables ?? []
  // Dashboards saved before the event-source → plugin rename carry this
  // array under the old `eventSources` key instead of `plugins` — read that
  // instead of silently losing every configured plugin on first load after
  // upgrading. Also renames the old 'ocrRegion' kind (now merged into
  // 'screenCapture' — see shared/plugins/screenCapture.ts) wherever it
  // still appears.
  const rawPlugins = loaded.plugins ?? loaded.eventSources ?? []
  delete loaded.eventSources
  loaded.plugins = rawPlugins.map((p) => (p.kind === 'ocrRegion' ? { ...p, kind: 'screenCapture' } : p))
  // Same normalization for sub-decks, saved before SubDeck existed — and
  // each sub-deck's own widgets need the same migrateWidget treatment the
  // main deck's widgets just got above.
  loaded.subDecks = (loaded.subDecks ?? []).map((sd) => ({ ...sd, widgets: sd.widgets.map(migrateWidget) }))
  // Same normalization again for deck-wide rules, saved before GlobalAction
  // existed — see runGlobalActionPass.
  loaded.globalActions = loaded.globalActions ?? []
  return loaded
}

function loadDeckDashboard(deckId: string): Dashboard | null {
  try {
    const file = deckDashboardFile(deckId)
    if (!existsSync(file)) return null
    const loaded = JSON.parse(readFileSync(file, 'utf-8')) as Dashboard & { backgroundImage?: string }
    return normalizeDashboard(loaded)
  } catch (err) {
    // A single corrupted deck must not take down the picker list or the app —
    // log and treat it as absent rather than throwing.
    console.error(`[boarderoni] failed to load deck ${deckId}, treating as missing`, err)
    return null
  }
}

function saveDeckDashboard(room: DeckRoom): void {
  mkdirSync(deckDir(room.id), { recursive: true })
  const json = JSON.stringify(room.dashboard, null, 2)
  // Recorded BEFORE the write, not after — watchDeckFile compares an
  // incoming fs.watch event's actual file content against this to tell our
  // own save apart from a genuine external edit. Setting it first means even
  // a watch event that fires (on some platforms, watchers can react to a
  // write in progress) mid-write still finds this already in place.
  room.lastWrittenJson = json
  writeFileSync(deckDashboardFile(room.id), json, 'utf-8')
}

const DASHBOARD_SAVE_DEBOUNCE_MS = 500

// Debounced counterpart to saveDeckDashboard — used for saves that repeat on
// a tight cadence (plugin ticks, as often as once a second) rather
// than a one-off user action, so an idle deck with a running clock source
// isn't rewriting dashboard.json to disk every second forever.
function scheduleDebouncedSave(room: DeckRoom): void {
  if (room.dashboardSaveTimeout) clearTimeout(room.dashboardSaveTimeout)
  room.dashboardSaveTimeout = setTimeout(() => {
    room.dashboardSaveTimeout = null
    saveDeckDashboard(room)
  }, DASHBOARD_SAVE_DEBOUNCE_MS)
}

function cancelScheduledSave(room: DeckRoom): void {
  if (room.dashboardSaveTimeout) {
    clearTimeout(room.dashboardSaveTimeout)
    room.dashboardSaveTimeout = null
  }
}

// Runs once, at module load, before anything else touches decksDir. Migrates
// the pre-multi-deck single dashboard.json/background-image (if present)
// into the new decks/<id>/ layout as that user's first deck. A fresh install
// with no legacy file gets zero decks — the picker's own "create" affordance
// is the only entry point, rather than inventing a fake default deck.
function migrateLegacyDashboard(): void {
  if (existsSync(migratedSentinel)) return
  try {
    mkdirSync(decksDir, { recursive: true })
    if (existsSync(legacyDashboardFile)) {
      const loaded = normalizeDashboard(JSON.parse(readFileSync(legacyDashboardFile, 'utf-8')) as Dashboard & { backgroundImage?: string })
      const id = loaded.id || 'default'
      mkdirSync(deckDir(id), { recursive: true })
      writeFileSync(deckDashboardFile(id), JSON.stringify({ ...loaded, id }, null, 2), 'utf-8')
      if (existsSync(legacyBackgroundImageFile)) {
        copyFileSync(legacyBackgroundImageFile, deckBackgroundImageFile(id))
      }
    }
    // Written last, only once the dashboard (and background image, if any)
    // write/copy above have both fully succeeded — using decksDir's mere
    // existence as the guard instead would falsely mark a partially-failed
    // migration (e.g. disk full mid-copy) as complete, silently losing data.
    writeFileSync(migratedSentinel, '', 'utf-8')
  } catch (err) {
    console.error('[boarderoni] failed to migrate legacy dashboard, will retry next launch', err)
  }
}
migrateLegacyDashboard()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let filePath = join(rendererDist, url.pathname === '/' ? 'index.html' : url.pathname)

  if (!existsSync(filePath) || filePath.endsWith('/')) {
    filePath = join(rendererDist, 'index.html')
  }

  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      // Some kiosk-mode WebViews (Fully Kiosk Browser in particular) cache
      // aggressively enough to survive even a full app restart when a
      // server sends no cache directive at all — force every load to
      // revalidate against this exact build rather than risk serving a
      // stale bundle after an update.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache'
    })
    res.end(data)
  })
}

// Dev-only reverse proxy onto Vite. `devServerUrl` is only ever set by
// `electron-vite dev`, so in a packaged build neither of these is reachable
// and serveStatic above answers the same requests from the built bundle
// instead — the whole point being that both modes serve the renderer and
// the API from one origin, so nothing downstream has to branch on which
// mode is running.
function proxyRequestToDevServer(req: IncomingMessage, res: ServerResponse): void {
  const target = new URL(req.url ?? '/', devServerUrl)
  const proxyReq = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      // Rewritten so Vite's own host checks see a request addressed to
      // itself rather than to SERVER_PORT.
      headers: { ...req.headers, host: target.host }
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )
  proxyReq.on('error', (err) => {
    // Normal during startup: the app's own server is listening before Vite
    // has finished booting, so the first request or two can land early.
    console.error('[boarderoni] dev proxy request failed', err)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Vite dev server unreachable')
    }
  })
  req.pipe(proxyReq)
}

// The HMR socket's half of the same proxy. Vite's injected client is
// configured to dial SERVER_PORT (see `hmr.clientPort` in
// electron.vite.config.ts) rather than Vite's own port, so this hands the
// upgrade back to where it was actually going.
function proxyUpgradeToDevServer(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const target = new URL(req.url ?? '/', devServerUrl)
  const proxyReq = httpRequest({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host }
  })
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const headerLines = Object.entries(proxyRes.headers)
      .map(([key, value]) => (Array.isArray(value) ? value.map((v) => `${key}: ${v}\r\n`).join('') : `${key}: ${value}\r\n`))
      .join('')
    socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n${headerLines}\r\n`)
    if (proxyHead.length) proxySocket.unshift(proxyHead)
    proxySocket.on('error', () => socket.destroy())
    proxySocket.pipe(socket).pipe(proxySocket)
  })
  proxyReq.on('error', () => socket.destroy())
  socket.on('error', () => proxyReq.destroy())
  // Bytes the server already read past the request headers — put them back
  // so the pipe set up above picks them up rather than dropping them.
  if (head.length) socket.unshift(head)
  proxyReq.end()
}

function serveBackgroundImage(res: ServerResponse, deckId: string): void {
  const room = getOrLoadRoom(deckId)
  if (!room || !room.dashboard.backgroundImageMime) {
    res.writeHead(404)
    res.end('No background image set')
    return
  }
  const file = deckBackgroundImageFile(room.id)
  if (!existsSync(file)) {
    res.writeHead(404)
    res.end('No background image set')
    return
  }
  readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('No background image set')
      return
    }
    res.writeHead(200, { 'Content-Type': room.dashboard.backgroundImageMime!, 'Cache-Control': 'public, max-age=31536000, immutable' })
    res.end(data)
  })
}

// GET /fonts/:id — unlike /background-image, `id` is server-generated
// (randomUUID, see addCustomFont) rather than a deck id already validated
// elsewhere, so it gets its own DECK_ID_PATTERN-shaped check here before
// touching the filesystem. Immutable long-cache is safe (unlike the
// background image's own versioned cache-busting) because a given id's
// bytes never change after upload — deleting one frees the id rather than
// reusing it for different content.
function serveCustomFont(res: ServerResponse, id: string): void {
  if (!DECK_ID_PATTERN.test(id)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const font = getCustomFonts().find((f) => f.id === id)
  if (!font) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  readFile(customFontFile(id), (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const mime = FONT_MIME_BY_EXTENSION[fontExtension(font.filename)] ?? 'application/octet-stream'
    // Unlike /background-image (a plain <img src>, which browsers load
    // cross-origin with no CORS header needed), a font referenced from
    // @font-face's src: url() is CORS-checked even for a simple GET — every
    // browser refuses to actually use it cross-origin without this, silently
    // falling back to the next font in the stack (Times New Roman, if
    // nothing else matches) instead of erroring loudly. Origin genuinely
    // differs from the page's own in dev (Vite's :5173 vs this server's own
    // SERVER_PORT) — same reasoning `npm run dev` startup output already
    // exists to explain elsewhere. `*` is fine: this is public, unauthenticated
    // font bytes, nothing credentialed being exposed.
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(data)
  })
}

// GET /sounds/:id — same shape and same reasoning as serveCustomFont above
// (id-pattern check before touching disk, immutable long-cache because a
// given id's bytes never change after upload). Needs the CORS header for the
// same reason fonts do: an <audio>/fetch load from the renderer is a genuine
// cross-origin request whenever the page isn't on SERVER_PORT, and these are
// public, unauthenticated audio bytes with nothing credentialed about them.
function serveCustomSound(res: ServerResponse, id: string): void {
  if (!DECK_ID_PATTERN.test(id)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const sound = getCustomSounds().find((s) => s.id === id)
  if (!sound) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  readFile(customSoundFile(id), (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': SOUND_MIME_BY_EXTENSION[soundExtension(sound.filename)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(data)
  })
}

// Patches one widget by id, wherever it lives (main deck or a sub-deck) —
// write-side counterpart to findWidgetAnywhere for handlers (like
// screen-capture:pick-region below) that need to update a widget without
// knowing which deck view owns it. A no-op (dashboard unchanged) if the id
// isn't found anywhere.
function updateWidgetById(dashboard: Dashboard, widgetId: string, update: (widget: Widget) => Widget): Dashboard {
  if (dashboard.widgets.some((w) => w.id === widgetId)) {
    return { ...dashboard, widgets: dashboard.widgets.map((w) => (w.id === widgetId ? update(w) : w)) }
  }
  const subDecks = dashboard.subDecks ?? []
  const ownerIndex = subDecks.findIndex((sd) => sd.widgets.some((w) => w.id === widgetId))
  if (ownerIndex === -1) return dashboard
  return {
    ...dashboard,
    subDecks: subDecks.map((sd, i) => (i === ownerIndex ? { ...sd, widgets: sd.widgets.map((w) => (w.id === widgetId ? update(w) : w)) } : sd))
  }
}

interface StreamableCaptureConfig {
  region: ScreenRegion
  displayId: number
  quality: number
  sharpen: boolean
  fps: number
}

// Shared by both routes below — resolves EITHER a 'screen-capture' widget's
// own user-drawn region/displayId, OR a 'dcs-viewport' widget's LOCKED
// region (resolved server-side from its componentKey against the live
// virtual display — see resolveDcsViewportComponentRegion and
// DcsViewportWidget's own comment in shared/types.ts). Both widget types
// share this one resolver and the same two HTTP routes below it — the
// request is keyed purely by deck+widget id either way, so there's no need
// for a second, parallel set of routes.
function resolveStreamableWidget(room: DeckRoom, widgetId: string): StreamableCaptureConfig | null {
  const widget = findWidgetAnywhere(room.dashboard, widgetId)
  if (!widget) return null
  if (widget.type === 'screen-capture') {
    if (!widget.region || widget.displayId === undefined) return null
    return { region: widget.region, displayId: widget.displayId, quality: clampQuality(widget.quality), sharpen: widget.sharpen ?? false, fps: clampFps(widget.fps) }
  }
  if (widget.type === 'dcs-viewport') {
    const resolved = resolveDcsViewportComponentRegion(widget.componentKey)
    if (!resolved) return null
    return {
      region: applyDcsViewportCrop(resolved.region, widget),
      displayId: resolved.displayId,
      quality: clampQuality(widget.quality),
      sharpen: widget.sharpen ?? false,
      fps: clampFps(widget.fps)
    }
  }
  return null
}

// Per-widget fine-tune on top of resolveComponentRegion's own default bezel
// inset (see its comment) — the exact bezel size varies enough between
// components that a single fixed percentage doesn't fit all of them
// precisely, so this lets each widget trim further. Percentages are of the
// ALREADY-inset region, same edge-relative meaning as CSS padding. Negative
// values expand the region back out past that default inset (e.g. if it
// over-cropped for a particular component); clamped well short of ±100 so
// opposite edges can't cross and invert the region regardless of combination.
function clampCropPercent(value: number | undefined): number {
  return Math.min(49, Math.max(-50, value ?? 0))
}

function applyDcsViewportCrop(region: ScreenRegion, widget: DcsViewportWidget): ScreenRegion {
  const top = clampCropPercent(widget.cropTop)
  const right = clampCropPercent(widget.cropRight)
  const bottom = clampCropPercent(widget.cropBottom)
  const left = clampCropPercent(widget.cropLeft)
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return region
  const insetLeft = Math.round((region.width * left) / 100)
  const insetRight = Math.round((region.width * right) / 100)
  const insetTop = Math.round((region.height * top) / 100)
  const insetBottom = Math.round((region.height * bottom) / 100)
  return {
    x: region.x + insetLeft,
    y: region.y + insetTop,
    width: Math.max(1, region.width - insetLeft - insetRight),
    height: Math.max(1, region.height - insetTop - insetBottom)
  }
}

// Both HTTP capture routes below (and the 'screenCapture' plugin's own OCR
// producer, gated the same way in syncPlugins) share this one on/off switch
// per widget type — see shared/plugins/screenCapture.ts's widgetTypes for
// why a 'screen-capture' widget is gated by the same plugin as its OCR
// sibling. 'dcs-viewport' has no widgetTypes entry (see
// shared/plugins/dcsViewports.ts) since it needs a second condition beyond
// just "plugin enabled" — the virtual display also has to actually be
// ready, or there's nothing valid to stream regardless of the toggle.
function streamableWidgetEnabled(widgetType: 'screen-capture' | 'dcs-viewport'): boolean {
  if (widgetType === 'screen-capture') return getAppSettings().enabledPlugins.includes('screenCapture')
  return getAppSettings().enabledPlugins.includes('dcsViewports') && getDcsViewportsStatus().displayReady
}

function widgetTypeForCaptureRoute(room: DeckRoom, widgetId: string): 'screen-capture' | 'dcs-viewport' | null {
  const widget = findWidgetAnywhere(room.dashboard, widgetId)
  return widget && (widget.type === 'screen-capture' || widget.type === 'dcs-viewport') ? widget.type : null
}

// Poll mode — one capture per request, fully stateless (see
// ScreenCaptureWidget.streamMode in shared/types.ts).
function serveScreenCaptureFrame(res: ServerResponse, deckId: string, widgetId: string): void {
  const room = getOrLoadRoom(deckId)
  const widgetType = room && widgetTypeForCaptureRoute(room, widgetId)
  if (!widgetType || !streamableWidgetEnabled(widgetType)) {
    res.writeHead(403)
    res.end('Capture plugin is disabled')
    return
  }
  const config = room && resolveStreamableWidget(room, widgetId)
  if (!config) {
    res.writeHead(404)
    res.end('No region configured')
    return
  }
  captureRegionJpeg(config.region, config.displayId, config.quality, config.sharpen)
    .then((frame) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
      res.end(frame)
    })
    .catch((err) => {
      console.error(`[boarderoni] screen capture frame failed (widget ${widgetId})`, err)
      res.writeHead(500)
      res.end('Capture failed')
    })
}

// Live mode — multipart/x-mixed-replace, one shared capture loop per
// widget fanned out to every simultaneous viewer (see
// screenCapture.ts's addMjpegViewer).
function serveScreenCaptureStream(res: ServerResponse, deckId: string, widgetId: string): void {
  const room = getOrLoadRoom(deckId)
  const widgetType = room && widgetTypeForCaptureRoute(room, widgetId)
  if (!widgetType || !streamableWidgetEnabled(widgetType)) {
    res.writeHead(403)
    res.end('Capture plugin is disabled')
    return
  }
  const config = room && resolveStreamableWidget(room, widgetId)
  if (!config) {
    res.writeHead(404)
    res.end('No region configured')
    return
  }
  addMjpegViewer(widgetId, res, () => (room ? resolveStreamableWidget(room, widgetId) : null))
}

// dist/boarderoni-latest.apk itself stays a fixed filename (see APK_PATH's
// comment — that's what makes it a stable path to serve) but the
// *downloaded* file shouldn't be, or a phone's download manager just
// silently overwrites the previous one with no way to tell them apart.
// Built from the file's own mtime rather than tracked separately — always
// correct after any rebuild (manual or via build-android.sh) with nothing
// extra to keep in sync.
function apkVersionedFilename(): string {
  const mtime = statSync(APK_PATH).mtime
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${mtime.getFullYear()}${pad(mtime.getMonth() + 1)}${pad(mtime.getDate())}-${pad(mtime.getHours())}${pad(mtime.getMinutes())}`
  return `boarderoni-${stamp}.apk`
}

function serveApk(res: ServerResponse): void {
  if (!existsSync(APK_PATH)) {
    res.writeHead(404)
    res.end('No APK build available')
    return
  }
  readFile(APK_PATH, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('No APK build available')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${apkVersionedFilename()}"`,
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
}

// Exported (type-only) so main/mcp/tools.ts can type its dependency-injected
// functions against this shape — see the McpDeps object built near this
// file's own startMcpServer()/syncMcpServer() call at the bottom, which
// passes bound closures over getOrLoadRoom/applyDashboardUpdate/etc. rather
// than mcp/tools.ts importing them directly (that would create an actual
// runtime circular require: index.ts -> mcp/server.ts -> mcp/tools.ts ->
// index.ts). A `import type` back-reference to this interface has no such
// problem — it's erased entirely at compile time.
export interface DeckRoom {
  id: string
  dashboard: Dashboard
  devices: Map<string, DeviceInfo>
  sockets: Set<WebSocket>
  // Running plugin producers for this room, keyed by Plugin.id.
  // `signature` is `JSON.stringify({kind, config})` of the instance that's
  // currently running — see syncPlugins, which restarts a producer
  // whenever this changes (mappings are excluded on purpose: they're
  // re-read fresh on every tick, so editing them never needs a restart).
  pluginStops: Map<string, { stop: () => void; signature: string }>
  // Debounce handle for saveDeckDashboard — see scheduleDebouncedSave. Event
  // source ticks (as often as once a second) go through this instead of
  // saving synchronously on every tick.
  dashboardSaveTimeout: NodeJS.Timeout | null
  // The exact JSON string this app itself last wrote (or, on first load,
  // read) for this room's dashboard.json — see watchDeckFile, which compares
  // an incoming fs.watch event's actual file content against this to tell
  // apart the app's own save from a genuine external edit.
  lastWrittenJson: string
  // fs.watch handle on this room's dashboard.json — see watchDeckFile. Closed
  // in the deck-delete handler; otherwise lives as long as the room does
  // (rooms are never evicted, see the comment on `rooms` below).
  fileWatcher: FSWatcher | null
  // Each GlobalAction's own condition result as of its last evaluation,
  // keyed by rule id — what a `trigger: 'change'` rule compares against to
  // spot a falsy → truthy edge. Absent means "never evaluated yet", which
  // counts as falsy, so a rule whose condition is already true when the deck
  // loads fires on its first qualifying variable change rather than staying
  // silent forever.
  globalActionConditions: Map<string, boolean>
  // Variable names changed since the last global-action round, and whether
  // any of them came from outside the rule engine itself (a plugin tick, a
  // widget press, an MCP set_variables) rather than from another rule's own
  // steps — see runGlobalActionPass, where the flag is what keeps a
  // `trigger: 'always'` rule firing once per real incoming change instead of
  // once per cascade round.
  pendingGlobalVars: Set<string>
  pendingGlobalExternal: boolean
  // Whether a pass is mid-flight. A pass awaits (delay steps, REST calls),
  // so more variable changes can land while it runs — those join
  // pendingGlobalVars and are picked up by the running pass's next round
  // instead of starting a second, concurrent pass over the same rules.
  globalActionPassRunning: boolean
  // Set while a rule's own steps are executing, so applyVariableUpdates can
  // tell a rule-caused change apart from an external one without every
  // caller having to say which it is. Held across the steps' awaits (delay
  // steps, REST calls), so a genuinely external change landing in that
  // window is counted as rule-caused — the only effect is that an 'always'
  // rule can skip that one round and fire on the next change instead, which
  // isn't worth threading an origin argument through every
  // applyVariableUpdates call site to avoid.
  inGlobalActionRun: boolean
  // In-memory ring buffer mirroring every action:log message this room has
  // broadcast to its edit-role socket (see logAction below) — not persisted,
  // capped at ACTION_LOG_MAX entries, oldest dropped first. Exists so
  // main/mcp/get_action_log has something to read: an MCP tool call is
  // one-shot request/response, with no way to have been listening on the WS
  // broadcast the way the desktop editor's own debug panel is.
  actionLog: { message: string; at: number }[]
}
// Keyed by deck id, lazily populated on first connection/reference (see
// getOrLoadRoom) and never evicted — same always-resident philosophy the old
// single-dashboard code used, just per-deck now.
const rooms = new Map<string, DeckRoom>()

interface SocketContext {
  // '' means the lobby — a view client with no deck chosen yet (see
  // connectLobby in store.ts and the deckParam handling in
  // wss.on('connection')). Never collides with a real deck id: isValidDeckId
  // rejects the empty string, so no room is ever registered under it.
  deckId: string
  deviceId?: string
  // The token this socket presented on its own 'hello' (view role only) —
  // re-verified against the live approved-devices store on every
  // isTrustedSocket check (not cached as a boolean), same "always check
  // current state, never cache trust" posture isDeviceApproved's old
  // per-message re-check already had. Means a device:revoke takes effect
  // on this socket's very next message even without the explicit
  // close-matching-sockets loop device:revoke's handler already does
  // separately.
  deviceToken?: string
  // Captured once from the raw HTTP upgrade request in wss.on('connection')
  // — req isn't available in the ws.on('message') closure otherwise. The
  // ONLY thing role: 'edit' is gated on (see the 'hello' handler below):
  // the desktop editor's own window always connects loopback (packaged
  // build's win.loadFile is file://, dev's win.loadURL is Vite's own
  // http://localhost:5173 — neither ever resolves to a LAN address), so
  // "this connection originated on this machine" is a sufficient (and much
  // simpler) proxy for "this is the desktop, not a claim any LAN device can
  // make" — no credential needed for a fact the OS itself already
  // guarantees.
  remoteAddress?: string
  // Known once the socket's first 'hello' arrives — undefined briefly
  // between raw connect and that first message. Drives both which sockets
  // get a device:approval-requested broadcast and which get gated on
  // approval before receiving dashboard/deck-list content — see
  // isTrustedSocket.
  role?: 'edit' | 'view'
}

// 127.0.0.1/::1 direct, plus the IPv4-mapped-IPv6 form Node's net module
// sometimes reports for a loopback connection (::ffff:127.0.0.1) depending
// on how the socket was dual-stack-negotiated — all three have been
// observed for a same-machine connection in practice, so all three count.
// Deliberately NOT a broader "private range" check (10.x/192.168.x/etc.) —
// those are still a different machine on the LAN, exactly what this exists
// to exclude.
function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

// Gates the four subresource routes an <img src>/@font-face url() actually
// loads (background-image, fonts/:id, screen-capture/frame|stream) —
// unlike /api/decks*, these ARE meant to be reachable by a real approved
// view device (that's the whole point: this is the dashboard content
// itself), so a loopback-only gate would be wrong here. Two valid ways in,
// mirroring the WS protocol's own two trust paths: the desktop editor's own
// window (loopback — same reasoning as role: 'edit', see isLoopbackAddress's
// own callers) needs no token at all, since it's not "a device" in the
// approval sense; a genuinely remote view client supplies `device`/`token`
// query params (an Authorization header isn't an option — none of these
// four are fetch()ed, they're all browser-loaded subresources with no way
// to attach one, see background.ts/customFontFaces.ts/screenCapture.ts's
// own URL builders, which append both unconditionally regardless of mode —
// the editor's own request just has empty/absent values that never matter
// because loopback already grants it access).
function hasDeviceContentAccess(req: IncomingMessage, url: URL): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) return true
  return verifyDeviceToken(url.searchParams.get('device') ?? undefined, url.searchParams.get('token') ?? undefined)
}

function sendForbidden(res: ServerResponse): void {
  res.writeHead(403)
  res.end('Forbidden')
}
// Which room (and, once 'hello' arrives, which device) a given socket
// belongs to — resolved from here on close/message, never from a global map,
// so cleanup always targets the right room even if others have since been
// deleted.
const socketContext = new Map<WebSocket, SocketContext>()

// A device between "sent hello, not approved yet" and "got approved or
// denied" — holds just enough (whatever hello provided) to give
// device:approve something to snapshot a display name from. Cleaned up on
// approval, denial, or the socket closing without either happening.
const pendingDeviceInfo = new Map<string, DeviceInfo>()

function getOrLoadRoom(deckId: string): DeckRoom | null {
  const existing = rooms.get(deckId)
  if (existing) return existing
  if (!isValidDeckId(deckId)) return null
  const dashboard = loadDeckDashboard(deckId)
  if (!dashboard) return null
  // The RAW file content, not JSON.stringify(dashboard, null, 2) — loadDeckDashboard
  // normalizes the parsed object (migrateWidget, defaulting `variables`/
  // `plugins`, etc.), which can differ from what's still literally on
  // disk until the next save. Baselining off the re-serialized normalized
  // object here would make watchDeckFile see that difference as a false
  // "changed externally" the very first time the file watcher fires, even
  // with zero real external edits.
  let lastWrittenJson: string
  try {
    lastWrittenJson = readFileSync(deckDashboardFile(deckId), 'utf-8')
  } catch {
    lastWrittenJson = ''
  }
  const room: DeckRoom = {
    id: deckId,
    dashboard,
    devices: new Map(),
    sockets: new Set(),
    pluginStops: new Map(),
    dashboardSaveTimeout: null,
    lastWrittenJson,
    fileWatcher: null,
    globalActionConditions: new Map(),
    pendingGlobalVars: new Set(),
    pendingGlobalExternal: false,
    globalActionPassRunning: false,
    inGlobalActionRun: false,
    actionLog: []
  }
  rooms.set(deckId, room)
  syncPlugins(room)
  watchDeckFile(room)
  return room
}

function deckExists(deckId: string): boolean {
  return isValidDeckId(deckId) && existsSync(deckDashboardFile(deckId))
}

function listDeckSummaries(): DeckSummary[] {
  let ids: string[]
  try {
    ids = readdirSync(decksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const summaries: DeckSummary[] = []
  for (const id of ids) {
    const dashboard = rooms.get(id)?.dashboard ?? loadDeckDashboard(id)
    if (dashboard) summaries.push({ id, name: dashboard.name })
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name))
  return summaries
}

// Every SequenceStep this widget can fire, from wherever they live on it —
// its own events (press/release/move/etc., only present on interactive
// types — Gauge/Label/ScreenCaptureWidget have none) plus, for the switch
// family, each position's own onSelect, plus RockerSwitchWidget's own
// onInactive (see its own comment in shared/types.ts — not reachable through
// `positions` since it isn't one). Used by collectImportWarnings below to
// find every CallRestAction reachable from a deck, regardless of which
// event/position it's attached to.
function sequenceStepsForWidget(widget: Widget): SequenceStep[] {
  const eventSteps = 'events' in widget && widget.events ? Object.values(widget.events).flat() : []
  const positionSteps = 'positions' in widget && Array.isArray(widget.positions) ? widget.positions.flatMap((p) => p.onSelect ?? []) : []
  const inactiveSteps = widget.type === 'switch-rocker' ? (widget.onInactive ?? []) : []
  return [...eventSteps, ...positionSteps, ...inactiveSteps]
}

// Surfaces the two ways an imported deck can be structurally fine but still
// not work correctly on this machine (see the research behind this
// feature): a CallRestAction pointing at a REST webhook target id that only
// ever existed in the exporting machine's own rest-webhook-targets.json
// (never part of the export — see RestWebhookTarget's own "NOT
// per-Dashboard" comment in shared/types.ts), and a ScreenCaptureWidget's
// region, which is absolute virtual-desktop pixel coordinates tied to the
// exporting machine's own monitor layout. Neither of these crashes anything
// — they just silently do the wrong thing — so this doesn't block the
// import, it just tells the user what to go re-link/re-pick afterward.
// Compares dotted numeric version prefixes only (ignoring any -prerelease
// suffix, e.g. "0.1.0-alpha.1" -> "0.1.0") — good enough to answer "is a
// newer than b" for collectImportWarnings below without pulling in a full
// semver dependency for the one comparison this app needs.
function isVersionNewer(a: string, b: string): boolean {
  const partsA = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const partsB = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i] ?? 0
    const y = partsB[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

function collectImportWarnings(dashboard: Dashboard, exportedAppVersion: string): string[] {
  const targetIds = new Set(getRestWebhookTargets().map((t) => t.id))
  const warnings: string[] = []
  // DeckExportFile.appVersion used to be purely informational — this is the
  // one place it's actually compared against anything. Only flag "newer than
  // this install", not any mismatch: an older export is the common case
  // (most decks predate whatever version is running now) and isn't itself a
  // problem, while a newer one may lean on a feature/default this install
  // doesn't have yet.
  if (isVersionNewer(exportedAppVersion, app.getVersion())) {
    warnings.push(
      `This deck was exported from a newer version of Boarderoni (${exportedAppVersion}) than this install (${app.getVersion()}) — it may use a feature this version doesn't understand yet.`
    )
  }
  for (const widget of allDeckWidgets(dashboard)) {
    for (const step of flattenSequenceSteps(sequenceStepsForWidget(widget))) {
      if (step.kind === 'action' && step.action.kind === 'call-rest' && !targetIds.has(step.action.targetId)) {
        warnings.push(`A ${widget.type} widget references a REST webhook target that doesn't exist on this machine — re-link it after import.`)
      }
    }
    if (widget.type === 'screen-capture' && widget.region) {
      warnings.push('A screen capture widget needs its region re-picked on this machine.')
    }
  }
  return [...new Set(warnings)]
}

// Clears the one field that isn't just "possibly wrong" (like the REST
// plugin ids collectImportWarnings flags above) but actively
// meaningless on a different machine: a ScreenCaptureWidget's region/
// displayId, tied to the exporting machine's own monitor arrangement.
// SendDcsCommandAction is left untouched — it's pure DCS-BIOS protocol
// vocabulary (aircraft/identifier/interface/argument), not tied to any
// path or install on the exporting machine.
function stripMachineSpecificFields(dashboard: Dashboard): Dashboard {
  function stripWidget(widget: Widget): Widget {
    if (widget.type !== 'screen-capture') return widget
    const { region: _region, displayId: _displayId, ...rest } = widget
    return rest as Widget
  }
  return {
    ...dashboard,
    widgets: dashboard.widgets.map(stripWidget),
    subDecks: (dashboard.subDecks ?? []).map((sd) => ({ ...sd, widgets: sd.widgets.map(stripWidget) }))
  }
}

// The picker fetches this from the renderer, which in dev mode is served by
// Vite on its own port (5173/5174), not this one — a genuine cross-origin
// request from Chromium's point of view, unlike the existing WebSocket
// connection or <img>/background-image loads, neither of which are subject
// to CORS. `*` matches this app's existing no-auth, LAN-only posture (the WS
// server already accepts any origin) — this isn't a new relaxation.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  if (status === 204) {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS })
  res.end(JSON.stringify(body))
}

// Every sound id any of this deck's actions references, across widget event
// sequences (including nested ConditionStep branches, which is why this
// recurses rather than scanning a flat list), sub-deck widgets, and global
// actions. Drives what a deck export bundles — see DeckExportFile.sounds.
function collectReferencedSoundIds(dashboard: Dashboard): Set<string> {
  const ids = new Set<string>()

  function walkSteps(steps: SequenceStep[]): void {
    for (const step of steps) {
      if (step.kind === 'action') {
        if (step.action.kind === 'play-sound' && step.action.soundId) ids.add(step.action.soundId)
      } else if (step.kind === 'condition') {
        walkSteps(step.whenTrue)
        walkSteps(step.whenFalse)
      }
    }
  }

  // Every widget kind stores its sequences under `events`, keyed by event
  // name, plus switch/dropdown positions which carry their own. Walked
  // structurally rather than per-widget-type so a new eventful widget type
  // is covered here without a change — a missed one would silently export a
  // deck whose sound is absent on the importing machine.
  function walkWidgetLike(value: unknown): void {
    if (Array.isArray(value)) {
      if (value.every((v) => v && typeof v === 'object' && 'kind' in (v as object))) {
        walkSteps(value as SequenceStep[])
      }
      for (const entry of value) walkWidgetLike(entry)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const entry of Object.values(value as Record<string, unknown>)) walkWidgetLike(entry)
  }

  walkWidgetLike(dashboard.widgets)
  for (const subDeck of dashboard.subDecks ?? []) walkWidgetLike(subDeck.widgets)
  for (const rule of dashboard.globalActions ?? []) walkSteps(rule.steps)
  return ids
}

// Reads each referenced sound's bytes back off disk for the export envelope.
// A sound whose file has gone missing (manifest/disk drift) is skipped
// rather than failing the whole export — the deck still imports, that one
// action just plays nothing, which is the same outcome as referencing a
// since-deleted sound.
function collectDeckSounds(dashboard: Dashboard): DeckExportFile['sounds'] {
  const bundled: NonNullable<DeckExportFile['sounds']> = []
  const library = getCustomSounds()
  for (const id of collectReferencedSoundIds(dashboard)) {
    const sound = library.find((s) => s.id === id)
    if (!sound) continue
    const file = customSoundFile(id)
    if (!existsSync(file)) continue
    bundled.push({
      id: sound.id,
      label: sound.label,
      filename: sound.filename,
      dataBase64: readFileSync(file).toString('base64'),
      ...(sound.startAtMs ? { startAtMs: sound.startAtMs } : {})
    })
  }
  return bundled.length > 0 ? bundled : undefined
}

// Every custom font id any of this deck's labels reference, across the main
// deck and every sub-deck — unlike collectReferencedSoundIds above, a
// label's WidgetLabel.fontFamily is a plain top-level field (not buried in a
// sequence step), so this can walk allDeckWidgets directly instead of
// needing that function's own generic structural recursion.
function collectReferencedFontIds(dashboard: Dashboard): Set<string> {
  const ids = new Set<string>()
  for (const widget of allDeckWidgets(dashboard)) {
    for (const label of (widget as { labels?: { fontFamily?: string }[] }).labels ?? []) {
      if (isCustomFontId(label.fontFamily)) ids.add(customFontIdFromFieldValue(label.fontFamily!))
    }
  }
  return ids
}

// Reads each referenced font's bytes back off disk for the export envelope —
// same "skip a manifest/disk drift instead of failing the whole export"
// reasoning as collectDeckSounds above. See DeckExportFile.fonts' own
// comment for why bundling a font isn't silent the way bundling a sound is.
function collectDeckFonts(dashboard: Dashboard): DeckExportFile['fonts'] {
  const bundled: NonNullable<DeckExportFile['fonts']> = []
  const library = getCustomFonts()
  for (const id of collectReferencedFontIds(dashboard)) {
    const font = library.find((f) => f.id === id)
    if (!font) continue
    const file = customFontFile(id)
    if (!existsSync(file)) continue
    bundled.push({ id: font.id, label: font.label, filename: font.filename, dataBase64: readFileSync(file).toString('base64') })
  }
  return bundled.length > 0 ? bundled : undefined
}

// Loose on purpose — only checks the envelope shape (the magic marker,
// formatVersion, and that `dashboard` at least looks like a Dashboard),
// not every widget's own shape. Widget-level shape evolution is already
// migrateWidget's job (called via normalizeDashboard right after this
// parses), same as it is for a plain dashboard.json — re-validating that
// whole discriminated union here would just duplicate that tolerance, not
// add safety. `.passthrough()` on the dashboard object keeps every field
// this doesn't explicitly name (backgroundColor, subDecks, variables,
// plugins, ...) rather than stripping them.
const deckExportFileSchema = z.object({
  boarderoniExport: z.literal(true),
  formatVersion: z.number(),
  exportedAt: z.number(),
  appVersion: z.string(),
  dashboard: z
    .object({
      id: z.string(),
      name: z.string(),
      widgets: z.array(z.unknown())
    })
    .passthrough(),
  backgroundImage: z.object({ mime: z.string(), dataBase64: z.string() }).optional(),
  // Must be declared, not left to passthrough: z.object() strips undeclared
  // keys, and only `dashboard` above is .passthrough()'d — without this the
  // bundled audio would be silently dropped at import and every Play Sound
  // action in the deck would resolve to nothing.
  sounds: z
    .array(z.object({ id: z.string(), label: z.string(), filename: z.string(), dataBase64: z.string(), startAtMs: z.number().optional() }))
    .optional(),
  // Same "must be declared, not left to passthrough" reasoning as sounds
  // above.
  fonts: z.array(z.object({ id: z.string(), label: z.string(), filename: z.string(), dataBase64: z.string() })).optional()
})

// Creating and renaming a deck are shared by the REST routes the deck picker
// uses and the MCP create_deck/rename_deck tools — extracted so there's one
// definition of what each actually does (including the deck-list broadcast)
// rather than two that can drift.
function createDeck(name: string): DeckSummary {
  const id = randomUUID()
  const dashboard: Dashboard = { ...structuredClone(DEFAULT_DASHBOARD), id, name }
  mkdirSync(deckDir(id), { recursive: true })
  writeFileSync(deckDashboardFile(id), JSON.stringify(dashboard, null, 2), 'utf-8')
  broadcastDeckList()
  return { id, name }
}

// null when the deck doesn't exist. Handles the loaded-room and on-disk-only
// cases separately for the same reason the REST route always has: a loaded
// room's in-memory dashboard is the source of truth while it's live, so
// writing the file underneath it would be overwritten by the next save.
function renameDeck(deckId: string, name: string): DeckSummary | null {
  if (!deckExists(deckId)) return null
  const room = rooms.get(deckId)
  if (room) {
    room.dashboard = { ...room.dashboard, name }
    saveDeckDashboard(room)
    broadcastToRoom(room, dashboardSyncMessage(room.dashboard))
  } else {
    const dashboard = loadDeckDashboard(deckId)
    if (dashboard) {
      dashboard.name = name
      writeFileSync(deckDashboardFile(deckId), JSON.stringify(dashboard, null, 2), 'utf-8')
    }
  }
  broadcastDeckList()
  return { id: deckId, name }
}

async function handleDecksApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const idMatch = /^\/api\/decks\/([^/]+)$/.exec(url.pathname)
  const exportMatch = /^\/api\/decks\/([^/]+)\/export$/.exec(url.pathname)

  if (url.pathname === '/api/decks' && req.method === 'GET') {
    sendJson(res, 200, listDeckSummaries())
    return
  }

  if (url.pathname === '/api/decks' && req.method === 'POST') {
    let name = 'New Deck'
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}')
      if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name.trim()
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }
    sendJson(res, 201, createDeck(name))
    return
  }

  if (exportMatch && req.method === 'POST') {
    const deckId = exportMatch[1]
    if (!deckExists(deckId)) {
      sendJson(res, 404, { error: 'Deck not found' })
      return
    }
    const dashboard = rooms.get(deckId)?.dashboard ?? loadDeckDashboard(deckId)
    if (!dashboard) {
      sendJson(res, 404, { error: 'Deck not found' })
      return
    }
    const bgFile = deckBackgroundImageFile(deckId)
    const backgroundImage =
      dashboard.backgroundImageMime && existsSync(bgFile)
        ? { mime: dashboard.backgroundImageMime, dataBase64: readFileSync(bgFile).toString('base64') }
        : undefined
    const exportFile: DeckExportFile = {
      boarderoniExport: true,
      formatVersion: DECK_EXPORT_FORMAT_VERSION,
      exportedAt: Date.now(),
      appVersion: app.getVersion(),
      dashboard,
      backgroundImage,
      sounds: collectDeckSounds(dashboard),
      fonts: collectDeckFonts(dashboard)
    }
    const result = await dialog.showSaveDialog({
      defaultPath: `${dashboard.name}.boarderoni`,
      filters: [{ name: 'Boarderoni Deck', extensions: ['boarderoni'] }]
    })
    if (result.canceled || !result.filePath) {
      sendJson(res, 200, { canceled: true })
      return
    }
    writeFileSync(result.filePath, JSON.stringify(exportFile, null, 2), 'utf-8')
    // Told back to DeckPicker.tsx so it can show the one-time licensing
    // notice DeckExportFile.fonts' own comment describes — this app can't
    // verify a font's licence, so the honest thing is making the exporter
    // aware rather than silently copying font binaries into a file they're
    // about to hand to someone else.
    sendJson(res, 200, { ok: true, fontCount: exportFile.fonts?.length ?? 0 })
    return
  }

  if (url.pathname === '/api/decks/import' && req.method === 'POST') {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Boarderoni Deck', extensions: ['boarderoni', 'json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      sendJson(res, 200, { canceled: true })
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(result.filePaths[0], 'utf-8'))
    } catch {
      sendJson(res, 400, { error: 'That file is not valid JSON.' })
      return
    }
    const parsed = deckExportFileSchema.safeParse(raw)
    if (!parsed.success) {
      sendJson(res, 400, { error: "That file isn't a Boarderoni deck export." })
      return
    }
    const exportFile = parsed.data as unknown as DeckExportFile
    if (exportFile.formatVersion > DECK_EXPORT_FORMAT_VERSION) {
      sendJson(res, 400, { error: 'This deck was exported from a newer version of Boarderoni and can’t be imported here.' })
      return
    }
    // New id always, regardless of what the export carried — avoids
    // colliding with an existing local deck (including, in the edge case
    // of re-importing your own export, the very deck it came from).
    const id = randomUUID()
    let dashboard = normalizeDashboard({ ...structuredClone(exportFile.dashboard), id })
    dashboard = stripMachineSpecificFields(dashboard)
    mkdirSync(deckDir(id), { recursive: true })
    if (exportFile.backgroundImage) {
      writeFileSync(deckBackgroundImageFile(id), Buffer.from(exportFile.backgroundImage.dataBase64, 'base64'))
      dashboard.backgroundImageMime = exportFile.backgroundImage.mime
      // Never reuse the exported value — it's a cache-buster local to the
      // exporting machine (see Dashboard.backgroundImageVersion's own
      // comment), not meaningful here.
      dashboard.backgroundImageVersion = Date.now()
    } else {
      delete dashboard.backgroundImageMime
      delete dashboard.backgroundImageVersion
    }
    // Ids are preserved (see addCustomSoundWithId) so the imported deck's
    // actions, which reference sounds by id, still resolve — and so
    // re-importing, or importing two decks sharing a sound, doesn't pile up
    // duplicate copies. Registering these makes them visible in the app-wide
    // library too, same as if they'd been uploaded here.
    let importedSounds = 0
    for (const sound of exportFile.sounds ?? []) {
      const dataUrl = `data:${SOUND_MIME_BY_EXTENSION[soundExtension(sound.filename)] ?? 'application/octet-stream'};base64,${sound.dataBase64}`
      if (addCustomSoundWithId(sound.id, dataUrl, sound.label, sound.filename, sound.startAtMs)) importedSounds++
    }
    if (importedSounds > 0) broadcastCustomSounds()
    // Same id-preserving reasoning as sounds above, applied to fonts (see
    // addCustomFontWithId's own comment) — a label's fontFamily references a
    // CustomFont by id, so the id has to survive import for the label to
    // still resolve to the bundled font instead of falling back to default.
    let importedFonts = 0
    for (const font of exportFile.fonts ?? []) {
      const dataUrl = `data:${FONT_MIME_BY_EXTENSION[fontExtension(font.filename)] ?? 'application/octet-stream'};base64,${font.dataBase64}`
      if (addCustomFontWithId(font.id, dataUrl, font.label, font.filename)) importedFonts++
    }
    if (importedFonts > 0) broadcastCustomFonts()
    writeFileSync(deckDashboardFile(id), JSON.stringify(dashboard, null, 2), 'utf-8')
    broadcastDeckList()
    const warnings = collectImportWarnings(dashboard, exportFile.appVersion)
    sendJson(res, 201, { deck: { id, name: dashboard.name } satisfies DeckSummary, warnings })
    return
  }

  if (idMatch && req.method === 'PATCH') {
    const deckId = idMatch[1]
    if (!deckExists(deckId)) {
      sendJson(res, 404, { error: 'Deck not found' })
      return
    }
    let name: string
    try {
      const parsed = JSON.parse(await readBody(req))
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
        sendJson(res, 400, { error: 'name is required' })
        return
      }
      name = parsed.name.trim()
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }
    sendJson(res, 200, renameDeck(deckId, name))
    return
  }

  if (idMatch && req.method === 'DELETE') {
    const deckId = idMatch[1]
    if (!deckExists(deckId)) {
      sendJson(res, 404, { error: 'Deck not found' })
      return
    }
    // Fully synchronous, no `await` between these steps — Node's
    // single-threaded JS execution means no WS message handler can interleave
    // and observe a half-deleted room as long as nothing here yields.
    const room = rooms.get(deckId)
    if (room) {
      for (const socket of room.sockets) socket.close(DECK_CLOSE_CODE_UNKNOWN, 'Deck deleted')
      for (const { stop } of room.pluginStops.values()) stop()
      // Also load-bearing, same reasoning as cancelScheduledSave below — an
      // fs.watch callback firing on the file this delete is about to remove
      // would otherwise try to readFileSync a file that's either gone or
      // (worse) about to be recreated by something else, and either way
      // there's no room left for broadcastToEditClients to notify by the
      // time its debounce timer would fire.
      room.fileWatcher?.close()
      // Load-bearing, not decorative: a pending debounced save from an
      // active plugin firing ~500ms after this point would recreate
      // deckDir(deckId) via saveDeckDashboard's mkdirSync, silently
      // resurrecting the deck's dashboard.json right after this deletes it.
      cancelScheduledSave(room)
      rooms.delete(deckId)
    }
    rmSync(deckDir(deckId), { recursive: true, force: true })
    broadcastDeckList()
    sendJson(res, 204)
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/background-image') {
    if (!hasDeviceContentAccess(req, url)) return sendForbidden(res)
    serveBackgroundImage(res, url.searchParams.get('deck') ?? '')
    return
  }

  if (url.pathname.startsWith('/sounds/')) {
    // Same device-approval gate as /fonts/ below — an unapproved device has
    // no more business pulling a deck's audio than its typefaces.
    if (!hasDeviceContentAccess(req, url)) return sendForbidden(res)
    serveCustomSound(res, url.pathname.slice('/sounds/'.length))
    return
  }

  if (url.pathname.startsWith('/fonts/')) {
    if (!hasDeviceContentAccess(req, url)) return sendForbidden(res)
    serveCustomFont(res, url.pathname.slice('/fonts/'.length))
    return
  }

  if (url.pathname === '/screen-capture/frame') {
    if (!hasDeviceContentAccess(req, url)) return sendForbidden(res)
    serveScreenCaptureFrame(res, url.searchParams.get('deck') ?? '', url.searchParams.get('widget') ?? '')
    return
  }

  if (url.pathname === '/screen-capture/stream') {
    if (!hasDeviceContentAccess(req, url)) return sendForbidden(res)
    serveScreenCaptureStream(res, url.searchParams.get('deck') ?? '', url.searchParams.get('widget') ?? '')
    return
  }

  if (url.pathname === '/download/apk') {
    serveApk(res)
    return
  }

  // The MobileAppModal's QR code needs the LAN address, not window.location
  // (see getLanAddress's comment) — this is that lookup, plus whether a
  // build actually exists to link to, plus the plain browser link (webPort,
  // not SERVER_PORT — same dev-vs-prod distinction as the mDNS TXT record;
  // see MDNS_SERVICE_TYPE's comment in shared/constants.ts).
  if (url.pathname === '/api/apk-info') {
    const lanAddress = getLanAddress()
    sendJson(res, 200, {
      // Always true/non-null now that this points at GitHub rather than a
      // local build that may or may not exist yet — a release with no APK
      // asset published is the one case this doesn't cover, which just
      // surfaces as a 404 if actually followed rather than as available:
      // false here.
      available: true,
      url: APK_DOWNLOAD_URL,
      appUrl: lanAddress ? `http://${lanAddress}:${webPort}/?mode=view` : null,
      // Read by the Android app's probeAndShowFoundPrompt (MainActivity.kt)
      // to show which desktop version it found, alongside its own
      // BuildConfig.VERSION_NAME — this endpoint was already the "always
      // answers regardless of dev/packaged mode" probe target, so it's the
      // natural place to also carry this rather than adding a second route.
      version: app.getVersion()
    })
    return
  }

  // Checked before the devServerUrl guard below, same as /background-image
  // above — otherwise `npm run dev` would swallow every /api/decks* request
  // behind the "WS only in dev mode" placeholder text and the picker could
  // never load anything while developing.
  if (url.pathname === '/api/decks' || url.pathname.startsWith('/api/decks/')) {
    // Chromium preflights the POST/PATCH JSON requests below (their
    // `Content-Type: application/json` isn't CORS-safelisted) — answer it
    // directly rather than routing it into handleDecksApi.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    // Every real caller (DeckPicker.tsx's own fetches — list/create/
    // rename/delete/export/import — and RestDataSourcesSettingsPanel.tsx's
    // deck-picker dropdown) is editor-only UI, which only ever runs inside
    // the desktop's own loopback-loaded window (see remoteAddress's comment
    // on SocketContext for why that's already trusted the same way for the
    // WS role: 'edit' hello) — a deployed 'view' device gets its deck list
    // over the WS protocol instead (decks:list), gated by device approval
    // like everything else it sees. So unlike that WS path, this route
    // needs no separate device-token scheme of its own: nothing legitimate
    // ever calls it from off-box, and several of its actions (export/import
    // in particular) pop native Save/Open dialogs on the desktop's own
    // screen — exactly the kind of thing a random LAN host, or any web page
    // a user has open, shouldn't be able to trigger unauthenticated.
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }
    handleDecksApi(req, res, url).catch((err) => {
      console.error('[boarderoni] /api/decks error', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' })
    })
    return
  }

  // In dev the renderer is Vite's to serve, not ours — forward anything
  // that wasn't one of the app's own routes above to it, so the page and
  // the API share an origin exactly as they do in a packaged build (where
  // serveStatic below answers the same requests from the built bundle).
  // Before this, dev answered these with a "go run npm start instead"
  // placeholder and the renderer was loaded from Vite's port directly,
  // which is what forced the webPort/dev mDNS split and the cross-origin
  // CORS pass on /api/decks.
  if (devServerUrl) {
    proxyRequestToDevServer(req, res)
    return
  }
  serveStatic(req, res)
})

// noServer, not `{ server: httpServer, path: '/ws' }` — with a `path` set,
// ws installs its own 'upgrade' listener that aborts any upgrade for a
// different path with a 400, which would kill Vite's HMR socket before the
// proxy below ever saw it. Routing upgrades by hand instead lets /ws keep
// going to this server while everything else goes to Vite.
const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    return
  }
  if (devServerUrl) {
    proxyUpgradeToDevServer(req, socket, head)
    return
  }
  socket.destroy()
})

// A client that vanishes without a clean TCP close (network drop, app killed
// in the background, WebView torn down) never fires the 'close' event on its
// own, so without this it sits marked "connected" forever — this is the
// standard `ws` heartbeat pattern for reaping those. Terminating still fires
// 'close' below, which is what actually marks the device offline.
type TrackedSocket = WebSocket & { isAlive?: boolean }
const HEARTBEAT_INTERVAL_MS = 30_000

// Single place that constructs a dashboard:sync payload — every broadcast/
// send site below goes through this rather than building the literal
// inline, so generatedAt (see ServerToClient's own comment on this variant)
// is always freshly stamped at the moment this specific snapshot is about
// to go out, not copy-pasted stale from whenever some earlier snapshot was
// built.
function dashboardSyncMessage(dashboard: Dashboard): ServerToClient {
  return { type: 'dashboard:sync', dashboard, generatedAt: Date.now() }
}

function sendInitialState(ws: WebSocket, room: DeckRoom): void {
  ws.send(JSON.stringify(dashboardSyncMessage(room.dashboard)))
  ws.send(JSON.stringify({ type: 'devices:sync', devices: Array.from(room.devices.values()) } satisfies ServerToClient))
  // App-wide, not room-scoped (see broadcastCustomFonts) — sent here too so
  // a client renders any custom-font labels correctly from its very first
  // dashboard:sync instead of a brief flash of fallback font until a later
  // fonts:get.
  ws.send(JSON.stringify({ type: 'fonts:list', fonts: getCustomFonts() } satisfies ServerToClient))
  // Same reasoning again for sounds: a client that receives a sound:play
  // before its first sounds:list would have no filename to build the URL
  // from, so the very first sound of a session would be silently skipped.
  ws.send(JSON.stringify({ type: 'sounds:list', sounds: getCustomSounds() } satisfies ServerToClient))
  // Editor-only (see custom-variants:get's own comment in shared/types.ts) —
  // a deployed view client has no palette to spawn a variant from, so skip
  // sending state it'll never use, unlike fonts:list just above.
  if (socketContext.get(ws)?.role === 'edit') {
    ws.send(JSON.stringify({ type: 'custom-variants:list', variants: getCustomVariants() } satisfies ServerToClient))
  }
  // Also unasked — a deployed view client never opens Settings/Plugins (the
  // only places that otherwise request this), but still needs
  // enabledPlugins to render a disabled-plugin's widget (e.g. Screen
  // Capture) as inert instead of trying to load a feed the server would
  // 403 anyway (see screenCapturePluginEnabled's own callers).
  ws.send(JSON.stringify({ type: 'app-settings:settings', ...getAppSettings() } satisfies ServerToClient))
  ws.send(JSON.stringify({ type: 'dcsbios:status', ...getDcsBiosStatus() } satisfies ServerToClient))
  const stats = getDcsBiosWorkerStats()
  if (stats) ws.send(JSON.stringify({ type: 'dcsbios:stats', ...stats } satisfies ServerToClient))
  // Same reasoning as app-settings just above — a deployed view device (the
  // Android app) never opens the DCS Viewports settings panel, the only
  // other place that requests this, so without this it'd only ever learn
  // the status from a future onDcsViewportsStatusChange broadcast, which by
  // the time it connects may never fire again (status already settled).
  ws.send(JSON.stringify({ type: 'dcsViewports:status', ...getDcsViewportsStatus() } satisfies ServerToClient))
}

// A socket earns the right to approve/deny other devices (and receive
// device:approval-requested in the first place) the same way it earns
// dashboard content: being 'edit', or an already-approved 'view' device. Any
// trusted device can vouch for a new one, not just the desktop.
function isTrustedSocket(ctx: SocketContext): boolean {
  return ctx.role === 'edit' || (ctx.role === 'view' && verifyDeviceToken(ctx.deviceId, ctx.deviceToken))
}

// Pushes the current deck list to every client sitting on the picker, so a
// deck created/renamed/deleted/imported anywhere — the editor's own button,
// a deck import, or an MCP tool — shows up without the client having to
// reconnect. Before this, decks:list was only ever sent once per lobby
// connection (see the hello handler), so a tablet left on the picker went
// stale the moment anything changed.
//
// Lobby connections only (deckId ''): a client already inside a deck isn't
// looking at a picker, and gets its own deck's name changes through
// dashboard:sync instead. Trust-gated for the same reason the hello handler
// gates the initial send — the deck list is content, not public.
function broadcastDeckList(): void {
  const payload = JSON.stringify({ type: 'decks:list', decks: listDeckSummaries() } satisfies ServerToClient)
  for (const [sock, sctx] of socketContext) {
    if (sock.readyState !== WebSocket.OPEN) continue
    if (sctx.deckId !== '') continue
    if (!isTrustedSocket(sctx)) continue
    sock.send(payload)
  }
}

function requestDeviceApproval(device: DeviceInfo): void {
  const payload: ServerToClient = { type: 'device:approval-requested', device }
  for (const [sock, sctx] of socketContext) {
    if (sock.readyState === WebSocket.OPEN && isTrustedSocket(sctx)) sock.send(JSON.stringify(payload))
  }
}

const heartbeat = setInterval(() => {
  for (const client of wss.clients as Set<TrackedSocket>) {
    if (client.isAlive === false) {
      client.terminate()
      continue
    }
    client.isAlive = false
    client.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

wss.on('close', () => clearInterval(heartbeat))

// Per-socket outbound coalescing so a slow connection (weak wifi to a
// tablet, in particular) never builds up a backlog of QUEUED-BUT-UNSENT
// broadcasts behind Node's own socket write buffer. Every message this app
// broadcasts (dashboard:sync, variables:sync, devices:sync, ...) is a full,
// idempotent snapshot rather than a diff/delta — so if two updates of the
// SAME type are both still waiting to go out to one socket, only the newer
// one is worth sending; the older one is pure wasted bandwidth/latency that
// would otherwise force the receiving client to render N stale intermediate
// states before it ever catches up to "now" (this is what made a multi-
// widget drag over slow wifi appear to arrive 30 seconds late — every drag
// tick's full-dashboard broadcast was queued strictly in order, one socket
// buffer's worth of history the client had no way to skip). Keyed by
// message TYPE, not just socket, so e.g. an action:log line broadcast via
// broadcastToEditClients is never silently dropped by a dashboard:sync
// racing ahead of it — only same-type messages ever coalesce.
interface SocketSendQueue {
  sending: boolean
  pending: Map<string, string>
}
const socketSendQueues = new WeakMap<WebSocket, SocketSendQueue>()

function pumpSocketSendQueue(ws: WebSocket, queue: SocketSendQueue): void {
  if (queue.sending) return
  const next = queue.pending.entries().next()
  if (next.done) return
  const [type, payload] = next.value
  queue.pending.delete(type)
  queue.sending = true
  ws.send(payload, () => {
    queue.sending = false
    pumpSocketSendQueue(ws, queue)
  })
}

// Every message type coalesces by plain last-write-wins EXCEPT the ones
// listed here — those aren't full snapshots (see queueSend's own comment),
// so blindly overwriting a still-queued one with a newer one would silently
// lose whatever changed only in the discarded (older) payload. variables:delta
// is the only such type today: merge the two variables arrays by id (newer
// value per id wins, same as the client's own merge in store.ts) instead of
// replacing outright, so a socket backed up across several ticks still ends
// up with the union of every change once it finally drains — the periodic
// variables:sync keyframe (VARIABLES_KEYFRAME_MS) is a backstop for other
// failure modes, not a substitute for this.
const QUEUE_MERGE: Partial<Record<string, (older: string, newer: string) => string>> = {
  'variables:delta': (older, newer) => {
    const a = JSON.parse(older) as { type: 'variables:delta'; variables: Variable[] }
    const b = JSON.parse(newer) as { type: 'variables:delta'; variables: Variable[] }
    const byId = new Map(a.variables.map((v) => [v.id, v]))
    for (const v of b.variables) byId.set(v.id, v)
    return JSON.stringify({ type: 'variables:delta', variables: [...byId.values()] } satisfies ServerToClient)
  }
}

// `type` is the message's own `type` field — the coalescing key. Only ever
// called for messages that are safe to supersede (a full snapshot, not an
// incremental event) — see the callers below — UNLESS `type` has its own
// entry in QUEUE_MERGE, in which case a still-queued payload is merged with
// the new one rather than replaced.
function queueSend(ws: WebSocket, type: string, payload: string): void {
  let queue = socketSendQueues.get(ws)
  if (!queue) {
    queue = { sending: false, pending: new Map() }
    socketSendQueues.set(ws, queue)
  }
  const existing = queue.pending.get(type)
  const merge = QUEUE_MERGE[type]
  queue.pending.set(type, existing && merge ? merge(existing, payload) : payload)
  pumpSocketSendQueue(ws, queue)
}

// room.sockets holds every socket that connected with this deck's id in its
// ?deck= param — including one that's never sent 'hello' at all, or sent
// one that hasn't (or couldn't) verify (see isTrustedSocket). Gating on that
// here, not just at the one-time sendInitialState call, closes a real gap:
// without it, an unapproved socket that merely knows (or brute-forces) a
// valid deck id was still on the receiving end of every ordinary broadcast
// — dashboard:sync, variables:sync/delta, devices:sync, dcsbios:status/
// stats — for as long as it stayed connected, none of which ever checked
// isTrustedSocket the way message handling and sendInitialState already
// did. Confirmed via an external reachability probe (2026-09-18, see
// docs/TODO.md's own note) — a socket whose hello:edit was correctly
// refused kept receiving live variables:sync/dcsbios:stats/time:heartbeat
// broadcasts anyway. Every call site broadcasts exactly the content
// approval exists to gate (grep broadcastToRoom's own callers), so there's
// no legitimate case that needs the old "everyone in room.sockets"
// behavior.
function broadcastToRoom(room: DeckRoom, message: ServerToClient, exclude?: WebSocket): void {
  const payload = JSON.stringify(message)
  for (const client of room.sockets) {
    if (client.readyState !== WebSocket.OPEN || client === exclude) continue
    const ctx = socketContext.get(client)
    if (!ctx || !isTrustedSocket(ctx)) continue
    queueSend(client, message.type, payload)
  }
}

// Same as broadcastToRoom, but only to this room's edit-role sockets (the
// desktop editor(s) currently on this deck) — used for dashboard:external-
// change, which is purely an editor concept a deployed 'view' device has no
// use for and shouldn't be bothered with.
function broadcastToEditClients(room: DeckRoom, message: ServerToClient): void {
  const payload = JSON.stringify(message)
  for (const client of room.sockets) {
    const ctx = socketContext.get(client)
    if (client.readyState === WebSocket.OPEN && ctx?.role === 'edit') {
      queueSend(client, message.type, payload)
    }
  }
}

// Oldest-dropped-first cap on DeckRoom.actionLog — generous enough to cover
// a burst of activity between two MCP get_action_log polls without growing
// unbounded on a long-running room nobody's actively debugging.
const ACTION_LOG_MAX = 200

// The one place an action:log message actually gets sent — mirrors it into
// room.actionLog (see that field's own comment) in addition to the existing
// live WS broadcast, so main/mcp's get_action_log has something to read
// after the fact. Every call site that used to build its own `{type:
// 'action:log', message}` and hand it to broadcastToEditClients directly
// goes through this instead, so the two can't drift apart.
function logAction(room: DeckRoom, message: string): void {
  room.actionLog.push({ message, at: Date.now() })
  if (room.actionLog.length > ACTION_LOG_MAX) room.actionLog.splice(0, room.actionLog.length - ACTION_LOG_MAX)
  broadcastToEditClients(room, { type: 'action:log', message })
}

// How long to wait, after an fs.watch 'change' fires, before actually
// re-reading the file and comparing it — a single external save can trigger
// several rapid-fire 'change' events on some platforms/editors (temp-file-
// then-rename patterns in particular), so this collapses a burst into one
// check instead of racing readFileSync against a write still in progress.
const DECK_FILE_WATCH_DEBOUNCE_MS = 300

// Watches a room's dashboard.json for changes made OUTSIDE this app (a
// hand-edit, a sync tool, a git checkout — anything that isn't
// saveDeckDashboard) while the room is loaded, notifying edit-role clients
// so the desktop editor can offer to reload instead of either silently
// working against a now-stale in-memory copy, or silently clobbering the
// external change on its own next save. fs.watch's 'change' event fires for
// OUR OWN writes too, so a debounce alone can't tell the difference — this
// re-reads the file and compares its actual content against
// room.lastWrittenJson (set by saveDeckDashboard, and seeded from the raw
// file content at load time — see getOrLoadRoom) to be sure before
// notifying anyone. Left running for the room's whole lifetime (rooms are
// never evicted short of deck deletion, which closes this — see the
// idMatch/DELETE handler).
function watchDeckFile(room: DeckRoom): void {
  const file = deckDashboardFile(room.id)
  let debounceTimer: NodeJS.Timeout | null = null
  try {
    room.fileWatcher = watch(file, () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        let content: string
        try {
          content = readFileSync(file, 'utf-8')
        } catch {
          // Deleted/renamed mid-write, or a transient race with some other
          // process — not this feature's concern either way (a real deck
          // deletion is handled by the DELETE route, which closes this
          // watcher itself before the file is gone).
          return
        }
        if (content === room.lastWrittenJson) return
        console.log(`[boarderoni] dashboard.json changed externally for deck ${room.id}, notifying edit clients`)
        broadcastToEditClients(room, { type: 'dashboard:external-change' })
      }, DECK_FILE_WATCH_DEBOUNCE_MS)
    })
  } catch (err) {
    console.error(`[boarderoni] failed to watch deck file for ${room.id}`, err)
  }
}

// This room's currently-open socket for a given device, if any — a device
// can be listed in room.devices (connected: false included) with nothing
// live to sample, e.g. right after it disconnects. Linear scan over
// room.sockets rather than a maintained reverse index: a room's socket count
// is a handful of devices at most, and this only ever runs right before a
// devices:sync broadcast, not on any hot per-message path.
function socketForDevice(room: DeckRoom, deviceId: string): WebSocket | undefined {
  for (const sock of room.sockets) {
    if (socketContext.get(sock)?.deviceId === deviceId) return sock
  }
  return undefined
}

function broadcastDevices(room: DeckRoom): void {
  // bufferedAmount is sampled fresh here rather than stored on DeviceInfo —
  // it's a live property of the socket's current write buffer, not
  // meaningful state to persist alongside customName/connected (see
  // DeviceInfo.bufferedAmount's own comment).
  const devices = Array.from(room.devices.values()).map((device) => ({
    ...device,
    bufferedAmount: socketForDevice(room, device.id)?.bufferedAmount
  }))
  broadcastToRoom(room, { type: 'devices:sync', devices })
}

function keyFromName(name: string): Key {
  const key = (Key as unknown as Record<string, Key>)[name]
  if (key === undefined) {
    throw new Error(`Unknown key name "${name}". See @nut-tree-fork/nut-js Key enum for valid names.`)
  }
  return key
}

// Constrains an update-state action's return value for one variable down to
// VariableValue — anything else (object, array, undefined, ...) becomes its
// string form rather than being rejected outright, since this is meant to
// stay permissive scripting, not a strict schema.
function coerceVariableValue(value: unknown): VariableValue {
  return typeof value === 'number' || typeof value === 'boolean' ? value : String(value)
}

// Merges `updates` ({variableName: newValue}) into the room's
// dashboard.variables — creating new variables for names that don't exist
// yet, same as assigning a new variable in a loose scripting language — then
// broadcasts and saves. `immediate: true` (button clicks, via
// runUpdateState) saves synchronously right away, same as before this was
// extracted; `immediate: false` (plugin ticks, via syncPlugins)
// debounces instead — see scheduleDebouncedSave.
function applyVariableUpdates(room: DeckRoom, updates: Record<string, unknown>, options: { immediate: boolean }): void {
  const existing = room.dashboard.variables ?? []
  const existingByName = new Map(existing.map((v) => [v.name, v]))
  const coercedUpdates = new Map(Object.entries(updates).map(([name, value]) => [name, coerceVariableValue(value)]))

  // Most plugin ticks (a DCS-BIOS field, a REST poll, ...) report the
  // same value again rather than something new — skip rebuilding (and
  // broadcasting/saving) unless at least one value actually differs from
  // what's already there, or every tick would replace `variables` with a
  // new-but-equal array, forcing every connected client to re-render and
  // re-evaluate every fx expression for nothing.
  let hasChange = false
  for (const [name, value] of coercedUpdates) {
    if (existingByName.get(name)?.value !== value) {
      hasChange = true
      break
    }
  }
  if (!hasChange) return

  const variables: Variable[] = existing.map((v) => (coercedUpdates.has(v.name) ? { ...v, value: coercedUpdates.get(v.name)! } : v))
  const changed: Variable[] = []
  for (const [name, value] of coercedUpdates) {
    const existingVar = existingByName.get(name)
    if (existingVar) {
      changed.push({ ...existingVar, value })
    } else {
      const created: Variable = { id: randomUUID(), name, value }
      variables.push(created)
      changed.push(created)
    }
  }

  room.dashboard = { ...room.dashboard, variables }
  // variables:delta, not dashboard:sync or a full variables:sync — this can
  // fire many times a second (every in-flight AdjusterWidget drag tick, or a
  // fast plugin), and widgets/plugins/devices never change here, nor do the
  // hundreds of OTHER variables this tick didn't touch — see
  // variables:delta's own comment in shared/types.ts. The periodic
  // VARIABLES_KEYFRAME_MS interval below is what keeps a client that missed
  // one of these from drifting forever.
  broadcastToRoom(room, { type: 'variables:delta', variables: changed })
  if (options.immediate) {
    cancelScheduledSave(room)
    saveDeckDashboard(room)
  } else {
    scheduleDebouncedSave(room)
  }
  queueGlobalActions(
    room,
    changed.map((v) => v.name)
  )
}

// What an action step's expressions (update-state code, send-dcs-command's
// argumentExpr, call-rest's placeholder exprs) see exposed as variables.
// $value/variables.$index — see evaluateMappingExpression in shared/expr.ts.
// Two distinct origins feed this: an in-flight AdjusterWidget drag/Encoder
// turn passes its own numeric value with no index (see numericTrigger
// below); a SwitchPosition/DropdownWidget position select passes that
// position's own name as $value alongside its index as $index, so one
// onSelect sequence shared/copy-pasted across positions can still tell
// which one actually fired it (see triggerAction below). RockerSwitchWidget's
// settleToInactive pseudo-position (see its own comment on
// RockerSwitchWidget.onInactive in shared/types.ts) is the one exception:
// it's not a real positions[] entry, so it passes the fixed string
// 'Inactive' as $value and -1 (never a real array index) as $index instead.
interface TriggerValue {
  value: VariableValue
  index?: number
}

// Wraps a plain numeric trigger value (an Adjuster drag tick, an Encoder
// turn) into TriggerValue — undefined stays undefined (a plain button/morph
// click has no value at all), everything else becomes $value with no
// $index, same as before TriggerValue existed.
function numericTrigger(value: number | undefined): TriggerValue | undefined {
  return value !== undefined ? { value } : undefined
}

// Routes an action expression's console.log calls (see
// stringifyExpressionLogArgs/setExpressionConsoleSink) to whichever room
// triggered it, as an action:log — the sink itself is a bare (args) => void
// with no room context, and these expressions run here in the main process,
// never the editor's own renderer, so without this the desktop editor's
// debug panel could never show them (see ServerToClient's own comment on
// action:log). Only ever set for the duration of one synchronous eval call —
// never left dangling across an `await` — since multiple rooms/devices can
// be firing actions concurrently and there's no queue here, just this one
// slot.
let logRoom: DeckRoom | null = null

function withLogRoom<T>(room: DeckRoom, evaluate: () => T): T {
  logRoom = room
  try {
    return evaluate()
  } finally {
    logRoom = null
  }
}

setExpressionConsoleSink((args) => {
  if (!logRoom) return
  logAction(logRoom, stringifyExpressionLogArgs(args))
})

// Evaluates an update-state action's code and merges whatever it returns
// into the room's dashboard.variables. Runs server-side (not per-client) so
// every client's next dashboard:sync already reflects the result, same as
// any other mutation.
function runUpdateState(room: DeckRoom, code: string, trigger: TriggerValue | undefined, final: boolean): void {
  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  // trigger is only set while an AdjusterWidget is being dragged, or for a
  // switch/dropdown position select — exposed as variables.$value (plus
  // variables.$index for a position select), same convention an
  // PluginMapping's own `expr` already uses (see
  // evaluateMappingExpression). A plain button/morph click
  // has no value, so it evaluates exactly as before.
  const result = withLogRoom(room, () =>
    trigger ? evaluateMappingExpression(code, trigger.value, variableMap, trigger.index) : tryEvaluateExpression(code, variableMap)
  )
  // A genuine failure (syntax error, thrown exception, ...) surfaces to the
  // caller — triggerAction's catch turns it into an action:error the client
  // shows on the widget. Code that just doesn't return anything (empty body,
  // no update intended) is a normal no-op, not an error.
  if (!result.ok) throw new Error(result.error)
  if (!result.value || typeof result.value !== 'object') return
  // final=false (an in-flight AdjusterWidget drag tick) debounces the disk
  // save instead of writing synchronously — see ClientToServer's own comment
  // on 'action:trigger'.final. A plain click has no `value` at all, and
  // always passes final=true.
  applyVariableUpdates(room, result.value as Record<string, unknown>, { immediate: final })
}

// A ConditionStep's own condition expression — same evaluation mechanism as
// runUpdateState above (toVariableMap/withLogRoom/evaluateMappingExpression
// or tryEvaluateExpression, same trigger-aware $value/$index exposure), just
// coerced to boolean instead of expecting an object back. Deliberately NOT
// resolveBooleanExpr (shared/expr.ts) — that swallows a failing expression
// into `undefined` for rendering-fallback callers; a condition step's
// failure needs to throw, so runSteps' catch below turns it into an
// action:error the same way any other step kind's failure already does.
function evaluateConditionStep(room: DeckRoom, step: ConditionStep, trigger: TriggerValue | undefined): boolean {
  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  const result = withLogRoom(room, () =>
    trigger ? evaluateMappingExpression(step.condition, trigger.value, variableMap, trigger.index) : tryEvaluateExpression(step.condition, variableMap)
  )
  if (!result.ok) throw new Error(result.error)
  return Boolean(result.value)
}

// argumentExpr (when set) is evaluated the same way UpdateStateAction.code
// is — variables (plus $value while an AdjusterWidget is being dragged, see
// runUpdateState) in scope, thrown/syntax errors surface to the caller as an
// action:error — except the returned value becomes the literal argument
// string sent, not a variables patch. No aircraft-matching is needed here
// (unlike reading): DCS-BIOS just applies whatever identifier/argument pair
// arrives to the currently active aircraft, silently ignoring it if that
// identifier doesn't exist for that aircraft.
async function runSendDcsCommand(room: DeckRoom, action: SendDcsCommandAction, trigger?: TriggerValue): Promise<void> {
  // Same enabledPlugins gate syncPlugins already applies to the
  // read side (see its own comment) — disabling DCS-BIOS in Settings should
  // stop a button from firing commands too, not just stop reading fields.
  if (!getAppSettings().enabledPlugins.includes('dcsbios')) {
    throw new Error('DCS-BIOS is disabled in Settings')
  }

  let argument = action.argument
  // The plain Value field's own $value shorthand (see the constant's doc
  // comment) — only kicks in when argumentExpr isn't already set, same
  // precedence the UI itself enforces (SendDcsCommandActionEditor only shows
  // one or the other, never both).
  const argumentExpr =
    action.argumentExpr && action.argumentExpr.trim()
      ? action.argumentExpr
      : action.argument.trim() === DCS_COMMAND_VALUE_SHORTHAND
        ? `return variables.${DCS_COMMAND_VALUE_SHORTHAND};`
        : undefined
  if (argumentExpr) {
    const variableMap = toVariableMap(room.dashboard.variables ?? [])
    const result = withLogRoom(room, () =>
      trigger ? evaluateMappingExpression(argumentExpr, trigger.value, variableMap, trigger.index) : tryEvaluateExpression(argumentExpr, variableMap)
    )
    if (!result.ok) throw new Error(result.error)
    argument = String(result.value)
  }
  await sendDcsBiosCommand(action.identifier, argument)
}

// Same enabledPlugins gate / $value-shorthand precedence as
// runSendDcsCommand above, just against the windows-audio worker instead of
// DCS-BIOS. volume and muteAction are independent — either, both, or
// neither can be set on one action (undefined muteAction means "don't
// touch mute"). action.appName set means "target this app's own session"
// instead of a device — see SetWindowsAudioAction's own comment in
// shared/types.ts; the two modes are otherwise identical, just resolved
// against a different target function/label here.
async function runSetWindowsAudioAction(room: DeckRoom, action: SetWindowsAudioAction, trigger?: TriggerValue): Promise<void> {
  if (!getAppSettings().enabledPlugins.includes('windowsAudio')) {
    throw new Error('Windows Audio is disabled in Settings')
  }

  const isSession = action.appName !== undefined
  const targetLabel = isSession ? `application "${action.appName}"` : `device "${action.deviceName || 'default'}"`
  const setVolume = isSession ? (percent: number) => setWindowsAudioSessionVolume(action.appName!, percent) : (percent: number) => setWindowsAudioVolume(action.deviceName, percent)
  const setMute = isSession ? (muted: boolean) => setWindowsAudioSessionMute(action.appName!, muted) : (muted: boolean) => setWindowsAudioMute(action.deviceName, muted)
  const getSnapshot = isSession ? () => getWindowsAudioSessionSnapshot(action.appName!) : () => getWindowsAudioSnapshot(action.deviceName)

  if (action.volume !== undefined || action.volumeExpr) {
    let volume = action.volume ?? ''
    const volumeExpr =
      action.volumeExpr && action.volumeExpr.trim()
        ? action.volumeExpr
        : volume.trim() === DCS_COMMAND_VALUE_SHORTHAND
          ? `return variables.${DCS_COMMAND_VALUE_SHORTHAND};`
          : undefined
    if (volumeExpr) {
      const variableMap = toVariableMap(room.dashboard.variables ?? [])
      const result = withLogRoom(room, () =>
        trigger ? evaluateMappingExpression(volumeExpr, trigger.value, variableMap, trigger.index) : tryEvaluateExpression(volumeExpr, variableMap)
      )
      if (!result.ok) throw new Error(result.error)
      volume = String(result.value)
    }
    const percent = Number(volume)
    if (!Number.isFinite(percent)) throw new Error(`Windows Audio: "${volume}" isn't a number`)
    await setVolume(percent)
  }

  if (action.muteAction === 'mute' || action.muteAction === 'unmute') {
    await setMute(action.muteAction === 'mute')
  } else if (action.muteAction === 'toggle') {
    // toggle needs the CURRENT mute state first — the one extra round trip
    // this costs only happens for 'toggle', not the far more common
    // explicit mute/unmute above.
    const current = await getSnapshot()
    if (!current) throw new Error(`Windows Audio: ${targetLabel} not found`)
    await setMute(!current.muted)
  }
}

// Posts/sends a CallRestAction's target RestWebhookTarget's request — same
// variables-in-scope/$value-while-dragging convention as runSendDcsCommand
// above, just resolving N named placeholders instead of one argument. Uses
// the runtime's global fetch — this app's first outbound HTTP request
// anywhere; everything else here only ever serves requests.
// Every failure path here used to only ever reach the triggering client, as
// an action:error toast on the widget that fired it (see runSequence's own
// catch) — nothing reached the console or the debug panel, unlike an
// UpdateStateAction/ConditionStep's own expression failures, which already
// go through withLogRoom. A bad target, a non-2xx response, or even a raw
// network exception (no try/catch existed around the fetch call itself)
// were all silent from the desktop editor's point of view. The try/catch
// below logs whatever failed via logAction before rethrowing unchanged, so
// existing action:error behavior is untouched — this only adds visibility,
// via both the live debug panel and (see DeckRoom.actionLog) MCP's
// get_action_log, it doesn't change what happens on success or how a
// failure is reported to the client that triggered it.
async function runCallRestAction(room: DeckRoom, action: CallRestAction, trigger?: TriggerValue): Promise<void> {
  const target = getRestWebhookTargets().find((t) => t.id === action.targetId)
  if (!target || !target.enabled) {
    const message = 'This REST webhook target is disabled or no longer exists'
    logAction(room, `[Call REST] ${message}`)
    throw new Error(message)
  }
  try {
    await runCallRestActionUnlogged(room, target, action, trigger)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logAction(room, `[Call REST: ${target.name}] ${message}`)
    throw err
  }
}

async function runCallRestActionUnlogged(room: DeckRoom, target: RestWebhookTarget, action: CallRestAction, trigger?: TriggerValue): Promise<void> {
  // Resolved once across every {{name}} token found in EITHER the body or
  // any header value (see extractAllPlaceholders) — a header and the body
  // referencing the same placeholder (e.g. a computed signature used in
  // both) get the identical resolved value, and an expr with a visible
  // side effect (a console.log) only runs once, not once per place it's
  // substituted into.
  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  const resolvedByName = new Map<string, unknown>()
  for (const name of extractAllPlaceholders([target.payloadTemplate, ...target.headers.map((h) => h.value)])) {
    const entry = action.values.find((v) => v.placeholder === name)
    let resolved: unknown = null
    const expr = entry?.expr
    if (expr && expr.trim()) {
      const result = withLogRoom(room, () =>
        trigger ? evaluateMappingExpression(expr, trigger.value, variableMap, trigger.index) : tryEvaluateExpression(expr, variableMap)
      )
      if (!result.ok) throw new Error(result.error)
      resolved = result.value
    } else if (entry?.value !== undefined) {
      resolved = entry.value
    }
    resolvedByName.set(name, resolved)
  }

  // Plain string substitution, full stop — the author writes the literal
  // template exactly as it should look (quotes and all), and each
  // {{name}} token is replaced with the plain string form of whatever it
  // resolved to. No JSON-awareness, no validation: a malformed result is
  // on whoever configured the template, not something to guess-fix or
  // reject here (same as a header value already worked).
  function substitute(text: string): string {
    let out = text
    for (const [name, resolved] of resolvedByName) out = out.replaceAll(`{{${name}}}`, String(resolved))
    return out
  }

  const headers: Record<string, string> = {}
  const hasBody = target.method !== 'GET'
  if (hasBody) headers['Content-Type'] = 'application/json'
  for (const header of target.headers) {
    if (header.key.trim()) headers[header.key] = substitute(header.value)
  }

  const body = hasBody ? substitute(target.payloadTemplate) : undefined

  // Node's global fetch (undici) has no per-request `rejectUnauthorized:
  // false` the way some other HTTP clients do — a custom dispatcher built
  // with a permissive `connect` option is the only way to skip TLS
  // verification for just THIS target's own requests, instead of the blunt,
  // process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0` env var (see
  // RestWebhookTarget.allowInvalidCertificates's own comment). Built fresh
  // per call rather than cached on the target — this is a debug/internal-
  // device escape hatch, not a hot path worth pooling connections for.
  const dispatcher = target.allowInvalidCertificates ? new UndiciAgent({ connect: { rejectUnauthorized: false } }) : undefined
  const res = await fetch(target.url, { method: target.method, headers, body, ...(dispatcher && { dispatcher }) })
  if (!res.ok) throw new Error(`REST call failed: ${res.status} ${res.statusText}`)
}

// The `emit` callback passed to syncRestIncomingServers (see
// main/restIncoming.ts) — turns one incoming REST request's already-
// flattened body into variable updates on its source's configured target
// deck. Mirrors syncPlugins' own per-tick mapping loop almost exactly,
// just triggered by a request instead of a producer tick, and against a
// single source instead of every currently-loaded room's instances.
function applyRestIncoming(sourceId: string, flattened: Record<string, unknown>): void {
  const source = getRestDataSources().find((s) => s.id === sourceId)
  if (!source) return
  const room = getOrLoadRoom(source.targetDeckId)
  if (!room) return

  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  const updates: Record<string, unknown> = {}
  for (const mapping of source.mappings) {
    if (!(mapping.field in flattened)) continue
    const rawValue = flattened[mapping.field]
    if (mapping.expr && mapping.expr.trim()) {
      const result = withLogRoom(room, () => evaluateMappingExpression(mapping.expr!, coerceVariableValue(rawValue), variableMap))
      if (!result.ok) {
        console.error(`[boarderoni] REST incoming mapping expression failed (${source.name} -> ${mapping.variableName})`, result.error)
        continue
      }
      // Same convention as runUpdateState: an expression that returns a
      // plain object sets whichever variables it names (not just this
      // mapping's own variableName), letting one mapping's expr also patch
      // other variables in the same room — a scalar return still targets
      // just mapping.variableName, same as before this was possible.
      if (result.value && typeof result.value === 'object' && !Array.isArray(result.value)) {
        Object.assign(updates, result.value as Record<string, unknown>)
      } else if (mapping.variableName.trim()) {
        updates[mapping.variableName] = result.value
      }
    } else if (mapping.variableName.trim()) {
      updates[mapping.variableName] = rawValue
    }
  }
  if (Object.keys(updates).length > 0) applyVariableUpdates(room, updates, { immediate: false })
}

// Reply to rest-sources:get, and the payload broadcast to every edit-role
// socket after a rest-sources:create/update/regenerate-token/delete — same
// "full current list either way" reasoning as device:approved-list.
function restSourcesPayload(): ServerToClient {
  const sources = getRestDataSources().map((s) => ({ ...s, ...getRestListenStatus(s.id) }))
  return { type: 'rest-sources:list', sources, lanAddress: getLanAddress() }
}

function broadcastRestSources(): void {
  const payload = JSON.stringify(restSourcesPayload())
  for (const [sock, sctx] of socketContext) {
    if (sctx.role === 'edit' && sock.readyState === WebSocket.OPEN) sock.send(payload)
  }
}

// Same "full current list either way" shape as restSourcesPayload/
// broadcastRestSources above, for the separate outgoing-only webhook-target
// list — no listening status to merge in since a target has no listener.
function restWebhookTargetsPayload(): ServerToClient {
  return { type: 'rest-webhook-targets:list', targets: getRestWebhookTargets() }
}

function broadcastRestWebhookTargets(): void {
  const payload = JSON.stringify(restWebhookTargetsPayload())
  for (const [sock, sctx] of socketContext) {
    if (sctx.role === 'edit' && sock.readyState === WebSocket.OPEN) sock.send(payload)
  }
}

// Role-gated same as broadcastRestSources, not broadcastCustomFonts below —
// see custom-variants:get's own comment in shared/types.ts for why a
// deployed view client never needs this.
function broadcastCustomVariants(): void {
  const payload = JSON.stringify({ type: 'custom-variants:list', variants: getCustomVariants() } satisfies ServerToClient)
  for (const [sock, sctx] of socketContext) {
    if (sctx.role === 'edit' && sock.readyState === WebSocket.OPEN) sock.send(payload)
  }
}

// Unlike broadcastRestSources, not role-gated — 'view' clients render
// labels too, and one might already be showing a dashboard that uses a
// custom font uploaded (or removed) mid-session, not just the desktop
// editor that manages the library. See fonts:list's own comment in
// shared/types.ts.
function broadcastCustomFonts(): void {
  const payload = JSON.stringify({ type: 'fonts:list', fonts: getCustomFonts() } satisfies ServerToClient)
  for (const [sock] of socketContext) {
    if (sock.readyState === WebSocket.OPEN) sock.send(payload)
  }
}

// Same not-role-gated reasoning as broadcastCustomFonts above: a 'view'
// client is one of the things that actually plays a sound, so it needs the
// library too, not just the editor that manages it.
function broadcastCustomSounds(): void {
  const payload = JSON.stringify({ type: 'sounds:list', sounds: getCustomSounds() } satisfies ServerToClient)
  for (const [sock] of socketContext) {
    if (sock.readyState === WebSocket.OPEN) sock.send(payload)
  }
}

// A PlaySoundAction's 'server' target — "the machine running Boarderoni",
// which in practice means the desktop editor window's own renderer, the only
// place in this process tree with an audio output.
//
// Addressed by role across EVERY socket rather than via broadcastToEditClients
// (which is per-room): the editor window might be sitting on a different deck
// than the one whose action just fired (or on the deck picker), and "play a
// sound on the PC" shouldn't depend on which deck happens to be open there.
//
// Sent raw rather than through queueSend because that coalesces by message
// type — two sounds fired in quick succession would collapse into one, and a
// dropped sound effect is exactly the bug this would produce.
function sendSoundToDesktop(message: ServerToClient): void {
  const payload = JSON.stringify(message)
  for (const [sock, ctx] of socketContext) {
    if (ctx.role === 'edit' && sock.readyState === WebSocket.OPEN) sock.send(payload)
  }
}

function pluginSignature(source: Plugin): string {
  return JSON.stringify({ kind: source.kind, config: source.config ?? null })
}

// Starts/stops per-room plugin producers to match
// room.dashboard.plugins, and wires each running producer's emitted
// field values through its instance's mappings into variables. Called
// whenever room.dashboard might have gained/lost/changed an event source —
// see call sites at getOrLoadRoom and the 'dashboard:update' handler below.
// Diffed by id + a signature of {kind, config} (not just id) so a future
// kind's config change (e.g. a webhook's path) also restarts its producer —
// mappings are deliberately excluded from the signature since the emit
// closure below re-reads them fresh off room.dashboard on every tick, so
// editing a mapping never needs a restart.
function syncPlugins(room: DeckRoom): void {
  const instances = room.dashboard.plugins ?? []
  const instanceIds = new Set(instances.map((s) => s.id))

  for (const [id, running] of room.pluginStops) {
    if (!instanceIds.has(id)) {
      running.stop()
      room.pluginStops.delete(id)
    }
  }

  for (const instance of instances) {
    const signature = pluginSignature(instance)
    const running = room.pluginStops.get(instance.id)
    if (running && running.signature === signature) continue
    running?.stop()

    const producer = PLUGIN_PRODUCERS[instance.kind]
    if (!producer) continue
    // Disabling a kind in PluginsModal (see appSettings.ts) stops its
    // producer entirely rather than just hiding it from EventSourcesModal's
    // add-picker — this is what actually frees a high-intensity kind's
    // underlying worker thread when nobody wants it running. The source's
    // own configuration is untouched, so re-enabling resumes it as-is.
    if (!getAppSettings().enabledPlugins.includes(instance.kind)) continue

    // Per-field values from this instance's previous tick, captured by this
    // closure (not stored on the pluginStops entry — that's only set
    // below, after producer.start's own synchronous first tick has already
    // run once). Starts empty, so every field looks "changed" on the very
    // first tick — that's what seeds each mapping's variable with a real
    // value immediately instead of waiting for the field to actually change.
    let previousValues: Record<string, unknown> = {}

    const stop = producer.start(instance, (values) => {
      // A tick runs on a setInterval with nothing else on the call stack —
      // unlike a button click (always inside triggerAction's own
      // try/catch), an uncaught exception here becomes a Node
      // uncaughtException and can take down the whole Electron main
      // process, so the entire body is guarded.
      let current: Plugin | undefined
      try {
        current = room.dashboard.plugins?.find((s) => s.id === instance.id)
        if (!current) return
        const variableMap = toVariableMap(room.dashboard.variables ?? [])
        const updates: Record<string, unknown> = {}
        for (const mapping of current.mappings) {
          if (!(mapping.field in values)) continue
          const rawValue = values[mapping.field]
          // Skip a mapping whose underlying field is unchanged since the
          // last tick — an expression is only re-run when there's an
          // actual new raw value to feed it, not on every tick regardless.
          if (rawValue === previousValues[mapping.field]) continue
          if (mapping.expr && mapping.expr.trim()) {
            const result = withLogRoom(room, () => evaluateMappingExpression(mapping.expr!, coerceVariableValue(rawValue), variableMap))
            if (!result.ok) {
              console.error(`[boarderoni] plugin mapping expression failed (${current.name} -> ${mapping.variableName})`, result.error)
              continue
            }
            // Same convention as runUpdateState: an object return patches
            // whichever variables it names, not just this mapping's own
            // variableName — a scalar return still targets just that one,
            // same as before this was possible.
            if (result.value && typeof result.value === 'object' && !Array.isArray(result.value)) {
              Object.assign(updates, result.value as Record<string, unknown>)
            } else if (mapping.variableName.trim()) {
              updates[mapping.variableName] = result.value
            }
          } else if (mapping.variableName.trim()) {
            updates[mapping.variableName] = rawValue
          }
        }
        previousValues = values
        if (Object.keys(updates).length > 0) applyVariableUpdates(room, updates, { immediate: false })
      } catch (err) {
        console.error(`[boarderoni] plugin tick failed (${current?.name ?? instance.id})`, err)
      }
    })
    room.pluginStops.set(instance.id, { stop, signature })
  }
}

// Re-evaluates every currently-loaded room's plugins against the
// latest enabledPlugins gate — called after an app-settings:update so
// toggling a kind off/on in the Settings page takes effect immediately,
// not just on the next unrelated dashboard:update.
function resyncAllRoomsPlugins(): void {
  for (const room of rooms.values()) syncPlugins(room)
}

// Replaces room.dashboard wholesale, saves (sync or debounced per `final`,
// same split applyVariableUpdates uses), broadcasts the result, and
// restarts any plugin whose {kind, config} changed — exactly what the
// 'dashboard:update' WS case below did inline before this was extracted.
// This is now the ONE path both a real WS dashboard:update AND every MCP
// widget/event-source mutation tool go through (see main/mcp/tools.ts) —
// widget and event-source CRUD both work by reading room.dashboard,
// splicing/patching the target array (widgets, or plugins — an event
// source), and calling this, same as a real client would round-trip a
// whole edited Dashboard back today. `excludeSocket` mirrors
// broadcastToRoom's own param — omitted (MCP calls) means every connected
// client gets the update, including any editor window watching this deck.
function applyDashboardUpdate(room: DeckRoom, dashboard: Dashboard, final: boolean, excludeSocket?: WebSocket): void {
  room.dashboard = dashboard
  if (final) {
    cancelScheduledSave(room)
    saveDeckDashboard(room)
  } else {
    scheduleDebouncedSave(room)
  }
  broadcastToRoom(room, dashboardSyncMessage(room.dashboard), excludeSocket)
  syncPlugins(room)
}

// Merges `patch` into AppSettings and re-syncs every app-wide, kind-gated
// listener against the result — exactly what the 'app-settings:update' WS
// case below did inline before this was extracted, now also called by the
// MCP set_enabled_plugins tool (see main/mcp/tools.ts) so toggling a kind
// on/off from an MCP client takes effect immediately, same as from the
// Settings UI. The dcsViewports false->true edge-refresh is deliberately
// folded in here too (not left WS-only) so both callers get the same
// real-world side effect from enabling that kind, not just the ones
// re-synced by resyncAllRoomsPlugins/syncRestIncomingServers.
async function applyAppSettingsPatch(patch: Partial<AppSettings>): Promise<AppSettings> {
  const wasDcsViewportsEnabled = getAppSettings().enabledPlugins.includes('dcsViewports')
  const settings = updateAppSettings(patch)
  resyncAllRoomsPlugins()
  syncRestIncomingServers(applyRestIncoming)
  syncMcpServer(mcpDeps)
  const isDcsViewportsEnabled = settings.enabledPlugins.includes('dcsViewports')
  if (isDcsViewportsEnabled && !wasDcsViewportsEnabled) {
    try {
      await refreshDcsViewportsStatus()
    } catch (err) {
      console.error('[boarderoni] dcsViewports enable-time refresh failed', err)
    }
  }
  return settings
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// mode 'down'/'up' press or release only, with no automatic pairing —
// pairing a 'down' step with a later 'up' step (typically with a DelayStep
// between them) is how a held-key sequence is built, via the same generic
// SequenceStep mechanism as any other multi-step action.
async function runKeypressAction(action: KeypressAction): Promise<void> {
  const keys = action.keys.map(keyFromName)
  const mode = action.mode ?? 'press'
  // Pressed/released one key at a time (not keyboard.pressKey(...keys) as a
  // single call) because nut-js's multi-key form treats every key but the
  // last as a "modifier flag" string, and libnut-core's native CheckKeyFlags
  // collapses right_alt/right_control/right_shift into the same flag as
  // their left-hand counterparts (always emits VK_LMENU/VK_LCONTROL/
  // VK_LSHIFT) — so RightAlt+Home silently sent LeftAlt+Home instead.
  // Toggling each key individually always uses the literal key-lookup path,
  // which maps right-side keys correctly.
  if (mode !== 'up') for (const key of keys) await keyboard.pressKey(key)
  if (mode !== 'down') for (const key of [...keys].reverse()) await keyboard.releaseKey(key)
}

// A navigate-subdeck/open-overlay action naming a sub-deck must still name
// a REAL one — thrown here, caught by runSequence's own try/catch same as
// any other step failure, reported via the normal action:error toast.
function requireSubDeck(room: DeckRoom, subDeckId: string): void {
  if (!findSubDeck(room.dashboard, subDeckId)) throw new Error('Target sub-deck no longer exists')
}

// One action step's dispatch by kind — the same branches triggerAction used
// to run directly, now shared by runSequence's loop. `ws` is only used by
// the navigate-subdeck/open-overlay/close-overlay branches, whose whole
// effect is a targeted (not room-broadcast) reply to the ONE socket that
// triggered them — see each's own comment in shared/types.ts for why this
// is client-local state rather than shared dashboard state.
// Minimal send-only interface satisfied by both a real WebSocket (the
// per-socket target for subdeck:navigate/open-overlay/close-overlay and
// action:error replies below) and a non-WS "reply sink" the MCP
// trigger_action tool builds to collect those same replies with no real
// client socket behind it (see main/mcp/tools.ts). A plain WebSocket
// structurally satisfies this (its own .send accepts a wider argument type
// than just string), so every existing call site below needs no changes
// beyond this type.
interface ActionReplyTarget {
  send: (data: string) => void
}

// Fans a PlaySoundAction out to whichever side(s) should actually produce
// the audio. Synchronous and never throws: a sound is a garnish on a
// sequence, so a missing/deleted soundId must not abort the steps after it
// the way a failed DCS command legitimately does.
//
// `ws` is the action's own reply target — the socket that triggered it for a
// widget press, or (for a global action, which has no triggering device) a
// sink that broadcasts to every client in the room. That falls out correctly
// either way: 'client' means "whoever caused this", and for a deck-wide rule
// that's reasonably everyone looking at the deck.
function runPlaySoundAction(action: PlaySoundAction, ws: ActionReplyTarget): void {
  if (!action.soundId) return
  // Read from the library, not the action — the offset belongs to the file
  // (see CustomSound.startAtMs), so changing it once re-trims every action
  // already pointing at that sound.
  const startAtMs = getCustomSounds().find((s) => s.id === action.soundId)?.startAtMs ?? 0
  if (action.target === 'server' || action.target === 'both') {
    sendSoundToDesktop({
      type: 'sound:play',
      soundId: action.soundId,
      volume: soundVolumeToGain(action.serverVolume),
      startAtMs
    })
  }
  if (action.target === 'client' || action.target === 'both') {
    ws.send(
      JSON.stringify({
        type: 'sound:play',
        soundId: action.soundId,
        volume: soundVolumeToGain(action.clientVolume),
        startAtMs
      } satisfies ServerToClient)
    )
  }
}

async function runActionStep(room: DeckRoom, action: WidgetAction, trigger: TriggerValue | undefined, final: boolean, ws: ActionReplyTarget): Promise<void> {
  if (action.kind === 'update-state') {
    runUpdateState(room, action.code, trigger, final) // throws synchronously on failure
    return
  }
  if (action.kind === 'send-dcs-command') {
    await runSendDcsCommand(room, action, trigger)
    return
  }
  if (action.kind === 'call-rest') {
    await runCallRestAction(room, action, trigger)
    return
  }
  if (action.kind === 'set-windows-audio') {
    await runSetWindowsAudioAction(room, action, trigger)
    return
  }
  if (action.kind === 'play-sound') {
    runPlaySoundAction(action, ws)
    return
  }
  if (action.kind === 'navigate-subdeck') {
    if (action.target.type === 'sub-deck') requireSubDeck(room, action.target.subDeckId)
    ws.send(JSON.stringify({ type: 'subdeck:navigate', target: action.target } satisfies ServerToClient))
    return
  }
  if (action.kind === 'open-overlay') {
    requireSubDeck(room, action.subDeckId)
    ws.send(
      JSON.stringify({
        type: 'subdeck:open-overlay',
        subDeckId: action.subDeckId,
        edge: action.edge,
        size: action.size,
        sizeUnit: action.sizeUnit
      } satisfies ServerToClient)
    )
    return
  }
  if (action.kind === 'close-overlay') {
    ws.send(JSON.stringify({ type: 'subdeck:close-overlay' } satisfies ServerToClient))
    return
  }
  if (action.kind === 'none') return
  await runKeypressAction(action)
}

// Runs one event's SequenceStep[] in order. Aborts the remainder on the
// first thrown error (matches the old single-action error behavior) and
// reports it — originating ws only, same targeting sendError always used.
// Steps that already completed before the failure keep whatever they
// already did (e.g. a completed update-state step's variable change and
// broadcast/save already happened via applyVariableUpdates — not rolled
// back).
// Thrown internally by runSteps to unwind out of arbitrarily nested
// condition branches with the failing step's exact location still attached
// — caught once, by runSequence itself, which is the only place that
// actually reports it. Never escapes runSequence.
class SequenceStepError extends Error {
  constructor(
    message: string,
    readonly path: StepPath,
    readonly stepKind: SequenceStep['kind']
  ) {
    super(message)
  }
}

// Runs one (possibly nested) SequenceStep[] list, recursing into whichever
// branch a ConditionStep's condition selects. pathPrefix is this list's own
// location within the overall tree — [] at the top level, or
// [...outerPrefix, { index, branch }] one level into a condition's branch.
// Throws a SequenceStepError on the first failure at any depth, so an error
// inside a nested branch also aborts every remaining step back up through
// its ancestors, matching the old flat behavior's "abort the rest of the
// list" for the top-level case.
async function runSteps(
  room: DeckRoom,
  steps: SequenceStep[],
  trigger: TriggerValue | undefined,
  final: boolean,
  ws: ActionReplyTarget,
  pathPrefix: StepPath
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    try {
      if (step.kind === 'delay') {
        await sleep(step.delayMs)
      } else if (step.kind === 'condition') {
        const branch: 'whenTrue' | 'whenFalse' = evaluateConditionStep(room, step, trigger) ? 'whenTrue' : 'whenFalse'
        await runSteps(room, step[branch], trigger, final, ws, [...pathPrefix, { index: i, branch }])
      } else {
        await runActionStep(room, step.action, trigger, final, ws)
      }
    } catch (err) {
      // A SequenceStepError already carries the exact nested location it
      // failed at (built by a deeper runSteps call) — rethrow unchanged
      // rather than re-wrapping it at every ancestor level on the way up.
      throw err instanceof SequenceStepError
        ? err
        : new SequenceStepError(err instanceof Error ? err.message : String(err), [...pathPrefix, { index: i }], step.kind)
    }
  }
}

// Runs one event's SequenceStep[] tree top to bottom, reporting the first
// failure (at whatever depth it happened) via sendError — originating ws
// only, same targeting sendError always used. Steps that already completed
// before the failure keep whatever they already did (e.g. a completed
// update-state step's variable change and broadcast/save already happened
// via applyVariableUpdates — not rolled back).
async function runSequence(
  room: DeckRoom,
  steps: SequenceStep[],
  trigger: TriggerValue | undefined,
  final: boolean,
  ws: ActionReplyTarget,
  widgetId: string,
  event: WidgetEventKind
): Promise<void> {
  try {
    await runSteps(room, steps, trigger, final, ws, [])
  } catch (err) {
    // runSteps only ever throws a SequenceStepError (every catch inside it
    // wraps a plain thrown value into one before rethrowing) — this cast
    // reflects that invariant.
    const stepErr = err as SequenceStepError
    sendError(ws, widgetId, stepErr.message, { event, path: stepErr.path, stepKind: stepErr.stepKind })
  }
}

// How many times a single pass will re-run the rules over changes the rules
// themselves caused before giving up. A rule setting a variable another rule
// watches is the whole point of cascading, and genuinely settles in one or
// two rounds; anything still going after this is a loop (A sets X, B sets X
// back), which `trigger: 'change'` mostly prevents on its own but can't rule
// out when the values really do keep flipping. Hitting the cap logs to the
// deck's debug console rather than failing silently or hanging the process.
const GLOBAL_ACTION_MAX_ROUNDS = 10

// Records variable names for the next global-action round and starts a pass
// if one isn't already running — called by applyVariableUpdates for every
// change, whatever its origin.
function queueGlobalActions(room: DeckRoom, names: string[]): void {
  if (names.length === 0) return
  // Nothing to do at all on a deck with no rules — avoids paying a Set
  // insert per changed variable on every DCS-BIOS tick for the common case.
  if ((room.dashboard.globalActions ?? []).length === 0) return
  for (const name of names) room.pendingGlobalVars.add(name)
  if (!room.inGlobalActionRun) room.pendingGlobalExternal = true
  if (room.globalActionPassRunning) return
  void runGlobalActionPass(room)
}

// A rule's steps have no widget and no originating socket, but
// navigate-subdeck/open-overlay/close-overlay still reply through one — send
// those to every client in the room instead, since a deck-wide rule isn't
// acting on behalf of any single device. Re-parsed rather than threaded
// through as an object because ActionReplyTarget is deliberately a
// send(string) sink (see its own comment); these actions are rare enough
// that one extra parse doesn't matter.
function globalActionReplyTarget(room: DeckRoom): ActionReplyTarget {
  return {
    send: (data: string) => {
      try {
        broadcastToRoom(room, JSON.parse(data) as ServerToClient)
      } catch {
        // A malformed payload here would mean runActionStep itself built bad
        // JSON — nothing useful to do with it, and it must not abort the
        // rest of the rule's steps.
      }
    }
  }
}

// Same evaluation mechanism as evaluateConditionStep, minus the trigger —
// a global rule has no $value/$index in scope, since nothing interactive
// fired it.
function evaluateGlobalCondition(room: DeckRoom, rule: GlobalAction): boolean {
  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  const result = withLogRoom(room, () => tryEvaluateExpression(rule.condition, variableMap))
  if (!result.ok) throw new Error(result.error)
  return Boolean(result.value)
}

function logGlobalAction(room: DeckRoom, message: string): void {
  logAction(room, `[Global action] ${message}`)
}

// Runs every rule whose watch list intersects the changed variables, then
// repeats over whatever those rules themselves changed, until nothing is
// left pending or GLOBAL_ACTION_MAX_ROUNDS is hit.
//
// Rules run sequentially, in dashboard.globalActions order, and each one is
// awaited before the next starts — so a rule that sets a variable a later
// rule watches is seen by that rule within the same round, and two rules
// firing at once can't interleave their steps.
async function runGlobalActionPass(room: DeckRoom): Promise<void> {
  room.globalActionPassRunning = true
  try {
    for (let round = 0; round < GLOBAL_ACTION_MAX_ROUNDS; round++) {
      if (room.pendingGlobalVars.size === 0) return
      const changedNames = room.pendingGlobalVars
      const external = room.pendingGlobalExternal
      room.pendingGlobalVars = new Set()
      room.pendingGlobalExternal = false

      for (const rule of room.dashboard.globalActions ?? []) {
        if (!rule.enabled) continue
        if (!rule.watch.some((name) => changedNames.has(name))) continue

        let condition: boolean
        try {
          condition = evaluateGlobalCondition(room, rule)
        } catch (err) {
          logGlobalAction(room, `"${rule.name}" condition failed: ${(err as Error).message}`)
          continue
        }

        const wasTrue = room.globalActionConditions.get(rule.id) ?? false
        room.globalActionConditions.set(rule.id, condition)
        if (!condition) continue
        // An 'always' rule fires once per real incoming change, not once per
        // cascade round — otherwise a condition that simply stays true would
        // re-fire on every round it caused, which is exactly the runaway the
        // round cap exists to catch. 'change' rules are edge-guarded by
        // wasTrue and so are safe to re-run on a cascade round.
        if (rule.trigger === 'change' ? wasTrue : !external) continue

        room.inGlobalActionRun = true
        try {
          await runSteps(room, rule.steps, undefined, true, globalActionReplyTarget(room), [])
        } catch (err) {
          logGlobalAction(room, `"${rule.name}" failed: ${(err as SequenceStepError).message}`)
        } finally {
          room.inGlobalActionRun = false
        }
      }
    }

    if (room.pendingGlobalVars.size > 0) {
      logGlobalAction(
        room,
        `stopped after ${GLOBAL_ACTION_MAX_ROUNDS} rounds — rules are still changing variables (${[...room.pendingGlobalVars].join(', ')}). ` +
          'Check for two rules that keep undoing each other.'
      )
      room.pendingGlobalVars = new Set()
      room.pendingGlobalExternal = false
    }
  } finally {
    room.globalActionPassRunning = false
  }
}

async function triggerAction(
  room: DeckRoom,
  widgetId: string,
  event: WidgetEventKind,
  ws: ActionReplyTarget,
  value: number | undefined,
  final: boolean
): Promise<void> {
  const widget = findWidgetAnywhere(room.dashboard, widgetId)
  if (!widget) {
    sendError(ws, widgetId, 'Widget not found')
    return
  }

  // Gauge/screen-capture/label are passive — none has `.events` at all, so a
  // stale/malicious action:trigger naming one lands here rather than
  // crashing on getEventSteps below (which assumes EventfulWidget).
  if (widget.type === 'gauge-bar' || widget.type === 'gauge-arc' || widget.type === 'screen-capture' || widget.type === 'label') {
    sendError(ws, widgetId, 'This widget cannot be triggered')
    return
  }

  // The switch widgets (RockerSwitchWidget/DialSwitchWidget/
  // ToggleSwitchWidget) aren't EventfulWidget (see their own comment in
  // shared/types.ts) — which SELECT sequence runs depends on which position
  // was picked, not a static per-type event kind, so 'select' can't go
  // through getEventSteps below. `value` carries the target position's
  // index (see ClientToServer's 'action:trigger'). Unlike the pre-split
  // MultiSwitchWidget, this no longer mutates/broadcasts room.dashboard at
  // all — which position "looks active" is deliberately client-local (or
  // driven by activePositionExpr reading a Variable), never
  // server-authoritative dashboard state; see SwitchWidgetBase's own
  // comment in shared/types.ts. press/release/increment/decrement (the
  // last two DialSwitchWidget-only) DO now live on widget.events same as an
  // EventfulWidget, but stay handled here rather than folded into
  // getEventSteps — that function's signature assumes EventfulWidget, and
  // these three types are deliberately not that (see SwitchWidgetBase's own
  // comment) for reasons unrelated to just this one field existing.
  if (widget.type === 'switch-rocker' || widget.type === 'switch-dial' || widget.type === 'switch-toggle') {
    if (event === 'press' || event === 'release') {
      await runSequence(room, widget.events[event], numericTrigger(value), final, ws, widgetId, event)
      return
    }

    // ToggleSwitchWidget-only (see its own events.guardToggle comment in
    // shared/types.ts) — value is 1/0 for opening/closing, same numericTrigger
    // wrapping as press/release above, exposed as variables.$value.
    if (widget.type === 'switch-toggle' && event === 'guardToggle') {
      await runSequence(room, widget.events.guardToggle, numericTrigger(value), final, ws, widgetId, event)
      return
    }

    // DialSwitchWidget-only, same optIN-by-being-non-empty convention as
    // ButtonWidget's own (see its events comment) — the client-side arbiter
    // (useMultiPressArbiter) already decided single vs double vs triple
    // before this ever arrives, so this is just "run whichever one it is."
    if (widget.type === 'switch-dial' && (event === 'doublePress' || event === 'triplePress')) {
      await runSequence(room, widget.events[event], numericTrigger(value), final, ws, widgetId, event)
      return
    }

    if (widget.type === 'switch-dial' && (event === 'increment' || event === 'decrement')) {
      const index = value !== undefined ? Math.trunc(value) : NaN
      const position = widget.positions[index]
      if (!position) {
        sendError(ws, widgetId, 'This widget cannot fire this event')
        return
      }
      // Same $value/$index convention as 'select' below — which position
      // was landed ON by this turn, not a step count, since that's almost
      // always the more useful thing for the expression to know.
      await runSequence(room, widget.events[event], { value: position.name, index }, true, ws, widgetId, event)
      return
    }

    // RockerSwitchWidget's settleToInactive pseudo-position only — the
    // client (see useSwitchPosition.ts's settleInactive) sends this sentinel
    // index on release, once the switch settles back to nothing active
    // (a real position's own 'select' already fired separately, on press —
    // see RockerSwitchWidgetContent's onSelect), so onInactive/
    // positionChange both fire to match what the widget just visually did.
    // Gated on settleToInactive itself, not just the widget type, since the
    // client only ever sends -1 while it's on — an otherwise-stale/
    // malicious -1 gets the same "cannot fire" error as any other bogus
    // index below.
    if (widget.type === 'switch-rocker' && event === 'select' && value === -1 && widget.settleToInactive) {
      const trigger: TriggerValue = { value: 'Inactive', index: -1 }
      await runSequence(room, widget.onInactive, trigger, true, ws, widgetId, event)
      await runSequence(room, widget.events.positionChange, trigger, true, ws, widgetId, event)
      return
    }

    const index = value !== undefined ? Math.trunc(value) : NaN
    const position = widget.positions[index]
    if (event !== 'select' || !position) {
      sendError(ws, widgetId, 'This widget cannot fire this event')
      return
    }
    // The position's own name as $value, its index as $index — see
    // TriggerValue's own doc comment. Runs both this position's own
    // onSelect AND the widget-level positionChange — see
    // RockerSwitchWidget.events' own comment for why both exist.
    const trigger: TriggerValue = { value: position.name, index }
    await runSequence(room, position.onSelect, trigger, true, ws, widgetId, event)
    await runSequence(room, widget.events.positionChange, trigger, true, ws, widgetId, event)
    return
  }

  // DropdownWidget is a hybrid the other two branches above each cover half
  // of — its own static press/release (like the generic path below) PLUS
  // per-position 'select' (like the switch branch above) — so it gets its
  // own branch handling both rather than fitting either alone. See its own
  // comment in shared/types.ts for why it isn't an EventfulWidget/SwitchWidget.
  if (widget.type === 'dropdown') {
    if (event === 'press' || event === 'release') {
      await runSequence(room, widget.events[event], numericTrigger(value), final, ws, widgetId, event)
      return
    }
    const index = value !== undefined ? Math.trunc(value) : NaN
    const position = widget.positions[index]
    if (event !== 'select' || !position) {
      sendError(ws, widgetId, 'This widget cannot fire this event')
      return
    }
    const trigger: TriggerValue = { value: position.name, index }
    await runSequence(room, position.onSelect, trigger, true, ws, widgetId, event)
    await runSequence(room, widget.events.positionChange, trigger, true, ws, widgetId, event)
    return
  }

  const steps = getEventSteps(widget, event)
  if (steps === undefined) {
    sendError(ws, widgetId, `This widget cannot fire a "${event}" event`)
    return
  }
  await runSequence(room, steps, numericTrigger(value), final, ws, widgetId, event)
}

function sendError(
  ws: ActionReplyTarget,
  widgetId: string,
  message: string,
  detail?: { event: WidgetEventKind; path: StepPath; stepKind: SequenceStep['kind'] }
): void {
  const payload: ServerToClient = { type: 'action:error', widgetId, message, ...(detail && { detail }) }
  ws.send(JSON.stringify(payload))
}

wss.on('connection', (ws: TrackedSocket, req) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const deckParam = url.searchParams.get('deck') ?? ''
  // Empty deck param is the lobby (see connectLobby in store.ts) — only a
  // *non-empty* one that fails to resolve gets rejected outright.
  const room = deckParam ? getOrLoadRoom(deckParam) : null
  if (deckParam && !room) {
    ws.close(DECK_CLOSE_CODE_UNKNOWN, 'Unknown deck')
    return
  }

  socketContext.set(ws, { deckId: room?.id ?? '', remoteAddress: req.socket.remoteAddress })
  room?.sockets.add(ws)

  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })

  // Deliberately nothing sent here — dashboard/devices/DCS-BIOS state only
  // goes out once 'hello' identifies the socket as 'edit' (always trusted)
  // or an approved 'view' device (see the 'hello' case below and
  // sendInitialState). An unapproved device gets device:pending instead.

  ws.on('close', () => {
    const ctx = socketContext.get(ws)
    socketContext.delete(ws)
    if (!ctx) return
    // Harmless if it was never in there (already approved/denied, or never
    // sent hello at all) — Map.delete on a missing key is a no-op.
    if (ctx.deviceId) pendingDeviceInfo.delete(ctx.deviceId)
    // The room may have been deleted (via DELETE /api/decks/:id) while this
    // socket was still open, or this was a lobby connection with no room to
    // begin with — tolerate both rather than assuming one's there.
    const activeRoom = rooms.get(ctx.deckId)
    if (!activeRoom) return
    activeRoom.sockets.delete(ws)
    if (ctx.deviceId) {
      const existing = activeRoom.devices.get(ctx.deviceId)
      if (existing) {
        activeRoom.devices.set(ctx.deviceId, { ...existing, connected: false })
        broadcastDevices(activeRoom)
      }
    }
  })

  ws.on('message', async (raw) => {
    const ctx = socketContext.get(ws)
    if (!ctx) {
      ws.close(DECK_CLOSE_CODE_UNKNOWN, 'Unknown deck')
      return
    }
    // A non-empty ctx.deckId names a room that existed when this socket
    // connected — if it's gone now (deleted mid-session), close the same
    // way the initial-connection rejection does. A lobby socket (empty
    // ctx.deckId) was never tied to one, so activeRoom staying undefined
    // here is the expected, unproblematic case — see the per-case guards
    // below for what still needs a real room.
    const activeRoom = ctx.deckId ? rooms.get(ctx.deckId) : undefined
    if (ctx.deckId && !activeRoom) {
      ws.close(DECK_CLOSE_CODE_UNKNOWN, 'Unknown deck')
      return
    }

    let message: ClientToServer
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Whitelist, not blacklist: 'hello' is always allowed (that's how a
    // socket earns trust in the first place), everything else needs
    // isTrustedSocket — covers both an unapproved view device and a
    // hand-crafted client that skipped hello entirely (ctx.role still
    // undefined at that point).
    if (message.type !== 'hello' && !isTrustedSocket(ctx)) {
      return
    }

    switch (message.type) {
      case 'dashboard:update':
        if (!activeRoom) break
        // Same immediate/debounced split as applyVariableUpdates — an
        // in-flight drag tick (final: false) must not do a blocking
        // full-dashboard writeFileSync on every frame; the drag's own final
        // tick (or any one-off edit) still saves synchronously so nothing's
        // lost if the app closes right after.
        applyDashboardUpdate(activeRoom, message.dashboard, message.final ?? true, ws)
        break
      case 'dashboard:reload': {
        if (!activeRoom) break
        if (ctx.role !== 'edit') break
        const fresh = loadDeckDashboard(activeRoom.id)
        if (!fresh) break
        activeRoom.dashboard = fresh
        // Baseline for the next external-change comparison — read the raw
        // file fresh rather than re-deriving from `fresh` (which
        // loadDeckDashboard has already normalized), same reasoning as
        // getOrLoadRoom's own lastWrittenJson seed.
        try {
          activeRoom.lastWrittenJson = readFileSync(deckDashboardFile(activeRoom.id), 'utf-8')
        } catch {
          // Vanishingly unlikely (loadDeckDashboard just read this same file
          // successfully above) — if it somehow fails, the next real save
          // still re-seeds this via saveDeckDashboard.
        }
        broadcastToRoom(activeRoom, dashboardSyncMessage(activeRoom.dashboard))
        syncPlugins(activeRoom)
        break
      }
      case 'action:trigger':
        if (!activeRoom) break
        await triggerAction(activeRoom, message.widgetId, message.event, ws, message.value, message.final ?? true)
        break
      case 'hello':
        if (message.role === 'edit') {
          // The editor's own window — always trusted, no approval gate, but
          // ONLY from loopback (see remoteAddress's own comment on
          // SocketContext for why that's a sufficient proxy for "this is
          // the desktop"). A LAN device — or a browser tab a user opened,
          // which can reach this same WS port with no same-origin
          // restriction — claiming role: 'edit' gets silently ignored
          // exactly like any other message a not-yet-trusted socket sends
          // (see the message-type gate above this switch); it's already
          // indistinguishable, from the client's own point of view, from a
          // slow/pending approval, so no separate rejection message exists
          // to leak "you tried to claim edit" to whoever's probing.
          if (!isLoopbackAddress(ctx.remoteAddress)) break
          // Guarded so a resize-triggered re-hello (if edit mode ever sends
          // one) doesn't re-send the initial state or double-register.
          if (ctx.role !== 'edit') {
            ctx.role = 'edit'
            if (activeRoom) sendInitialState(ws, activeRoom)
          }
        } else if (message.role === 'view' && message.viewport && message.deviceId) {
          const isFirstHello = ctx.deviceId === undefined
          ctx.role = 'view'
          ctx.deviceId = message.deviceId
          // `?? ctx.deviceToken`, not a plain overwrite: a resize-triggered
          // re-hello can race a just-issued device:token (see the
          // device:approve handler, which sets ctx.deviceToken directly on
          // an already-open socket the instant it approves) — if the
          // client's re-hello goes out before it's finished persisting that
          // token client-side, it carries no token yet, and a plain
          // overwrite would clobber the live value the socket was just
          // granted back to undefined. Falling back to whatever's already
          // on ctx only matters for that narrow race; a message.deviceToken
          // that IS present (the normal case, including every hello after
          // this one) still updates it as usual — e.g. a device presenting
          // a genuinely different token after some other flow reissued one.
          ctx.deviceToken = message.deviceToken ?? ctx.deviceToken

          let device: DeviceInfo = {
            id: message.deviceId,
            width: message.viewport.width,
            height: message.viewport.height,
            userAgent: message.userAgent,
            connected: true
          }

          if (activeRoom) {
            // Merge onto any existing entry — this also fires on every
            // window resize (see store.ts's sendHello), so a plain
            // overwrite would wipe out a previously-set customName each
            // time. A lobby connection (no activeRoom) has no per-deck
            // device entry to merge onto in the first place — it's not
            // "in" any deck yet.
            const existing = activeRoom.devices.get(message.deviceId)
            device = { ...existing, ...device }
            activeRoom.devices.set(message.deviceId, device)
            broadcastDevices(activeRoom)
          }

          // Only the socket's first hello decides whether to send state or
          // request approval — a later resize-triggered hello for an
          // already-pending device would otherwise re-prompt every
          // trusted device every time the phone rotates.
          if (isFirstHello) {
            if (verifyDeviceToken(message.deviceId, message.deviceToken)) {
              if (activeRoom) {
                sendInitialState(ws, activeRoom)
              } else {
                // The lobby's whole point: even the deck list itself is
                // gated the same way dashboard content is.
                ws.send(JSON.stringify({ type: 'decks:list', decks: listDeckSummaries() } satisfies ServerToClient))
              }
            } else {
              ws.send(JSON.stringify({ type: 'device:pending' } satisfies ServerToClient))
              pendingDeviceInfo.set(message.deviceId, device)
              requestDeviceApproval(device)
            }
          }
        }
        break
      case 'device:approve': {
        // Reaching this case at all already proves isTrustedSocket(ctx) —
        // the message gate above only lets 'hello' through otherwise — so
        // no separate role check is needed here.
        let token: string
        {
          const info = pendingDeviceInfo.get(message.deviceId)
          token = approveDevice(message.deviceId, info ? displayDeviceName(info) : message.deviceId)
          pendingDeviceInfo.delete(message.deviceId)
        }
        for (const [sock, sctx] of socketContext) {
          if (sctx.deviceId !== message.deviceId || sock.readyState !== WebSocket.OPEN) continue
          // Set directly on the live socket's own context, not just sent
          // over the wire — isTrustedSocket re-verifies ctx.deviceToken on
          // every subsequent message on THIS connection, so without this
          // the socket that just got approved would still fail every check
          // until it reconnects (picking the persisted token back up via a
          // fresh hello). Sent to the client too (device:token below) so
          // localStorage carries it forward past this session.
          sctx.deviceToken = token
          sock.send(JSON.stringify({ type: 'device:token', deviceId: message.deviceId, token } satisfies ServerToClient))
          const targetRoom = sctx.deckId ? rooms.get(sctx.deckId) : undefined
          if (targetRoom) {
            sendInitialState(sock, targetRoom)
          } else {
            // Approved while still sitting on the picker screen (lobby) —
            // push the deck list now rather than making it reconnect.
            sock.send(JSON.stringify({ type: 'decks:list', decks: listDeckSummaries() } satisfies ServerToClient))
          }
        }
        break
      }
      case 'device:deny': {
        pendingDeviceInfo.delete(message.deviceId)
        for (const [sock, sctx] of socketContext) {
          if (sctx.deviceId !== message.deviceId) continue
          sock.send(JSON.stringify({ type: 'device:denied' } satisfies ServerToClient))
          sock.close(DECK_CLOSE_CODE_DENIED, 'Device denied')
        }
        break
      }
      case 'device:list-approved': {
        // Admin action — kept desktop-only, unlike approve/deny above,
        // since this manages the master list rather than one pending device.
        if (ctx.role !== 'edit') break
        ws.send(JSON.stringify({ type: 'device:approved-list', devices: listApprovedDevices() } satisfies ServerToClient))
        break
      }
      case 'device:revoke': {
        if (ctx.role !== 'edit') break
        revokeDevice(message.deviceId)
        // Also ends any session it's mid-using right now — a revoke that
        // only took effect on its *next* reconnect would leave a
        // still-open dashboard connection working until whenever that is.
        for (const [sock, sctx] of socketContext) {
          if (sctx.deviceId !== message.deviceId) continue
          sock.send(JSON.stringify({ type: 'device:denied' } satisfies ServerToClient))
          sock.close(DECK_CLOSE_CODE_DENIED, 'Device revoked')
        }
        ws.send(JSON.stringify({ type: 'device:approved-list', devices: listApprovedDevices() } satisfies ServerToClient))
        break
      }
      case 'time:sync':
        // Direct ws.send, deliberately bypassing queueSend/broadcastToRoom's
        // coalescing queue — sitting behind an unrelated queued
        // dashboard:sync would inflate the client's measured RTT (and, with
        // it, the derived clock offset) for no reason. This reply is small,
        // rare (see store.ts's SYNC_INTERVAL_MS), and time-sensitive in a
        // way ordinary broadcasts aren't, so it always jumps the queue.
        ws.send(JSON.stringify({ type: 'time:sync-reply', clientSentAt: message.clientSentAt, serverTime: Date.now() } satisfies ServerToClient))
        break
      case 'device:lag-report': {
        // ctx.deviceId is only ever set for a 'view' socket (see the 'hello'
        // handler below) — an edit socket (the desktop itself) has nothing
        // to report here since it renders its own edits locally, with
        // nothing round-tripping through the network to lag behind.
        if (!activeRoom || ctx.deviceId === undefined) break
        const existing = activeRoom.devices.get(ctx.deviceId)
        if (existing) {
          activeRoom.devices.set(ctx.deviceId, { ...existing, lagMs: message.lagMs })
          broadcastDevices(activeRoom)
        }
        break
      }
      case 'device:rename': {
        if (!activeRoom) break
        const existing = activeRoom.devices.get(message.deviceId)
        if (existing) {
          const updated = { ...existing, customName: message.name.trim() || undefined }
          activeRoom.devices.set(message.deviceId, updated)
          broadcastDevices(activeRoom)
          // Keeps the settings modal's "Approved devices" list from staying
          // frozen at whatever name was current when this device was
          // approved — no-op if it isn't (or isn't currently) approved.
          renameApprovedDevice(message.deviceId, displayDeviceName(updated))
          for (const [sock, sctx] of socketContext) {
            if (sctx.role === 'edit' && sock.readyState === WebSocket.OPEN) {
              sock.send(JSON.stringify({ type: 'device:approved-list', devices: listApprovedDevices() } satisfies ServerToClient))
            }
          }
        }
        break
      }
      case 'background-image:upload': {
        if (!activeRoom) break
        const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(message.dataUrl)
        if (!match) break
        const [, mime, base64] = match
        mkdirSync(deckDir(activeRoom.id), { recursive: true })
        writeFileSync(deckBackgroundImageFile(activeRoom.id), Buffer.from(base64, 'base64'))
        activeRoom.dashboard = { ...activeRoom.dashboard, backgroundImageMime: mime, backgroundImageVersion: Date.now() }
        saveDeckDashboard(activeRoom)
        broadcastToRoom(activeRoom, dashboardSyncMessage(activeRoom.dashboard))
        break
      }
      case 'background-image:clear': {
        if (!activeRoom) break
        const file = deckBackgroundImageFile(activeRoom.id)
        if (existsSync(file)) unlinkSync(file)
        const { backgroundImageMime: _mime, backgroundImageVersion: _version, ...rest } = activeRoom.dashboard
        activeRoom.dashboard = rest
        saveDeckDashboard(activeRoom)
        broadcastToRoom(activeRoom, dashboardSyncMessage(activeRoom.dashboard))
        break
      }
      case 'dcsbios:list-aircraft': {
        const aircraft = await listInstalledAircraft()
        ws.send(JSON.stringify({ type: 'dcsbios:aircraft-list', aircraft } satisfies ServerToClient))
        break
      }
      case 'dcsbios:field-catalog': {
        try {
          const fields = await getFieldCatalog(message.aircraft)
          ws.send(JSON.stringify({ type: 'dcsbios:field-catalog', aircraft: message.aircraft, fields } satisfies ServerToClient))
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: 'dcsbios:field-catalog-error',
              aircraft: message.aircraft,
              message: err instanceof Error ? err.message : String(err)
            } satisfies ServerToClient)
          )
        }
        break
      }
      case 'dcsbios:get-settings': {
        ws.send(JSON.stringify({ type: 'dcsbios:settings', ...getDcsBiosSettings() } satisfies ServerToClient))
        break
      }
      case 'dcsbios:update-settings': {
        const settings = await updateDcsBiosSettings(message.settings)
        ws.send(JSON.stringify({ type: 'dcsbios:settings', ...settings } satisfies ServerToClient))
        break
      }
      case 'dcsbios:validate-docs-dir': {
        const result = validateDocsDir(message.docsDir)
        ws.send(
          JSON.stringify({ type: 'dcsbios:docs-dir-validation', docsDir: message.docsDir, ...result } satisfies ServerToClient)
        )
        break
      }
      case 'dcsbios:pick-docs-folder': {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        const path = !result.canceled && result.filePaths.length > 0 ? result.filePaths[0] : null
        ws.send(JSON.stringify({ type: 'dcsbios:docs-folder-picked', path } satisfies ServerToClient))
        break
      }
      case 'dcsbios:command-catalog': {
        try {
          const commands = await getCommandCatalog(message.aircraft)
          ws.send(JSON.stringify({ type: 'dcsbios:command-catalog', aircraft: message.aircraft, commands } satisfies ServerToClient))
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: 'dcsbios:command-catalog-error',
              aircraft: message.aircraft,
              message: err instanceof Error ? err.message : String(err)
            } satisfies ServerToClient)
          )
        }
        break
      }
      case 'dcsbios:send-command': {
        try {
          await sendDcsBiosCommand(message.identifier, message.argument)
          ws.send(JSON.stringify({ type: 'dcsbios:send-command-result', ok: true } satisfies ServerToClient))
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: 'dcsbios:send-command-result',
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            } satisfies ServerToClient)
          )
        }
        break
      }
      case 'dcsViewports:get-settings': {
        ws.send(JSON.stringify({ type: 'dcsViewports:settings', ...getDcsViewportsSettings() } satisfies ServerToClient))
        break
      }
      case 'dcsViewports:update-settings': {
        const settings = await updateDcsViewportsSettings(message.settings)
        ws.send(JSON.stringify({ type: 'dcsViewports:settings', ...settings } satisfies ServerToClient))
        ws.send(JSON.stringify({ type: 'dcsViewports:status', ...getDcsViewportsStatus() } satisfies ServerToClient))
        break
      }
      case 'dcsViewports:get-status': {
        ws.send(JSON.stringify({ type: 'dcsViewports:status', ...getDcsViewportsStatus() } satisfies ServerToClient))
        // Answer from cache immediately above, then sanity-check against
        // live display state in the background — covers rearranging
        // screens while the app (or just this settings panel) was closed,
        // which the display-change listener in app.whenReady can't have
        // seen. Any change broadcasts via onDcsViewportsStatusChange below.
        if (getAppSettings().enabledPlugins.includes('dcsViewports')) {
          void refreshDcsViewportsStatus().catch((err: unknown) => {
            console.error('[boarderoni] dcsViewports get-status refresh failed', err)
          })
        }
        break
      }
      case 'dcsViewports:validate-dcs-install-dir': {
        const result = validateDcsViewportsInstallDir(message.dir)
        ws.send(
          JSON.stringify({ type: 'dcsViewports:dcs-install-dir-validation', dir: message.dir, ...result } satisfies ServerToClient)
        )
        break
      }
      case 'dcsViewports:validate-saved-games-dir': {
        const result = validateDcsViewportsSavedGamesDir(message.dir)
        ws.send(
          JSON.stringify({ type: 'dcsViewports:saved-games-dir-validation', dir: message.dir, ...result } satisfies ServerToClient)
        )
        break
      }
      case 'dcsViewports:pick-dcs-install-folder': {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        const path = !result.canceled && result.filePaths.length > 0 ? result.filePaths[0] : null
        ws.send(JSON.stringify({ type: 'dcsViewports:dcs-install-folder-picked', path } satisfies ServerToClient))
        break
      }
      case 'dcsViewports:pick-saved-games-folder': {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        const path = !result.canceled && result.filePaths.length > 0 ? result.filePaths[0] : null
        ws.send(JSON.stringify({ type: 'dcsViewports:saved-games-folder-picked', path } satisfies ServerToClient))
        break
      }
      case 'app-settings:get': {
        ws.send(JSON.stringify({ type: 'app-settings:settings', ...getAppSettings() } satisfies ServerToClient))
        break
      }
      case 'app-settings:update': {
        // dcsViewports's false->true edge-refresh, resyncAllRoomsPlugins,
        // and syncRestIncomingServers all now live inside
        // applyAppSettingsPatch (see its own comment) — REST/dcsViewports
        // are core plugins (see shared/plugins/rest.ts) with no
        // per-dashboard instances of their own, so their master switches
        // need that separate handling instead of just resyncAllRoomsPlugins.
        const settings = await applyAppSettingsPatch({ enabledPlugins: message.enabledPlugins })
        ws.send(JSON.stringify({ type: 'app-settings:settings', ...settings } satisfies ServerToClient))
        break
      }
      case 'mcp-server:get': {
        // Settings modal only, edit-role only (enforced server-side) — same
        // admin-action reasoning as rest-sources:get.
        if (ctx.role !== 'edit') break
        const settings = getMcpServerSettings()
        const status = getMcpListenStatus()
        ws.send(
          JSON.stringify({
            type: 'mcp-server:settings',
            bearerToken: settings.bearerToken,
            port: MCP_SERVER_PORT,
            ...status
          } satisfies ServerToClient)
        )
        break
      }
      case 'mcp-server:regenerate-token': {
        if (ctx.role !== 'edit') break
        const settings = regenerateMcpServerToken()
        syncMcpServer(mcpDeps)
        const status = getMcpListenStatus()
        ws.send(
          JSON.stringify({
            type: 'mcp-server:settings',
            bearerToken: settings.bearerToken,
            port: MCP_SERVER_PORT,
            ...status
          } satisfies ServerToClient)
        )
        break
      }
      case 'rest-sources:get': {
        // Settings modal / action editor only, edit-role only (enforced
        // server-side) — same admin-action reasoning as
        // device:list-approved.
        if (ctx.role !== 'edit') break
        ws.send(JSON.stringify(restSourcesPayload()))
        break
      }
      case 'rest-sources:create': {
        if (ctx.role !== 'edit') break
        createRestDataSource(message.name)
        syncRestIncomingServers(applyRestIncoming)
        broadcastRestSources()
        break
      }
      case 'rest-sources:update': {
        if (ctx.role !== 'edit') break
        // The renderer's own copy is RestDataSourceStatus (RestDataSource
        // plus derived listening/listenError, see restSourcesPayload) — it
        // round-trips the whole object on every edit rather than stripping
        // those fields itself, so this is where they're dropped before
        // anything gets persisted to disk.
        const sanitized = message.sources.map(({ id, name, enabled, port, bearerToken, targetDeckId, mappings }) => ({
          id,
          name,
          enabled,
          port,
          bearerToken,
          targetDeckId,
          mappings
        }))
        updateRestDataSources(sanitized)
        syncRestIncomingServers(applyRestIncoming)
        broadcastRestSources()
        break
      }
      case 'rest-sources:regenerate-token': {
        if (ctx.role !== 'edit') break
        regenerateRestDataSourceToken(message.sourceId)
        syncRestIncomingServers(applyRestIncoming)
        broadcastRestSources()
        break
      }
      case 'rest-sources:delete': {
        if (ctx.role !== 'edit') break
        updateRestDataSources(getRestDataSources().filter((s) => s.id !== message.sourceId))
        syncRestIncomingServers(applyRestIncoming)
        broadcastRestSources()
        break
      }
      case 'rest-webhook-targets:get': {
        if (ctx.role !== 'edit') break
        ws.send(JSON.stringify(restWebhookTargetsPayload()))
        break
      }
      case 'rest-webhook-targets:create': {
        if (ctx.role !== 'edit') break
        createRestWebhookTarget(message.name)
        broadcastRestWebhookTargets()
        break
      }
      case 'rest-webhook-targets:update': {
        if (ctx.role !== 'edit') break
        const sanitized = message.targets.map(({ id, name, enabled, method, url, headers, payloadTemplate }) => ({
          id,
          name,
          enabled,
          method,
          url,
          headers,
          payloadTemplate
        }))
        updateRestWebhookTargets(sanitized)
        broadcastRestWebhookTargets()
        break
      }
      case 'rest-webhook-targets:delete': {
        if (ctx.role !== 'edit') break
        updateRestWebhookTargets(getRestWebhookTargets().filter((t) => t.id !== message.targetId))
        broadcastRestWebhookTargets()
        break
      }
      case 'sounds:get': {
        // Not role-gated, same as fonts:get — see broadcastCustomSounds.
        ws.send(JSON.stringify({ type: 'sounds:list', sounds: getCustomSounds() } satisfies ServerToClient))
        break
      }
      case 'sounds:upload': {
        if (ctx.role !== 'edit') break
        addCustomSound(message.dataUrl, message.label, message.filename)
        broadcastCustomSounds()
        break
      }
      case 'sounds:delete': {
        if (ctx.role !== 'edit') break
        deleteCustomSound(message.soundId)
        broadcastCustomSounds()
        break
      }
      case 'sounds:update': {
        if (ctx.role !== 'edit') break
        updateCustomSoundStartAt(message.soundId, message.startAtMs)
        broadcastCustomSounds()
        break
      }
      case 'fonts:get': {
        // Unlike rest-sources:get, not role-gated — see broadcastCustomFonts's
        // own comment for why 'view' needs this list too.
        ws.send(JSON.stringify({ type: 'fonts:list', fonts: getCustomFonts() } satisfies ServerToClient))
        break
      }
      case 'fonts:upload': {
        // Managing the library is still an editor-only action, same as every
        // other rest-sources:*/device:list-approved admin action — just the
        // resulting broadcast isn't role-gated the same way theirs are.
        if (ctx.role !== 'edit') break
        addCustomFont(message.dataUrl, message.label, message.filename)
        broadcastCustomFonts()
        break
      }
      case 'fonts:delete': {
        if (ctx.role !== 'edit') break
        deleteCustomFont(message.fontId)
        broadcastCustomFonts()
        break
      }
      case 'fonts:update': {
        if (ctx.role !== 'edit') break
        updateCustomFontLineHeight(message.fontId, message.lineHeight)
        broadcastCustomFonts()
        break
      }
      case 'custom-variants:get': {
        if (ctx.role !== 'edit') break
        ws.send(JSON.stringify({ type: 'custom-variants:list', variants: getCustomVariants() } satisfies ServerToClient))
        break
      }
      case 'custom-variants:save': {
        if (ctx.role !== 'edit') break
        addCustomVariant(message.name, message.widgets)
        broadcastCustomVariants()
        break
      }
      case 'custom-variants:delete': {
        if (ctx.role !== 'edit') break
        deleteCustomVariant(message.variantId)
        broadcastCustomVariants()
        break
      }
      case 'windows-audio:list-devices': {
        if (ctx.role !== 'edit') break
        const devices = await listWindowsAudioDevices()
        ws.send(JSON.stringify({ type: 'windows-audio:devices', devices } satisfies ServerToClient))
        break
      }
      case 'windows-audio:list-sessions': {
        if (ctx.role !== 'edit') break
        const sessions = await listWindowsAudioSessions()
        ws.send(JSON.stringify({ type: 'windows-audio:sessions', sessions } satisfies ServerToClient))
        break
      }
      case 'screen-capture:list-displays': {
        ws.send(JSON.stringify({ type: 'screen-capture:displays', displays: listDisplays() } satisfies ServerToClient))
        break
      }
      case 'screen-capture:pick-region': {
        if (!activeRoom) break
        const region = await openRegionPicker(message.displayId)
        // No reply message for the result itself — same as
        // background-image:upload, the picked region is written straight
        // into the widget and reaches every client (including this one)
        // via the normal dashboard:sync broadcast below. null (cancelled)
        // just does nothing.
        if (region) {
          const { widgetId, displayId } = message
          activeRoom.dashboard = updateWidgetById(activeRoom.dashboard, widgetId, (w) =>
            w.type === 'screen-capture' ? { ...w, region, displayId } : w
          )
          saveDeckDashboard(activeRoom)
          broadcastToRoom(activeRoom, dashboardSyncMessage(activeRoom.dashboard))
        }
        break
      }
      case 'plugin:pick-region': {
        if (!activeRoom) break
        const region = await openRegionPicker(message.displayId)
        // Same no-dedicated-reply shape as screen-capture:pick-region above
        // — the picked region reaches every client via the normal
        // dashboard:sync broadcast below. null (cancelled) does nothing.
        // plugins is a flat array (unlike widgets, never nested in a
        // sub-deck), so this patches it directly rather than through
        // updateWidgetById.
        if (region) {
          const { sourceId, displayId } = message
          activeRoom.dashboard = {
            ...activeRoom.dashboard,
            plugins: (activeRoom.dashboard.plugins ?? []).map((s) =>
              s.id === sourceId ? { ...s, config: { ...s.config, region, displayId } } : s
            )
          }
          saveDeckDashboard(activeRoom)
          broadcastToRoom(activeRoom, dashboardSyncMessage(activeRoom.dashboard))
          // Unlike the widget case above, this config change needs to
          // restart the running producer (its signature just changed) so
          // the source starts ticking against the new region immediately,
          // not whenever the next unrelated dashboard:update happens to
          // arrive.
          syncPlugins(activeRoom)
        }
        break
      }
    }
  })
})

// Both genuinely process-wide (one DCS-BIOS connection for the whole app,
// not per-room), so pushed proactively to every room's clients on change —
// same "server pushes, client doesn't poll" pattern devices:sync already
// uses — rather than requiring a client to ask.
onDcsBiosStatusChange((status) => {
  const payload: ServerToClient = { type: 'dcsbios:status', ...status }
  for (const room of rooms.values()) broadcastToRoom(room, payload)
})
onDcsBiosStatsChange((stats) => {
  const payload: ServerToClient = { type: 'dcsbios:stats', ...stats }
  for (const room of rooms.values()) broadcastToRoom(room, payload)
})
onDcsViewportsStatusChange((status) => {
  const payload: ServerToClient = { type: 'dcsViewports:status', ...status }
  for (const room of rooms.values()) broadcastToRoom(room, payload)
})

// Keeps device:lag-report meaningful while a deck is idle — see
// ServerToClient's own comment on time:heartbeat for why dashboard:sync
// alone isn't enough. Re-stamped fresh on every tick (not a fixed payload
// hoisted outside) since serverTime has to be current each time it goes out.
// Goes through the same per-socket coalescing queue as everything else
// (queueSend, via broadcastToRoom) — if a connection is backed up enough
// that even THIS starts piling up, that itself is exactly the signal a
// growing lagMs should surface, same as a real dashboard:sync backlog would.
const HEARTBEAT_BROADCAST_MS = 2_000
setInterval(() => {
  for (const room of rooms.values()) broadcastToRoom(room, { type: 'time:heartbeat', serverTime: Date.now() })
}, HEARTBEAT_BROADCAST_MS)

// The "keyframe" backstop for variables:delta (see its own comment in
// shared/types.ts) — unconditional, unlike applyVariableUpdates' own
// broadcast, so it also self-heals a client that missed a delta for a
// reason unrelated to this app's own logic entirely (a dropped frame, a
// reconnect that raced a broadcast, whatever). Cheap to send unconditionally
// at this interval even for a dashboard with hundreds of variables — the
// whole point is trading a small periodic cost for never having to trust
// delta delivery as the only source of truth.
const VARIABLES_KEYFRAME_MS = 5_000
setInterval(() => {
  for (const room of rooms.values()) {
    broadcastToRoom(room, { type: 'variables:sync', variables: room.dashboard.variables ?? [] })
  }
}, VARIABLES_KEYFRAME_MS)


// This server also hosts the WS upgrade (`new WebSocketServer({ server:
// httpServer })` above) that every device's long-lived deck connection rides
// on. Node's http.Server has shipped a `requestTimeout` guard (default
// 300_000ms) since 14.11 to mitigate slow-header DoS attacks — it's meant to
// only bound the HTTP request/response cycle, but on a shared server like
// this one it was closing upgraded WebSocket sockets exactly 5 minutes after
// they connected, regardless of the ping/pong heartbeat still flowing (see
// HEARTBEAT_INTERVAL_MS above) — the reconnect masked it as a transient drop.
// Disabling it here only removes that guard for this app's own local/LAN
// server, not any public-facing one.
httpServer.requestTimeout = 0
httpServer.headersTimeout = 0

// A second instance's own bonjour-service advertisement and Chromium's GPU
// disk cache would otherwise both collide with the first instance's (over
// the same mDNS service name / userData directory respectively) and the app
// would just silently exit without saying why. Catching the port conflict
// up front gives a clear reason instead of limping into those errors.
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[boarderoni] Boarderoni is already running (port ${SERVER_PORT} is already in use).`)
    dialog.showErrorBox('Boarderoni is already running', `Another instance of Boarderoni is already using port ${SERVER_PORT}. Close it before starting a new one.`)
    app.exit(1)
    return
  }
  throw err
})

httpServer.listen(SERVER_PORT, () => {
  console.log(`[boarderoni] server listening on :${SERVER_PORT}`)
})

// One http.createServer per enabled RestDataSource, each on its own
// user-configured port — see restIncoming.ts. Re-run after every
// rest-sources:* mutation (see the ws switch above) to start/stop/restart
// listeners as sources are added/edited/removed.
syncRestIncomingServers(applyRestIncoming)

// Wraps the real triggerAction (which reports errors/subdeck-navigation
// replies through an ActionReplyTarget — normally a live WebSocket) into a
// version that collects those replies into an array instead, since an MCP
// tool call has no real client socket to target. See ActionReplyTarget's
// own comment above runActionStep for why a plain object with a .send
// method is enough to satisfy every call site in that chain unchanged.
async function mcpTriggerAction(room: DeckRoom, widgetId: string, event: WidgetEventKind, value: number | undefined, final: boolean): Promise<ServerToClient[]> {
  const replies: ServerToClient[] = []
  const sink: ActionReplyTarget = {
    send: (data) => {
      try {
        replies.push(JSON.parse(data) as ServerToClient)
      } catch {
        // Every real send site above only ever sends JSON.stringify'd
        // ServerToClient payloads — an unparseable one would be a bug
        // elsewhere, not something to crash an MCP tool call over.
      }
    }
  }
  await triggerAction(room, widgetId, event, sink, value, final)
  return replies
}

// send_action's own backing function — runs one ad-hoc WidgetAction straight
// through runActionStep, not runSequence/runSteps (there's no stored
// SequenceStep[] to walk and no widgetId/event to attach a SequenceStepError's
// path to). Same reply-collection sink as mcpTriggerAction above, for the
// same reason. trigger: undefined, final: true — the same values
// runGlobalActionPass passes for a global action's own steps, which have no
// originating widget press behind them either.
async function mcpRunAction(room: DeckRoom, action: WidgetAction): Promise<ServerToClient[]> {
  const replies: ServerToClient[] = []
  const sink: ActionReplyTarget = {
    send: (data) => {
      try {
        replies.push(JSON.parse(data) as ServerToClient)
      } catch {
        // See mcpTriggerAction's identical comment above.
      }
    }
  }
  await runActionStep(room, action, undefined, true, sink)
  return replies
}

// Renders a SequenceStepError's path as e.g. "step 2" or "step 0 > whenTrue >
// step 1" — only ever shown inside an MCP tool error message (send_actions
// has no widget/event to attach a structured action:error detail to, unlike
// runSequence's own sendError path), so a flat string is enough; no client
// needs to parse it back into a StepPath.
function formatStepPath(path: StepPath): string {
  return path.map((p) => (p.branch ? `step ${p.index} > ${p.branch}` : `step ${p.index}`)).join(' > ')
}

// send_actions' own backing function — runs an ad-hoc SequenceStep[] through
// the same runSteps engine a stored widget event/global action uses, so
// delay/condition steps behave identically (a real awaited setTimeout, not
// something the MCP client has to pace itself with external sleeps between
// separate send_action calls). Same reply-collection sink as mcpRunAction;
// on failure, reformats the thrown SequenceStepError's path into the message
// text since errorResult only ever surfaces err.message, not the structured
// path/stepKind runSequence's own sendError gets to attach.
async function mcpRunActions(room: DeckRoom, steps: SequenceStep[]): Promise<ServerToClient[]> {
  const replies: ServerToClient[] = []
  const sink: ActionReplyTarget = {
    send: (data) => {
      try {
        replies.push(JSON.parse(data) as ServerToClient)
      } catch {
        // See mcpTriggerAction's identical comment above.
      }
    }
  }
  try {
    await runSteps(room, steps, undefined, true, sink, [])
  } catch (err) {
    const stepErr = err as SequenceStepError
    throw new Error(`${formatStepPath(stepErr.path)} (${stepErr.stepKind}) failed: ${stepErr.message}`)
  }
  return replies
}

// Dependency-injection surface for the MCP server (see main/mcp/tools.ts's
// own comment on why it doesn't just import these from here directly).
// applyDashboardUpdate's excludeSocket param is omitted here on purpose —
// unlike a WS dashboard:update (which excludes the sender to avoid an
// unnecessary echo), an MCP-driven change has no originating socket, so
// every connected client (including any editor window open on this deck)
// should see the update.
// Which deck (if any) the desktop editor's own WS connection currently has
// open — role: 'edit' is always exactly one live socket (the editor window
// itself; see SocketContext's own comment), so this is the only reliable
// signal main/mcp/screenshot.ts's tools have for "is this deck actually on
// screen right now" without a dedicated IPC round trip. '' (lobby, no deck
// chosen) is returned as undefined, same "no deck" meaning as everywhere
// else this reads ctx.deckId.
function getEditorDeckId(): string | undefined {
  for (const ctx of socketContext.values()) {
    if (ctx.role === 'edit') return ctx.deckId || undefined
  }
  return undefined
}

// MCP's own create/update entry points for REST data sources — mirrors the
// rest-sources:create/update WS cases above (create/sync-listeners/
// broadcast, sanitize-then-persist) since main/mcp/tools.ts can't import
// syncRestIncomingServers's own applyRestIncoming callback directly (that's
// main/index.ts-local, same circular-require reasoning as every other McpDeps
// entry). Unlike rest-sources:update's own whole-array replace (the Settings
// panel always round-trips its full locally-edited draft), this is a single-
// source patch — more natural for a tool call, and it means an MCP client
// never needs to have first fetched every OTHER source just to touch one.
// bearerToken is deliberately not patchable here — rotating it has its own
// dedicated rest-sources:regenerate-token path, not exposed to MCP; keeping
// it out of a generic patch avoids a client accidentally clobbering it via
// an incomplete object.
function mcpCreateRestDataSource(name: string): RestDataSource {
  const source = createRestDataSource(name)
  syncRestIncomingServers(applyRestIncoming)
  broadcastRestSources()
  return source
}

function mcpUpdateRestDataSource(sourceId: string, patch: Record<string, unknown>): RestDataSource | null {
  const existing = getRestDataSources().find((s) => s.id === sourceId)
  if (!existing) return null
  const { name, enabled, port, targetDeckId, mappings } = patch as Partial<RestDataSource>
  const updated: RestDataSource = {
    ...existing,
    ...(name !== undefined && { name }),
    ...(enabled !== undefined && { enabled }),
    ...(port !== undefined && { port }),
    ...(targetDeckId !== undefined && { targetDeckId }),
    ...(mappings !== undefined && { mappings })
  }
  updateRestDataSources(getRestDataSources().map((s) => (s.id === sourceId ? updated : s)))
  syncRestIncomingServers(applyRestIncoming)
  broadcastRestSources()
  return updated
}

const mcpDeps: McpDeps = {
  getOrLoadRoom,
  listDeckSummaries,
  createDeck,
  renameDeck,
  applyVariableUpdates,
  applyDashboardUpdate: (room, dashboard, final) => applyDashboardUpdate(room, dashboard, final),
  applyAppSettingsPatch,
  triggerAction: mcpTriggerAction,
  runAction: mcpRunAction,
  runActions: mcpRunActions,
  getEditorWindow: () => editorWindow,
  getEditorDeckId,
  hideEditorWindow: () => {
    if (editorWindow) hideEditorToTray(editorWindow)
  },
  showEditorWindow: () => showEditorWindow(),
  createRestDataSource: mcpCreateRestDataSource,
  updateRestDataSource: mcpUpdateRestDataSource
}
syncMcpServer(mcpDeps)

// Backs MobileAppModal's clickable appUrl/APK links (see preload/index.ts) —
// restricted to http(s) so a compromised/malicious renderer content can't
// use this as a generic "run arbitrary shell integration" primitive (e.g.
// a file:// or custom protocol handler).
ipcMain.handle('open-external', (_event, url: string) => {
  if (!/^https?:\/\//i.test(url)) return
  shell.openExternal(url)
})

// Lets the Android app find this machine via NsdManager instead of a
// manually-typed IP — see MDNS_SERVICE_TYPE in shared/constants.ts for the
// TXT record contract.
//
// Without an errorCallback, bonjour-service's Server defaults to
// `(err) => { throw err }` for any failure responding to an mDNS query
// (see node_modules/bonjour-service/dist/lib/mdns-server.js) — e.g. an
// EHOSTUNREACH send on some network interface with no multicast route
// (a VPN/virtual adapter, or one that just dropped). That throw happens
// inside dgram's own async send callback, so it becomes an uncaught
// exception that crashes the main process instead of a caught error. Same
// "best-effort, auto-discovery is optional" reasoning as the try/catch
// around .publish() below — log and move on instead of crashing.
const bonjour = new Bonjour({}, (err) => console.error('[boarderoni] mDNS error', err))
const webPort = devServerUrl ? Number(new URL(devServerUrl).port) : SERVER_PORT
let mdnsService: Service | undefined
try {
  mdnsService = bonjour.publish({
    name: `Boarderoni (${hostname()})`,
    type: MDNS_SERVICE_TYPE,
    port: SERVER_PORT,
    // Android's NsdManager can non-deterministically resolve to an
    // advertised AAAA record over the A record, and a link-local IPv6
    // address (fe80::...) has no reachable route without a zone/scope id
    // — the phone silently fails to connect even though discovery
    // succeeded. Desktop-side LAN discovery has no need for IPv6 here.
    disableIPv6: true,
    txt: {
      webPort: String(webPort),
      dev: devServerUrl ? '1' : '0'
    }
  })
} catch (err) {
  // Best-effort — a machine with multicast disabled/firewalled just falls
  // back to no auto-discovery, the app itself still works fine.
  console.error('[boarderoni] mDNS advertisement failed to start', err)
}

// Set once an actual quit has been requested (tray "Quit", before-quit,
// etc.) so the editor window's own 'close' handler below knows to let the
// close through instead of hiding to tray.
let isQuitting = false

app.on('before-quit', () => {
  isQuitting = true
  mdnsService?.stop()
  bonjour.destroy()
  tray?.destroy()
})

try {
  keyboard.config.autoDelayMs = 0
} catch {
  // best-effort, not critical if the config surface differs across versions
}

let editorWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Hides the editor window without quitting — exactly what the 'close'
// handler below does when the user clicks the window's own X button
// (isQuitting stays false), factored out so the MCP hide_editor_window
// tool (see mcpDeps below) can trigger the identical behavior on request,
// not a slightly different one that's easy to let drift out of sync.
function hideEditorToTray(win: BrowserWindow): void {
  win.hide()
  // Windows-only (Tray.displayBalloon is a no-op elsewhere) — the app has
  // no other indicator that the window didn't quit, whether it was hidden
  // by the user's own click or an MCP tool call.
  tray?.displayBalloon({
    title: 'Boarderoni is still running',
    content: 'The server keeps running in the background. Use the tray icon to reopen the editor or quit.',
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.ico'))
  })
}

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
}

function loadWindowState(): WindowState {
  try {
    if (existsSync(windowStateFile)) {
      return JSON.parse(readFileSync(windowStateFile, 'utf-8')) as WindowState
    }
  } catch (err) {
    console.error('[boarderoni] failed to load saved window state, using default', err)
  }
  return { width: 1280, height: 800 }
}

function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getBounds()
  mkdirSync(join(app.getPath('userData')), { recursive: true })
  writeFileSync(windowStateFile, JSON.stringify(bounds), 'utf-8')
}

// Menu.setApplicationMenu(null) below (app.whenReady) drops Electron's
// default File/Edit/View/Window menu bar entirely — removing it also
// silently drops its accelerators, so the handful actually worth keeping
// (DevTools, reload, zoom, fullscreen — "general Electron stuff") are
// reimplemented here via a raw before-input-event listener instead.
function registerWindowShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if ((input.control && input.shift && key === 'i') || key === 'f12') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    } else if ((input.control && input.shift && key === 'r') || (input.shift && key === 'f5')) {
      win.webContents.reloadIgnoringCache()
      event.preventDefault()
    } else if ((input.control && key === 'r') || key === 'f5') {
      win.webContents.reload()
      event.preventDefault()
    } else if (input.control && (key === '=' || key === '+')) {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5)
      event.preventDefault()
    } else if (input.control && key === '-') {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5)
      event.preventDefault()
    } else if (input.control && key === '0') {
      win.webContents.setZoomLevel(0)
      event.preventDefault()
    } else if (key === 'f11') {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
    }
  })
}

function createEditorWindow(): void {
  const state = loadWindowState()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Already Electron's own defaults as of the version this app pins
      // (electron ^43) — set explicitly anyway so this window's security
      // posture is legible here rather than resting on "whatever today's
      // default happens to be," and survives an Electron upgrade that
      // might change one. nodeIntegration:false + contextIsolation:true is
      // what makes it safe for this window's renderer to run its own
      // un-sandboxed `new Function`-based expression evaluator (shared/
      // expr.ts) at all — there's no Node global for it to reach regardless
      // of eval mechanism, unlike the main process (see sandboxedExpr.ts's
      // own comment for why THAT one needed an actual fix, not just this).
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // A PlaySoundAction targeting 'server' plays through THIS window's
      // renderer (see sendSoundToDesktop), and it routinely fires with
      // nobody having touched the window — a global action reacting to a
      // variable, or a press on a tablet across the room. Chromium's
      // default policy refuses playback until the document has had a user
      // gesture, which would silently drop exactly those cases. Safe here
      // in a way it wouldn't be on the open web: this window only ever
      // loads this app's own renderer.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  editorWindow = win
  win.on('closed', () => {
    if (editorWindow === win) editorWindow = null
  })

  // This app has no legitimate use for a popup/new window — the one real
  // external-link path (MobileAppModal's browser link) already goes
  // through the openExternal IPC handler below, which opens in the
  // SYSTEM browser, not a new BrowserWindow, and is itself restricted to
  // https?://. Denying window.open()/target="_blank" outright removes an
  // otherwise-open surface for a future dependency bug or any injected
  // content to pop an arbitrary window sharing this app's own
  // webPreferences.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Restricts IN-WINDOW navigation — the same class of risk
  // setWindowOpenHandler above closes for "open a new window," for
  // "navigate this existing one" instead. file: is always allowed since
  // this window only ever loads its own bundled files that way (a
  // packaged build's rendererDist) — nothing untrusted is ever given a
  // chance to construct a navigable file:// URL in the first place, so a
  // same-protocol check is enough without needing an exact path match.
  // devServerUrl's own origin is allowed too, specifically so Vite's own
  // occasional full-reload-instead-of-HMR-patch fallback in dev still
  // works — that's a same-origin `will-navigate` event too, not something
  // this should start breaking. Anything else (a remote http(s) origin
  // this window was never pointed at) gets blocked.
  // The app's own origin now, not Vite's — the dev window loads through the
  // proxy (see createEditorWindow below), so a full-reload fallback comes
  // back to SERVER_PORT rather than to Vite's port.
  const devServerOrigin = devServerUrl ? `http://localhost:${SERVER_PORT}` : null
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (target.protocol === 'file:') return
    if (devServerOrigin && target.origin === devServerOrigin) return
    event.preventDefault()
  })

  let saveTimeout: NodeJS.Timeout | null = null
  function scheduleSaveWindowState(): void {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => saveWindowState(win), 500)
  }
  win.on('resize', scheduleSaveWindowState)
  win.on('move', scheduleSaveWindowState)
  win.on('close', (event) => {
    saveWindowState(win)
    // The server (and any connected deployed views) should keep running
    // unattended after the editor window closes — only an explicit Quit
    // (tray menu / before-quit) should actually end the process.
    if (isQuitting) return
    event.preventDefault()
    hideEditorToTray(win)
  })

  registerWindowShortcuts(win)

  // Renderer console output (including ErrorBoundary's componentDidCatch
  // logs) otherwise only reaches DevTools, invisible from the terminal
  // running electron-vite dev — relay it here so a renderer crash is
  // diagnosable without opening DevTools by hand.
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message}`)
  })

  if (devServerUrl) {
    // Our own server, not Vite's, even in dev — it proxies through to Vite
    // (see proxyRequestToDevServer), so the editor window sits on the same
    // origin as the API exactly as a deployed view client does.
    win.loadURL(`http://localhost:${SERVER_PORT}/?mode=edit&version=${encodeURIComponent(app.getVersion())}`)
  } else {
    win.loadFile(join(rendererDist, 'index.html'), { query: { mode: 'edit', version: app.getVersion() } })
  }
}

function showEditorWindow(): void {
  if (!editorWindow) {
    createEditorWindow()
    return
  }
  if (editorWindow.isMinimized()) editorWindow.restore()
  editorWindow.show()
  editorWindow.focus()
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.ico'))
  tray = new Tray(icon)
  tray.setToolTip('Boarderoni')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show editor', click: () => showEditorWindow() },
      { label: 'Check for updates', click: () => checkForUpdates(true) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          // Tray Quit is the only path that actually ends the process (see
          // window-all-closed's own comment) — confirm since it stops the
          // server and disconnects every deployed view, which is easy to
          // trigger by accident from a tray right-click.
          const result = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['Quit', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Quit Boarderoni?',
            message: 'Quit Boarderoni?',
            detail: 'This stops the server — any connected deployed views will disconnect.'
          })
          if (result !== 0) return
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => showEditorWindow())
}

app.whenReady().then(() => {
  // Drops the default File/Edit/View/Window menu bar — see
  // registerWindowShortcuts above for the accelerators this would otherwise
  // take with it.
  Menu.setApplicationMenu(null)

  createEditorWindow()
  createTray()

  // Silent, automatic check — only surfaces UI once a download actually
  // completes (see autoUpdate.ts's update-downloaded handler). No-ops
  // harmlessly outside a packaged build (no app-update.yml to read).
  checkForUpdates(false)

  app.on('activate', () => {
    showEditorWindow()
  })

  // dcsViewports is a core plugin (see shared/plugins/dcsViewports.ts) with
  // no per-dashboard instances — same reasoning as REST elsewhere in this
  // file, this re-checks the driver/virtual-display and rewrites
  // Boarderoni.lua once at startup if already enabled from a previous
  // session, so it's ready before any dashboard loads (an app restart
  // doesn't otherwise re-trigger the false->true transition the
  // app-settings:update handler reacts to). Needs `screen`, hence deferred
  // until here rather than running at module load like the rest of this
  // file's other startup wiring.
  if (getAppSettings().enabledPlugins.includes('dcsViewports')) {
    void refreshDcsViewportsStatus().catch((err: unknown) => {
      console.error('[boarderoni] dcsViewports startup refresh failed', err)
    })
  }

  // Windows fires 'display-metrics-changed' for resolution/orientation/
  // arrangement changes and 'display-added'/'display-removed' for
  // monitors (including the virtual one) coming and going — any of which
  // can invalidate the bounds baked into Boarderoni.lua (see
  // dcsViewports/index.ts's refreshStatus). Debounced since Windows can
  // fire several of these in a burst for one physical change.
  let dcsViewportsDisplayChangeTimer: NodeJS.Timeout | null = null
  function scheduleDcsViewportsDisplayRefresh(): void {
    if (!getAppSettings().enabledPlugins.includes('dcsViewports')) return
    if (dcsViewportsDisplayChangeTimer) clearTimeout(dcsViewportsDisplayChangeTimer)
    dcsViewportsDisplayChangeTimer = setTimeout(() => {
      dcsViewportsDisplayChangeTimer = null
      void refreshDcsViewportsStatus().catch((err: unknown) => {
        console.error('[boarderoni] dcsViewports display-change refresh failed', err)
      })
    }, 1000)
  }
  screen.on('display-metrics-changed', scheduleDcsViewportsDisplayRefresh)
  screen.on('display-added', scheduleDcsViewportsDisplayRefresh)
  screen.on('display-removed', scheduleDcsViewportsDisplayRefresh)
})

// The editor window hides to tray instead of actually closing (see its own
// 'close' handler above), so this fires only in edge cases (e.g. the window
// was destroyed some other way) — deliberately a no-op, since normal
// quitting now goes through the tray's "Quit" item / before-quit instead.
app.on('window-all-closed', () => {})
