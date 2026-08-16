import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
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
  statSync
} from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import { Bonjour, type Service } from 'bonjour-service'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN, DECK_CLOSE_CODE_DENIED, MDNS_SERVICE_TYPE } from '../shared/constants'
import {
  DEFAULT_DASHBOARD,
  type ActionStep,
  type ButtonWidget,
  type CallRestAction,
  type ClientToServer,
  type Dashboard,
  type DeckSummary,
  type DeviceInfo,
  type DialSwitchWidget,
  type DropdownWidget,
  type ToggleSwitchWidget,
  type EventSource,
  type KeypressAction,
  type RockerSwitchWidget,
  type ScreenCaptureWidget,
  type ScreenRegion,
  type SendDcsCommandAction,
  type SequenceStep,
  type ServerToClient,
  type Variable,
  type VariableValue,
  type Widget,
  type WidgetAction,
  type WidgetEventKind
} from '../shared/types'
import { getEventSteps } from '../shared/widgetEvents'
import { findSubDeck, findWidgetAnywhere } from '../shared/subDecks'
import { toVariableMap, tryEvaluateExpression, evaluateMappingExpression } from '../shared/expr'
import { extractPlaceholders } from '../shared/restPlaceholders'
import { EVENT_SOURCE_PRODUCERS } from './eventSourceProducers'
import { listDisplays, openRegionPicker, captureRegionJpeg, clampFps, clampQuality, addMjpegViewer } from './screenCapture'
import { getAppSettings, updateAppSettings } from './appSettings'
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
// before that needs the field backfilled, same as `variables`/`eventSources`
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

