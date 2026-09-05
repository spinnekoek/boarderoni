import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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
import { Bonjour, type Service } from 'bonjour-service'
import { z } from 'zod'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN, DECK_CLOSE_CODE_DENIED, MDNS_SERVICE_TYPE, DCS_COMMAND_VALUE_SHORTHAND } from '../shared/constants'
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
  type Plugin,
  type KeypressAction,
  type RockerSwitchWidget,
  type ScreenRegion,
  type SendDcsCommandAction,
  type SequenceStep,
  type ServerToClient,
  type SwitchPosition,
  type Variable,
  type VariableValue,
  type Widget,
  type WidgetAction,
  type WidgetEventKind
} from '../shared/types'
import { getEventSteps } from '../shared/widgetEvents'
import { FONT_MIME_BY_EXTENSION, fontExtension } from '../shared/fonts'
import { findSubDeck, findWidgetAnywhere, allDeckWidgets } from '../shared/subDecks'
import { toVariableMap, tryEvaluateExpression, evaluateMappingExpression, setExpressionConsoleSink, stringifyExpressionLogArgs } from '../shared/expr'
import { extractPlaceholders } from '../shared/restPlaceholders'
import { PLUGIN_PRODUCERS } from './plugins'
import { listDisplays, openRegionPicker, captureRegionJpeg, clampFps, clampQuality, addMjpegViewer } from './screenCapture'
import { getAppSettings, updateAppSettings } from './appSettings'
import { getCustomFonts, addCustomFont, deleteCustomFont, updateCustomFontLineHeight, customFontFile } from './customFonts'
import { getRestDataSources, updateRestDataSources, createRestDataSource, regenerateRestDataSourceToken } from './restDataSources'
import { syncRestIncomingServers, getRestListenStatus } from './restIncoming'
import { isDeviceApproved, approveDevice, revokeDevice, renameApprovedDevice, listApprovedDevices } from './deviceApproval'
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
  if (widget.type === 'gauge') return widget
  if ('events' in widget && widget.events) return widget // already migrated
  if (!widget.action) return widget // tolerate a malformed widget with neither shape

  const step: ActionStep = { kind: 'action', id: randomUUID(), action: widget.action }
  const { action: _action, ...rest } = widget

  if (widget.type === 'adjuster') {
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

function migrateWidget(widget: Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget): Widget {
  widget = migrateWidgetEvents(widget) as Widget & LegacyButtonWidget & LegacyActionWidget
  widget = migrateSwitchWidget(widget) as Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget

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
    widget.type === 'gauge' ||
    widget.type === 'adjuster' ||
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
const APK_PATH = join(__dirname, '../../dist/boarderoni-latest.apk')

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

interface DeckRoom {
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
  // Known once the socket's first 'hello' arrives — undefined briefly
  // between raw connect and that first message. Drives both which sockets
  // get a device:approval-requested broadcast and which get gated on
  // approval before receiving dashboard/deck-list content — see
  // isTrustedSocket.
  role?: 'edit' | 'view'
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
    fileWatcher: null
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
// feature): a CallRestAction pointing at a REST data source id that only
// ever existed in the exporting machine's own rest-data-sources.json (never
// part of the export — see RestDataSource's own "NOT per-Dashboard" comment
// in shared/types.ts), and a ScreenCaptureWidget's region, which is
// absolute virtual-desktop pixel coordinates tied to the exporting
// machine's own monitor layout. Neither of these crashes anything — they
// just silently do the wrong thing — so this doesn't block the import, it
// just tells the user what to go re-link/re-pick afterward.
function collectImportWarnings(dashboard: Dashboard): string[] {
  const dataSourceIds = new Set(getRestDataSources().map((s) => s.id))
  const warnings: string[] = []
  for (const widget of allDeckWidgets(dashboard)) {
    for (const step of sequenceStepsForWidget(widget)) {
      if (step.kind === 'action' && step.action.kind === 'call-rest' && !dataSourceIds.has(step.action.dataSourceId)) {
        warnings.push(`A ${widget.type} widget references a REST data source that doesn't exist on this machine — re-link it after import.`)
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
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
  backgroundImage: z.object({ mime: z.string(), dataBase64: z.string() }).optional()
})

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
    const id = randomUUID()
    const dashboard: Dashboard = { ...structuredClone(DEFAULT_DASHBOARD), id, name }
    mkdirSync(deckDir(id), { recursive: true })
    writeFileSync(deckDashboardFile(id), JSON.stringify(dashboard, null, 2), 'utf-8')
    sendJson(res, 201, { id, name } satisfies DeckSummary)
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
      backgroundImage
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
    sendJson(res, 200, { ok: true })
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
    writeFileSync(deckDashboardFile(id), JSON.stringify(dashboard, null, 2), 'utf-8')
    const warnings = collectImportWarnings(dashboard)
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
    sendJson(res, 200, { id: deckId, name } satisfies DeckSummary)
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
    sendJson(res, 204)
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/background-image') {
    serveBackgroundImage(res, url.searchParams.get('deck') ?? '')
    return
  }

  if (url.pathname.startsWith('/fonts/')) {
    serveCustomFont(res, url.pathname.slice('/fonts/'.length))
    return
  }

  if (url.pathname === '/screen-capture/frame') {
    serveScreenCaptureFrame(res, url.searchParams.get('deck') ?? '', url.searchParams.get('widget') ?? '')
    return
  }

  if (url.pathname === '/screen-capture/stream') {
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
    const available = existsSync(APK_PATH)
    sendJson(res, 200, {
      available,
      url: available && lanAddress ? `http://${lanAddress}:${SERVER_PORT}/download/apk` : null,
      appUrl: lanAddress ? `http://${lanAddress}:${webPort}/?mode=view` : null
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
    handleDecksApi(req, res, url).catch((err) => {
      console.error('[boarderoni] /api/decks error', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' })
    })
    return
  }

  if (devServerUrl) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('boarderoni dev server: WS only in dev mode, run "npm run build && npm start" to serve the dashboard UI')
    return
  }
  serveStatic(req, res)
})

const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

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
  return ctx.role === 'edit' || (ctx.role === 'view' && ctx.deviceId !== undefined && isDeviceApproved(ctx.deviceId))
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

function broadcastToRoom(room: DeckRoom, message: ServerToClient, exclude?: WebSocket): void {
  const payload = JSON.stringify(message)
  for (const client of room.sockets) {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      queueSend(client, message.type, payload)
    }
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
  broadcastToEditClients(logRoom, { type: 'action:log', message: stringifyExpressionLogArgs(args) })
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

// Posts a CallRestAction's target RestDataSource's outgoing payload — same
// variables-in-scope/$value-while-dragging convention as runSendDcsCommand
// above, just resolving N named placeholders instead of one argument. Uses
// the runtime's global fetch — this app's first outbound HTTP request
// anywhere; everything else here only ever serves requests.
async function runCallRestAction(room: DeckRoom, action: CallRestAction, trigger?: TriggerValue): Promise<void> {
  const source = getRestDataSources().find((s) => s.id === action.dataSourceId)
  if (!source || !source.enabled) {
    throw new Error('This REST data source is disabled or no longer exists')
  }

  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  let payloadText = source.outgoing.payloadTemplate
  for (const name of extractPlaceholders(payloadText)) {
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
    payloadText = payloadText.replaceAll(`{{${name}}}`, JSON.stringify(resolved))
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('Outgoing payload template is not valid JSON once placeholders are filled in')
  }

  const res = await fetch(source.outgoing.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
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
  const room = getOrLoadRoom(source.incoming.targetDeckId)
  if (!room) return

  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  const updates: Record<string, unknown> = {}
  for (const mapping of source.incoming.mappings) {
    if (!mapping.variableName.trim() || !(mapping.field in flattened)) continue
    const rawValue = flattened[mapping.field]
    if (mapping.expr && mapping.expr.trim()) {
      const result = evaluateMappingExpression(mapping.expr, coerceVariableValue(rawValue), variableMap)
      if (!result.ok) {
        console.error(`[boarderoni] REST incoming mapping expression failed (${source.name} -> ${mapping.variableName})`, result.error)
        continue
      }
      updates[mapping.variableName] = result.value
    } else {
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
          if (!mapping.variableName.trim() || !(mapping.field in values)) continue
          const rawValue = values[mapping.field]
          // Skip a mapping whose underlying field is unchanged since the
          // last tick — an expression is only re-run when there's an
          // actual new raw value to feed it, not on every tick regardless.
          if (rawValue === previousValues[mapping.field]) continue
          if (mapping.expr && mapping.expr.trim()) {
            const result = evaluateMappingExpression(mapping.expr, coerceVariableValue(rawValue), variableMap)
            if (!result.ok) {
              console.error(`[boarderoni] plugin mapping expression failed (${current.name} -> ${mapping.variableName})`, result.error)
              continue
            }
            updates[mapping.variableName] = result.value
          } else {
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
  if (mode !== 'up') await keyboard.pressKey(...keys)
  if (mode !== 'down') await keyboard.releaseKey(...keys)
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
async function runActionStep(room: DeckRoom, action: WidgetAction, trigger: TriggerValue | undefined, final: boolean, ws: WebSocket): Promise<void> {
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
async function runSequence(
  room: DeckRoom,
  steps: SequenceStep[],
  trigger: TriggerValue | undefined,
  final: boolean,
  ws: WebSocket,
  widgetId: string,
  event: WidgetEventKind
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    try {
      if (step.kind === 'delay') {
        await sleep(step.delayMs)
      } else {
        await runActionStep(room, step.action, trigger, final, ws)
      }
    } catch (err) {
      sendError(ws, widgetId, err instanceof Error ? err.message : String(err), { event, stepIndex: i, stepKind: step.kind })
      return
    }
  }
}

async function triggerAction(
  room: DeckRoom,
  widgetId: string,
  event: WidgetEventKind,
  ws: WebSocket,
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
  if (widget.type === 'gauge' || widget.type === 'screen-capture' || widget.type === 'label') {
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
  ws: WebSocket,
  widgetId: string,
  message: string,
  detail?: { event: WidgetEventKind; stepIndex: number; stepKind: SequenceStep['kind'] }
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

  socketContext.set(ws, { deckId: room?.id ?? '' })
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
        activeRoom.dashboard = message.dashboard
        // Same immediate/debounced split as applyVariableUpdates — an
        // in-flight drag tick (final: false) must not do a blocking
        // full-dashboard writeFileSync on every frame; the drag's own final
        // tick (or any one-off edit) still saves synchronously so nothing's
        // lost if the app closes right after.
        if (message.final ?? true) {
          cancelScheduledSave(activeRoom)
          saveDeckDashboard(activeRoom)
        } else {
          scheduleDebouncedSave(activeRoom)
        }
        broadcastToRoom(activeRoom, dashboardSyncMessage(activeRoom.dashboard), ws)
        syncPlugins(activeRoom)
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
          // The editor's own window — always trusted, no approval gate.
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
            if (isDeviceApproved(message.deviceId)) {
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
        {
          const info = pendingDeviceInfo.get(message.deviceId)
          approveDevice(message.deviceId, info ? displayDeviceName(info) : message.deviceId)
          pendingDeviceInfo.delete(message.deviceId)
        }
        for (const [sock, sctx] of socketContext) {
          if (sctx.deviceId !== message.deviceId || sock.readyState !== WebSocket.OPEN) continue
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
        const wasDcsViewportsEnabled = getAppSettings().enabledPlugins.includes('dcsViewports')
        const settings = updateAppSettings({ enabledPlugins: message.enabledPlugins })
        ws.send(JSON.stringify({ type: 'app-settings:settings', ...settings } satisfies ServerToClient))
        // Toggling a kind takes effect immediately, not just on the next
        // unrelated dashboard:update — see resyncAllRoomsPlugins. REST is a
        // core plugin (see shared/plugins/rest.ts) with no per-dashboard
        // instances for resyncAllRoomsPlugins to iterate, so its own master
        // switch needs this separate call instead.
        resyncAllRoomsPlugins()
        syncRestIncomingServers(applyRestIncoming)
        // dcsViewports is also core, same reasoning — only react on the
        // false->true edge: disabling deliberately leaves the virtual
        // display and Boarderoni.lua in place (harmless, no elevation
        // needed to leave them alone) rather than tearing anything down.
        const isDcsViewportsEnabled = settings.enabledPlugins.includes('dcsViewports')
        if (isDcsViewportsEnabled && !wasDcsViewportsEnabled) {
          void refreshDcsViewportsStatus().catch((err: unknown) => {
            console.error('[boarderoni] dcsViewports enable-time refresh failed', err)
          })
        }
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
        const sanitized = message.sources.map(({ id, name, enabled, incoming, outgoing }) => ({ id, name, enabled, incoming, outgoing }))
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

httpServer.listen(SERVER_PORT, () => {
  console.log(`[boarderoni] server listening on :${SERVER_PORT}`)
})

// One http.createServer per enabled RestDataSource, each on its own
// user-configured port — see restIncoming.ts. Re-run after every
// rest-sources:* mutation (see the ws switch above) to start/stop/restart
// listeners as sources are added/edited/removed.
syncRestIncomingServers(applyRestIncoming)

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

app.on('before-quit', () => {
  mdnsService?.stop()
  bonjour.destroy()
})

try {
  keyboard.config.autoDelayMs = 0
} catch {
  // best-effort, not critical if the config surface differs across versions
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

function createEditorWindow(): void {
  const state = loadWindowState()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  let saveTimeout: NodeJS.Timeout | null = null
  function scheduleSaveWindowState(): void {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => saveWindowState(win), 500)
  }
  win.on('resize', scheduleSaveWindowState)
  win.on('move', scheduleSaveWindowState)
  win.on('close', () => saveWindowState(win))

  // Renderer console output (including ErrorBoundary's componentDidCatch
  // logs) otherwise only reaches DevTools, invisible from the terminal
  // running electron-vite dev — relay it here so a renderer crash is
  // diagnosable without opening DevTools by hand.
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message}`)
  })

  if (devServerUrl) {
    win.loadURL(`${devServerUrl}?mode=edit`)
  } else {
    win.loadFile(join(rendererDist, 'index.html'), { query: { mode: 'edit' } })
  }
}

app.whenReady().then(() => {
  createEditorWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createEditorWindow()
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
