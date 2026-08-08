import { app, BrowserWindow, dialog } from 'electron'
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
  copyFileSync
} from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { SERVER_PORT, DECK_CLOSE_CODE_UNKNOWN } from '../shared/constants'
import {
  DEFAULT_DASHBOARD,
  type ButtonWidget,
  type ClientToServer,
  type Dashboard,
  type DeckSummary,
  type DeviceInfo,
  type EventSource,
  type SendDcsCommandAction,
  type ServerToClient,
  type Variable,
  type VariableValue,
  type Widget
} from '../shared/types'
import { toVariableMap, tryEvaluateExpression, evaluateMappingExpression } from '../shared/expr'
import { EVENT_SOURCE_PRODUCERS } from './eventSourceProducers'
import { getAppSettings, updateAppSettings } from './appSettings'
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

function migrateWidget(widget: Widget & LegacyButtonWidget): Widget {
  // Morph/gauge/adjuster widgets never existed in any of the legacy shapes
  // below — they're always created with their current shape from the start
  // (morph with states[]/blocks[], gauge/adjuster with no states[] at all).
  if (widget.type === 'morph' || widget.type === 'gauge' || widget.type === 'adjuster') return widget

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
  deckId: string
  deviceId?: string
}
// Which room (and, once 'hello' arrives, which device) a given socket
// belongs to — resolved from here on close/message, never from a global map,
// so cleanup always targets the right room even if others have since been
// deleted.
const socketContext = new Map<WebSocket, SocketContext>()

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