function migrateWidget(widget: Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget): Widget {
  widget = migrateWidgetEvents(widget) as Widget & LegacyButtonWidget & LegacyActionWidget
  widget = migrateSwitchWidget(widget) as Widget & LegacyButtonWidget & LegacyActionWidget & LegacySwitchWidget

  // Dropdown has its own narrower orientation migration too (see
  // migrateDropdownOrientation) alongside the events backfill every switch
  // type below also gets.
  if (widget.type === 'dropdown') return migrateSwitchWidgetPositionChangeEvents(migrateDropdownOrientation(widget))

  if (widget.type === 'switch-dial') {
    return migrateDialSwitchIncrementDecrement(
      migrateSwitchWidgetPositionChangeEvents(
        migrateSwitchWidgetTopLevelLabels(migrateDialSwitchLabelAnchor(widget as DialSwitchWidget & LegacyDialSwitchWidget))
      )
    )
  }

  if (widget.type === 'switch-toggle') return migrateSwitchWidgetPositionChangeEvents(migrateSwitchWidgetTopLevelLabels(widget))

  if (widget.type === 'switch-rocker') return migrateSwitchWidgetPositionChangeEvents(migrateSwitchWidgetTopLevelLabels(widget))

  // Morph/gauge/adjuster/encoder/screen-capture widgets never existed in any
  // of the legacy shapes below — they're always created with their current
  // shape from the start (morph with states[]/blocks[], the rest with no
  // states[] at all, screen-capture with no labels concept at all).
  if (widget.type === 'morph' || widget.type === 'gauge' || widget.type === 'adjuster' || widget.type === 'encoder' || widget.type === 'screen-capture') {
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

  if (!Array.isArray(widget.states)) {
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

function loadDeckDashboard(deckId: string): Dashboard | null {
  try {
    const file = deckDashboardFile(deckId)
    if (!existsSync(file)) return null
    const loaded = JSON.parse(readFileSync(file, 'utf-8')) as Dashboard & { backgroundImage?: string }
    // Migrate off the old shape, which embedded the image as a data URL
    // directly in the dashboard JSON (re-sent over the WebSocket on every
    // single change — see backgroundImageVersion in shared/types.ts).
    delete loaded.backgroundImage
    loaded.widgets = loaded.widgets.map(migrateWidget)
    // Dashboards saved before Variable existed have no `variables` key at
    // all — normalize once here so nothing downstream needs `?? []`.
    loaded.variables = loaded.variables ?? []
    loaded.eventSources = loaded.eventSources ?? []
    // Same normalization for sub-decks, saved before SubDeck existed — and
    // each sub-deck's own widgets need the same migrateWidget treatment the
    // main deck's widgets just got above.
    loaded.subDecks = (loaded.subDecks ?? []).map((sd) => ({ ...sd, widgets: sd.widgets.map(migrateWidget) }))
    return loaded
  } catch (err) {
    // A single corrupted deck must not take down the picker list or the app —
    // log and treat it as absent rather than throwing.
    console.error(`[boarderoni] failed to load deck ${deckId}, treating as missing`, err)
    return null
  }
}

function saveDeckDashboard(room: DeckRoom): void {
  mkdirSync(deckDir(room.id), { recursive: true })
  writeFileSync(deckDashboardFile(room.id), JSON.stringify(room.dashboard, null, 2), 'utf-8')
}

const DASHBOARD_SAVE_DEBOUNCE_MS = 500

// Debounced counterpart to saveDeckDashboard — used for saves that repeat on
// a tight cadence (event-source ticks, as often as once a second) rather
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
      const loaded = JSON.parse(readFileSync(legacyDashboardFile, 'utf-8')) as Dashboard & { backgroundImage?: string }
      delete loaded.backgroundImage
      loaded.widgets = loaded.widgets.map(migrateWidget)
      loaded.variables = loaded.variables ?? []
      loaded.eventSources = loaded.eventSources ?? []
      loaded.subDecks = (loaded.subDecks ?? []).map((sd) => ({ ...sd, widgets: sd.widgets.map(migrateWidget) }))
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

// Shared by both routes below — a screen-capture widget with no region
// picked yet (or one that's been deleted since a client last saw it) has
// nothing to serve.
function findScreenCaptureWidget(room: DeckRoom, widgetId: string): (ScreenCaptureWidget & { region: ScreenRegion; displayId: number }) | null {
  const widget = findWidgetAnywhere(room.dashboard, widgetId)
  if (!widget || widget.type !== 'screen-capture' || !widget.region || widget.displayId === undefined) return null
  return widget as ScreenCaptureWidget & { region: ScreenRegion; displayId: number }
}

// Poll mode — one capture per request, fully stateless (see
// ScreenCaptureWidget.streamMode in shared/types.ts).
function serveScreenCaptureFrame(res: ServerResponse, deckId: string, widgetId: string): void {
  const room = getOrLoadRoom(deckId)
  const widget = room && findScreenCaptureWidget(room, widgetId)
  if (!widget) {
    res.writeHead(404)
    res.end('No region configured')
    return
  }
  captureRegionJpeg(widget.region, widget.displayId, clampQuality(widget.quality), widget.sharpen ?? false)
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
  const widget = room && findScreenCaptureWidget(room, widgetId)
  if (!widget) {
    res.writeHead(404)
    res.end('No region configured')
    return
  }
  addMjpegViewer(widgetId, res, () => {
    const current = room && findScreenCaptureWidget(room, widgetId)
    return current
      ? { region: current.region, displayId: current.displayId, quality: clampQuality(current.quality), sharpen: current.sharpen ?? false, fps: clampFps(current.fps) }
      : null
  })
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
  // Running event-source producers for this room, keyed by EventSource.id.
  // `signature` is `JSON.stringify({kind, config})` of the instance that's
  // currently running — see syncEventSources, which restarts a producer
  // whenever this changes (mappings are excluded on purpose: they're
  // re-read fresh on every tick, so editing them never needs a restart).
  eventSourceStops: Map<string, { stop: () => void; signature: string }>
  // Debounce handle for saveDeckDashboard — see scheduleDebouncedSave. Event
  // source ticks (as often as once a second) go through this instead of
  // saving synchronously on every tick.
  dashboardSaveTimeout: NodeJS.Timeout | null
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
  const room: DeckRoom = {
    id: deckId,
    dashboard,
    devices: new Map(),
    sockets: new Set(),
    eventSourceStops: new Map(),
    dashboardSaveTimeout: null
  }
  rooms.set(deckId, room)
  syncEventSources(room)
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

async function handleDecksApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const idMatch = /^\/api\/decks\/([^/]+)$/.exec(url.pathname)

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
      broadcastToRoom(room, { type: 'dashboard:sync', dashboard: room.dashboard })
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
      for (const { stop } of room.eventSourceStops.values()) stop()
      // Load-bearing, not decorative: a pending debounced save from an
      // active event source firing ~500ms after this point would recreate
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

function sendInitialState(ws: WebSocket, room: DeckRoom): void {
  ws.send(JSON.stringify({ type: 'dashboard:sync', dashboard: room.dashboard } satisfies ServerToClient))
  ws.send(JSON.stringify({ type: 'devices:sync', devices: Array.from(room.devices.values()) } satisfies ServerToClient))
  ws.send(JSON.stringify({ type: 'dcsbios:status', ...getDcsBiosStatus() } satisfies ServerToClient))
  const stats = getDcsBiosWorkerStats()
  if (stats) ws.send(JSON.stringify({ type: 'dcsbios:stats', ...stats } satisfies ServerToClient))
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

function broadcastToRoom(room: DeckRoom, message: ServerToClient, exclude?: WebSocket): void {
  const payload = JSON.stringify(message)
  for (const client of room.sockets) {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      client.send(payload)
    }
  }
}

function broadcastDevices(room: DeckRoom): void {
  broadcastToRoom(room, { type: 'devices:sync', devices: Array.from(room.devices.values()) })
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
// extracted; `immediate: false` (event-source ticks, via syncEventSources)
// debounces instead — see scheduleDebouncedSave.
function applyVariableUpdates(room: DeckRoom, updates: Record<string, unknown>, options: { immediate: boolean }): void {
  const existing = room.dashboard.variables ?? []
  const existingNames = new Set(existing.map((v) => v.name))
  const variables: Variable[] = existing.map((v) => (v.name in updates ? { ...v, value: coerceVariableValue(updates[v.name]) } : v))
  for (const [name, value] of Object.entries(updates)) {
    if (!existingNames.has(name)) variables.push({ id: randomUUID(), name, value: coerceVariableValue(value) })
  }

  room.dashboard = { ...room.dashboard, variables }
  // variables:sync, not dashboard:sync — this can fire many times a second
  // (every in-flight AdjusterWidget drag tick, or a fast event-source), and
  // widgets/eventSources/devices never change here, so re-sending the whole
  // dashboard every time would mean every connected client re-serializing
  // and re-diffing all of that for nothing.
  broadcastToRoom(room, { type: 'variables:sync', variables })
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
// which one actually fired it (see triggerAction below).
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

// Evaluates an update-state action's code and merges whatever it returns
// into the room's dashboard.variables. Runs server-side (not per-client) so
// every client's next dashboard:sync already reflects the result, same as
// any other mutation.
function runUpdateState(room: DeckRoom, code: string, trigger: TriggerValue | undefined, final: boolean): void {
  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  // trigger is only set while an AdjusterWidget is being dragged, or for a
  // switch/dropdown position select — exposed as variables.$value (plus
  // variables.$index for a position select), same convention an
  // EventSourceMapping's own `expr` already uses (see
  // evaluateMappingExpression). A plain button/morph click
  // has no value, so it evaluates exactly as before.
  const result = trigger ? evaluateMappingExpression(code, trigger.value, variableMap, trigger.index) : tryEvaluateExpression(code, variableMap)
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
  // Same enabledDataSources gate syncEventSources already applies to the
  // read side (see its own comment) — disabling DCS-BIOS in Settings should
  // stop a button from firing commands too, not just stop reading fields.
  if (!getAppSettings().enabledDataSources.includes('dcsbios')) {
    throw new Error('DCS-BIOS is disabled in Settings')
  }

  let argument = action.argument
  if (action.argumentExpr && action.argumentExpr.trim()) {
    const variableMap = toVariableMap(room.dashboard.variables ?? [])
    const result = trigger
      ? evaluateMappingExpression(action.argumentExpr, trigger.value, variableMap, trigger.index)
      : tryEvaluateExpression(action.argumentExpr, variableMap)
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
    if (entry?.expr && entry.expr.trim()) {
      const result = trigger
        ? evaluateMappingExpression(entry.expr, trigger.value, variableMap, trigger.index)
        : tryEvaluateExpression(entry.expr, variableMap)
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
// deck. Mirrors syncEventSources' own per-tick mapping loop almost exactly,
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

function eventSourceSignature(source: EventSource): string {
  return JSON.stringify({ kind: source.kind, config: source.config ?? null })
}

// Starts/stops per-room event-source producers to match
// room.dashboard.eventSources, and wires each running producer's emitted
// field values through its instance's mappings into variables. Called
// whenever room.dashboard might have gained/lost/changed an event source —
// see call sites at getOrLoadRoom and the 'dashboard:update' handler below.
// Diffed by id + a signature of {kind, config} (not just id) so a future
// kind's config change (e.g. a webhook's path) also restarts its producer —
// mappings are deliberately excluded from the signature since the emit
// closure below re-reads them fresh off room.dashboard on every tick, so
// editing a mapping never needs a restart.
function syncEventSources(room: DeckRoom): void {
  const instances = room.dashboard.eventSources ?? []
  const instanceIds = new Set(instances.map((s) => s.id))

  for (const [id, running] of room.eventSourceStops) {
    if (!instanceIds.has(id)) {
      running.stop()
      room.eventSourceStops.delete(id)
    }
  }

  for (const instance of instances) {
    const signature = eventSourceSignature(instance)
    const running = room.eventSourceStops.get(instance.id)
    if (running && running.signature === signature) continue
    running?.stop()

    const producer = EVENT_SOURCE_PRODUCERS[instance.kind]
    if (!producer) continue
    // Disabling a kind in the Settings page (see appSettings.ts) stops its
    // producer entirely rather than just hiding it from EventsModal's add-
    // picker — this is what actually frees a high-intensity kind's
    // underlying worker thread when nobody wants it running. The source's
    // own configuration is untouched, so re-enabling resumes it as-is.
    if (!getAppSettings().enabledDataSources.includes(instance.kind)) continue

    // Per-field values from this instance's previous tick, captured by this
    // closure (not stored on the eventSourceStops entry — that's only set
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
      let current: EventSource | undefined
      try {
        current = room.dashboard.eventSources?.find((s) => s.id === instance.id)
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
              console.error(`[boarderoni] event source mapping expression failed (${current.name} -> ${mapping.variableName})`, result.error)
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
        console.error(`[boarderoni] event source tick failed (${current?.name ?? instance.id})`, err)
      }
    })
    room.eventSourceStops.set(instance.id, { stop, signature })
  }
}

// Re-evaluates every currently-loaded room's event sources against the
// latest enabledDataSources gate — called after an app-settings:update so
// toggling a kind off/on in the Settings page takes effect immediately,
// not just on the next unrelated dashboard:update.
function resyncAllRoomsEventSources(): void {
  for (const room of rooms.values()) syncEventSources(room)
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

  // Gauge/screen-capture are passive — neither has `.events` at all, so a
  // stale/malicious action:trigger naming one lands here rather than
  // crashing on getEventSteps below (which assumes EventfulWidget).
  if (widget.type === 'gauge' || widget.type === 'screen-capture') {
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
        saveDeckDashboard(activeRoom)
        broadcastToRoom(activeRoom, { type: 'dashboard:sync', dashboard: activeRoom.dashboard }, ws)
        syncEventSources(activeRoom)
        break
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
        broadcastToRoom(activeRoom, { type: 'dashboard:sync', dashboard: activeRoom.dashboard })
        break
      }
      case 'background-image:clear': {
        if (!activeRoom) break
        const file = deckBackgroundImageFile(activeRoom.id)
        if (existsSync(file)) unlinkSync(file)
        const { backgroundImageMime: _mime, backgroundImageVersion: _version, ...rest } = activeRoom.dashboard
        activeRoom.dashboard = rest
        saveDeckDashboard(activeRoom)
        broadcastToRoom(activeRoom, { type: 'dashboard:sync', dashboard: activeRoom.dashboard })
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
      case 'app-settings:get': {
        ws.send(JSON.stringify({ type: 'app-settings:settings', ...getAppSettings() } satisfies ServerToClient))
        break
      }
      case 'app-settings:update': {
        const settings = updateAppSettings({ enabledDataSources: message.enabledDataSources })
        ws.send(JSON.stringify({ type: 'app-settings:settings', ...settings } satisfies ServerToClient))
        // Toggling a kind takes effect immediately, not just on the next
        // unrelated dashboard:update — see resyncAllRoomsEventSources.
        resyncAllRoomsEventSources()
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
          broadcastToRoom(activeRoom, { type: 'dashboard:sync', dashboard: activeRoom.dashboard })
        }
        break
      }
      case 'event-source:pick-region': {
        if (!activeRoom) break
        const region = await openRegionPicker(message.displayId)
        // Same no-dedicated-reply shape as screen-capture:pick-region above
        // — the picked region reaches every client via the normal
        // dashboard:sync broadcast below. null (cancelled) does nothing.
        // eventSources is a flat array (unlike widgets, never nested in a
        // sub-deck), so this patches it directly rather than through
        // updateWidgetById.
        if (region) {
          const { sourceId, displayId } = message
          activeRoom.dashboard = {
            ...activeRoom.dashboard,
            eventSources: (activeRoom.dashboard.eventSources ?? []).map((s) =>
              s.id === sourceId ? { ...s, config: { ...s.config, region, displayId } } : s
            )
          }
          saveDeckDashboard(activeRoom)
          broadcastToRoom(activeRoom, { type: 'dashboard:sync', dashboard: activeRoom.dashboard })
          // Unlike the widget case above, this config change needs to
          // restart the running producer (its signature just changed) so
          // the source starts ticking against the new region immediately,
          // not whenever the next unrelated dashboard:update happens to
          // arrive.
          syncEventSources(activeRoom)
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
const bonjour = new Bonjour()
const webPort = devServerUrl ? Number(new URL(devServerUrl).port) : SERVER_PORT
let mdnsService: Service | undefined
try {
  mdnsService = bonjour.publish({
    name: `Boarderoni (${hostname()})`,
    type: MDNS_SERVICE_TYPE,
    port: SERVER_PORT,
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
