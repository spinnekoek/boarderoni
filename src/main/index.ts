import { app, BrowserWindow } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { SERVER_PORT } from '../shared/constants'
import { DEFAULT_DASHBOARD, type ClientToServer, type Dashboard, type DeviceInfo, type ServerToClient, type Widget } from '../shared/types'

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
}

function migrateWidget(widget: Widget & LegacyButtonWidget): Widget {
  if (!Array.isArray(widget.labels)) {
    const { label, fontFamily, fontSize, textColor, textOpacity, align, verticalAlign, padding, ...rest } = widget
    return {
      ...rest,
      labels: [{ id: randomUUID(), text: label ?? '', fontFamily, fontSize, textColor, textOpacity, align, verticalAlign, padding }]
    }
  }

  if (widget.padding !== undefined) {
    const { padding, ...rest } = widget
    return { ...rest, labels: widget.labels.map((l) => (l.padding === undefined ? { ...l, padding } : l)) }
  }

  return widget
}

// Only `electron-vite dev` sets this — it's the one mode where the renderer
// isn't built yet, so we must load it from the Vite dev server instead of
// out/renderer. A production build run via `electron-vite preview` (or a
// packaged installer) has no dev server and app.isPackaged is unreliable for
// telling those apart, so this env var is the only trustworthy signal.
const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const rendererDist = join(__dirname, '../renderer')
const dashboardFile = join(app.getPath('userData'), 'dashboard.json')
const backgroundImageFile = join(app.getPath('userData'), 'background-image')
const windowStateFile = join(app.getPath('userData'), 'window-state.json')

let dashboard: Dashboard = loadDashboard()
saveDashboard()

function loadDashboard(): Dashboard {
  try {
    if (existsSync(dashboardFile)) {
      const loaded = JSON.parse(readFileSync(dashboardFile, 'utf-8')) as Dashboard & { backgroundImage?: string }
      // Migrate off the old shape, which embedded the image as a data URL
      // directly in the dashboard JSON (re-sent over the WebSocket on every
      // single change — see backgroundImageVersion in shared/types.ts).
      delete loaded.backgroundImage
      loaded.widgets = loaded.widgets.map(migrateWidget)
      return loaded
    }
  } catch (err) {
    console.error('[boarderoni] failed to load saved dashboard, using default', err)
  }
  return structuredClone(DEFAULT_DASHBOARD)
}

function saveDashboard(): void {
  mkdirSync(join(app.getPath('userData')), { recursive: true })
  writeFileSync(dashboardFile, JSON.stringify(dashboard, null, 2), 'utf-8')
}

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
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  })
}

function serveBackgroundImage(res: ServerResponse): void {
  if (!dashboard.backgroundImageMime || !existsSync(backgroundImageFile)) {
    res.writeHead(404)
    res.end('No background image set')
    return
  }
  readFile(backgroundImageFile, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('No background image set')
      return
    }
    res.writeHead(200, { 'Content-Type': dashboard.backgroundImageMime!, 'Cache-Control': 'public, max-age=31536000, immutable' })
    res.end(data)
  })
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/background-image') {
    serveBackgroundImage(res)
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
const devices = new Map<WebSocket, DeviceInfo>()

function broadcast(message: ServerToClient, exclude?: WebSocket): void {
  const payload = JSON.stringify(message)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      client.send(payload)
    }
  }
}

function broadcastDevices(): void {
  broadcast({ type: 'devices:sync', devices: Array.from(devices.values()) })
}

function keyFromName(name: string): Key {
  const key = (Key as unknown as Record<string, Key>)[name]
  if (key === undefined) {
    throw new Error(`Unknown key name "${name}". See @nut-tree-fork/nut-js Key enum for valid names.`)
  }
  return key
}

async function triggerAction(widgetId: string, ws: WebSocket): Promise<void> {
  const widget = dashboard.widgets.find((w) => w.id === widgetId)
  if (!widget) {
    sendError(ws, widgetId, 'Widget not found')
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

wss.on('connection', (ws) => {
  const connectionId = randomUUID()

  ws.send(JSON.stringify({ type: 'dashboard:sync', dashboard } satisfies ServerToClient))
  ws.send(JSON.stringify({ type: 'devices:sync', devices: Array.from(devices.values()) } satisfies ServerToClient))

  ws.on('close', () => {
    if (devices.delete(ws)) broadcastDevices()
  })

  ws.on('message', async (raw) => {
    let message: ClientToServer
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    switch (message.type) {
      case 'dashboard:update':
        dashboard = message.dashboard
        saveDashboard()
        broadcast({ type: 'dashboard:sync', dashboard }, ws)
        break
      case 'action:trigger':
        await triggerAction(message.widgetId, ws)
        break
      case 'hello':
        if (message.role === 'view' && message.viewport) {
          devices.set(ws, { id: connectionId, width: message.viewport.width, height: message.viewport.height })
          broadcastDevices()
        }
        break
      case 'background-image:upload': {
        const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(message.dataUrl)
        if (!match) break
        const [, mime, base64] = match
        writeFileSync(backgroundImageFile, Buffer.from(base64, 'base64'))
        dashboard = { ...dashboard, backgroundImageMime: mime, backgroundImageVersion: Date.now() }
        saveDashboard()
        broadcast({ type: 'dashboard:sync', dashboard })
        break
      }
      case 'background-image:clear': {
        if (existsSync(backgroundImageFile)) unlinkSync(backgroundImageFile)
        const { backgroundImageMime: _mime, backgroundImageVersion: _version, ...rest } = dashboard
        dashboard = rest
        saveDashboard()
        broadcast({ type: 'dashboard:sync', dashboard })
        break
      }
    }
  })
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
