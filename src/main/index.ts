import { app, BrowserWindow } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import { SERVER_PORT } from '../shared/constants'
import { DEFAULT_DASHBOARD, type ClientToServer, type Dashboard, type DeviceInfo, type ServerToClient } from '../shared/types'

// Only `electron-vite dev` sets this — it's the one mode where the renderer
// isn't built yet, so we must load it from the Vite dev server instead of
// out/renderer. A production build run via `electron-vite preview` (or a
// packaged installer) has no dev server and app.isPackaged is unreliable for
// telling those apart, so this env var is the only trustworthy signal.
const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const rendererDist = join(__dirname, '../renderer')
const dashboardFile = join(app.getPath('userData'), 'dashboard.json')

let dashboard: Dashboard = loadDashboard()

function loadDashboard(): Dashboard {
  try {
    if (existsSync(dashboardFile)) {
      return JSON.parse(readFileSync(dashboardFile, 'utf-8')) as Dashboard
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

const httpServer = createServer((req, res) => {
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

function createEditorWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