// Evaluates an update-state action's code and merges whatever it returns
// into the room's dashboard.variables. Runs server-side (not per-client) so
// every client's next dashboard:sync already reflects the result, same as
// any other mutation.
function runUpdateState(room: DeckRoom, code: string, value: number | undefined, final: boolean): void {
  const variableMap = toVariableMap(room.dashboard.variables ?? [])
  // value is only set while an AdjusterWidget is being dragged — exposed as
  // variables.$value, same convention an EventSourceMapping's own `expr`
  // already uses (see evaluateMappingExpression). A plain button/morph click
  // has no value, so it evaluates exactly as before.
  const result = value !== undefined ? evaluateMappingExpression(code, value, variableMap) : tryEvaluateExpression(code, variableMap)
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
async function runSendDcsCommand(room: DeckRoom, action: SendDcsCommandAction, value?: number): Promise<void> {
  // Same enabledDataSources gate syncEventSources already applies to the
  // read side (see its own comment) — disabling DCS-BIOS in Settings should
  // stop a button from firing commands too, not just stop reading fields.
  if (!getAppSettings().enabledDataSources.includes('dcsbios')) {
    throw new Error('DCS-BIOS is disabled in Settings')
  }

  let argument = action.argument
  if (action.argumentExpr && action.argumentExpr.trim()) {
    const variableMap = toVariableMap(room.dashboard.variables ?? [])
    const result = value !== undefined ? evaluateMappingExpression(action.argumentExpr, value, variableMap) : tryEvaluateExpression(action.argumentExpr, variableMap)
    if (!result.ok) throw new Error(result.error)
    argument = String(result.value)
  }
  await sendDcsBiosCommand(action.identifier, argument)
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

async function triggerAction(room: DeckRoom, widgetId: string, ws: WebSocket, value: number | undefined, final: boolean): Promise<void> {
  const widget = room.dashboard.widgets.find((w) => w.id === widgetId)
  if (!widget) {
    sendError(ws, widgetId, 'Widget not found')
    return
  }

  // Gauge is passive — it has no `.action` at all, so a stale/malicious
  // action:trigger naming one lands here rather than crashing on
  // `widget.action.kind` below.
  if (widget.type === 'gauge') {
    sendError(ws, widgetId, 'This widget cannot be triggered')
    return
  }

  if (widget.action.kind === 'update-state') {
    try {
      runUpdateState(room, widget.action.code, value, final)
    } catch (err) {
      sendError(ws, widgetId, err instanceof Error ? err.message : String(err))
    }
    return
  }

  if (widget.action.kind === 'send-dcs-command') {
    try {
      await runSendDcsCommand(room, widget.action, value)
    } catch (err) {
      sendError(ws, widgetId, err instanceof Error ? err.message : String(err))
    }
    return
  }

  try {
    const keys = widget.action.keys.map(keyFromName)
    await keyboard.pressKey(...keys)
    await keyboard.releaseKey(...keys)
  } catch (err) {
    sendError(ws, widgetId, err instanceof Error ? err.message : String(err))
  }
}

function sendError(ws: WebSocket, widgetId: string, message: string): void {
  const payload: ServerToClient = { type: 'action:error', widgetId, message }
  ws.send(JSON.stringify(payload))
}

wss.on('connection', (ws: TrackedSocket, req) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const room = getOrLoadRoom(url.searchParams.get('deck') ?? '')
  if (!room) {
    ws.close(DECK_CLOSE_CODE_UNKNOWN, 'Unknown deck')
    return
  }

  socketContext.set(ws, { deckId: room.id })
  room.sockets.add(ws)

  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })

  ws.send(JSON.stringify({ type: 'dashboard:sync', dashboard: room.dashboard } satisfies ServerToClient))
  ws.send(JSON.stringify({ type: 'devices:sync', devices: Array.from(room.devices.values()) } satisfies ServerToClient))
  // Both genuinely process-wide (one DCS-BIOS connection for the whole
  // app), so a freshly-connected client gets the current cached value right
  // away rather than waiting for the next change (see the proactive
  // onDcsBiosStatusChange/onDcsBiosStatsChange broadcasts below).
  ws.send(JSON.stringify({ type: 'dcsbios:status', ...getDcsBiosStatus() } satisfies ServerToClient))
  const initialDcsBiosStats = getDcsBiosWorkerStats()
  if (initialDcsBiosStats) ws.send(JSON.stringify({ type: 'dcsbios:stats', ...initialDcsBiosStats } satisfies ServerToClient))

  ws.on('close', () => {
    const ctx = socketContext.get(ws)
    socketContext.delete(ws)
    if (!ctx) return
    // The room may have been deleted (via DELETE /api/decks/:id) while this
    // socket was still open — tolerate that rather than assuming it's there.
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
    const activeRoom = ctx && rooms.get(ctx.deckId)
    if (!ctx || !activeRoom) {
      // The deck this socket was connected to no longer exists (deleted
      // mid-session) — close with the same code the initial-connection
      // rejection uses so the client falls back to the picker.
      ws.close(DECK_CLOSE_CODE_UNKNOWN, 'Unknown deck')
      return
    }

    let message: ClientToServer
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    switch (message.type) {
      case 'dashboard:update':
        activeRoom.dashboard = message.dashboard
        saveDeckDashboard(activeRoom)
        broadcastToRoom(activeRoom, { type: 'dashboard:sync', dashboard: activeRoom.dashboard }, ws)
        syncEventSources(activeRoom)
        break
      case 'action:trigger':
        await triggerAction(activeRoom, message.widgetId, ws, message.value, message.final ?? true)
        break
      case 'hello':
        if (message.role === 'view' && message.viewport && message.deviceId) {
          ctx.deviceId = message.deviceId
          // Merge onto any existing entry — this also fires on every window
          // resize (see store.ts's sendHello), so a plain overwrite would
          // wipe out a previously-set customName each time.
          const existing = activeRoom.devices.get(message.deviceId)
          activeRoom.devices.set(message.deviceId, {
            ...existing,
            id: message.deviceId,
            width: message.viewport.width,
            height: message.viewport.height,
            userAgent: message.userAgent,
            connected: true
          })
          broadcastDevices(activeRoom)
        }
        break
      case 'device:rename': {
        const existing = activeRoom.devices.get(message.deviceId)
        if (existing) {
          activeRoom.devices.set(message.deviceId, { ...existing, customName: message.name.trim() || undefined })
          broadcastDevices(activeRoom)
        }
        break
      }
      case 'background-image:upload': {
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
