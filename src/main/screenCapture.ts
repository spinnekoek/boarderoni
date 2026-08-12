import { BrowserWindow, desktopCapturer, ipcMain, screen, type Display, type NativeImage } from 'electron'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import sharp from 'sharp'
import type { ScreenRegion } from '../shared/types'

const MIN_FPS = 1
const MAX_FPS = 15
const DEFAULT_FPS = 5
const MIN_QUALITY = 10
const MAX_QUALITY = 100
const DEFAULT_QUALITY = 70

export function clampFps(fps: number | undefined): number {
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps ?? DEFAULT_FPS)))
}

export function clampQuality(quality: number | undefined): number {
  return Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, Math.round(quality ?? DEFAULT_QUALITY)))
}

export function listDisplays(): { id: number; label: string; bounds: ScreenRegion }[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `Monitor ${i + 1} (${d.size.width}×${d.size.height})${d.id === primaryId ? ' — Primary' : ''}`,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }
  }))
}

// nut-js's screen.grab()/grabRegion() are documented as scoped to "a
// system's MAIN display" only — no good for capturing an arbitrary picked
// monitor. desktopCapturer (built into Electron, so still zero new
// dependency for this path) captures any display by id instead — but it's
// a main-process-only API (unlike DCS-BIOS's own worker_threads worker,
// see main/dcsBios/worker.ts, desktopCapturer simply doesn't exist in a
// plain Node worker context), so every capture necessarily runs on the
// same thread as the rest of the app, and its own captured resolution is
// the one lever that actually matters for cost: it always captures the
// ENTIRE display at whatever `thumbnailSize` is requested, transferred
// over IPC, before we crop it down — asking for less than full native
// resolution when the picked region is much smaller than the display (the
// common case) is a large, direct saving, not a micro-optimization.
const MAX_CAPTURE_DIMENSION = 1920
// A little bigger than the region's own pixel size so the crop still looks
// sharp (matters most for 'contain'/'none' fit, or a widget box larger
// than the region), without paying for detail nobody will ever see.
const REGION_OVERSAMPLE = 2

async function captureDisplay(display: Display, region: ScreenRegion): Promise<NativeImage> {
  const physicalWidth = display.size.width * display.scaleFactor
  const physicalHeight = display.size.height * display.scaleFactor
  const desiredForRegion = Math.max(region.width, region.height) * display.scaleFactor * REGION_OVERSAMPLE
  const targetMaxDimension = Math.min(MAX_CAPTURE_DIMENSION, Math.max(desiredForRegion, 200))
  const scale = Math.min(1, targetMaxDimension / Math.max(physicalWidth, physicalHeight))
  const thumbnailSize = { width: Math.round(physicalWidth * scale), height: Math.round(physicalHeight * scale) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error('No screen source available')
  return source.thumbnail
}

// `region`/`display.bounds` are DIP (CSS-pixel-equivalent) coordinates —
// the same space Electron's own window/display geometry uses throughout,
// including what the region-picker overlay hands back. The captured
// thumbnail's actual size (not necessarily exactly what was requested —
// desktopCapturer/Chromium can round it, on top of our own deliberate
// downscale above) is what the crop rect needs scaling into, so this reads
// the image's own returned dimensions rather than assuming
// `display.scaleFactor` directly.
export async function captureRegionJpeg(region: ScreenRegion, displayId: number, quality: number, sharpen: boolean): Promise<Buffer> {
  const display = screen.getAllDisplays().find((d) => d.id === displayId)
  if (!display) throw new Error(`Display ${displayId} not found`)
  const image = await captureDisplay(display, region)
  const actualSize = image.getSize()
  const scaleX = actualSize.width / display.bounds.width
  const scaleY = actualSize.height / display.bounds.height
  const local = {
    x: Math.round((region.x - display.bounds.x) * scaleX),
    y: Math.round((region.y - display.bounds.y) * scaleY),
    width: Math.round(region.width * scaleX),
    height: Math.round(region.height * scaleY)
  }
  const cropped = image.crop(local)
  if (!sharpen) return cropped.toJPEG(quality)
  // The one path with real per-frame CPU cost — routed through `sharp`
  // (the only new dependency this feature adds) instead of Electron's own
  // encoder, only when explicitly opted into (see ScreenCaptureWidget.sharpen).
  // PNG round-trip rather than raw bitmap bytes sidesteps having to know/
  // match nativeImage's internal channel order.
  return sharp(cropped.toPNG()).sharpen().jpeg({ quality }).toBuffer()
}

// Self-contained overlay page — deliberately not part of the built React
// renderer (this window is ephemeral and not deck-aware, closer in spirit
// to a native dialog, see PLAN's rationale) and loaded via a data: URL, so
// nothing here needs its own build/static-asset step. The window itself is
// transparent (see openRegionPicker) and covers exactly the target
// display, so what's "shown" here isn't a screenshot copy at all — it's a
// dim scrim floating directly over the real, live desktop underneath, same
// as a normal OS screenshot tool.
function pickerHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;overflow:hidden;cursor:crosshair;background:transparent;user-select:none;}
#dim{position:absolute;inset:0;background:rgba(0,0,0,0.35);pointer-events:none;}
#box{position:absolute;border:2px solid #5b8def;background:rgba(91,141,239,0.1);display:none;cursor:move;box-sizing:border-box;}
.handle{position:absolute;width:12px;height:12px;background:#fff;border:2px solid #5b8def;border-radius:50%;box-sizing:border-box;transform:translate(-50%,-50%);}
.handle.nw{left:0;top:0;cursor:nwse-resize;} .handle.ne{left:100%;top:0;cursor:nesw-resize;}
.handle.sw{left:0;top:100%;cursor:nesw-resize;} .handle.se{left:100%;top:100%;cursor:nwse-resize;}
.handle.n{left:50%;top:0;cursor:ns-resize;} .handle.s{left:50%;top:100%;cursor:ns-resize;}
.handle.w{left:0;top:50%;cursor:ew-resize;} .handle.e{left:100%;top:50%;cursor:ew-resize;}
#hint{position:absolute;top:16px;left:50%;transform:translateX(-50%);color:#fff;font:14px sans-serif;background:rgba(0,0,0,0.55);padding:6px 12px;border-radius:6px;pointer-events:none;}
#toolbar{position:absolute;display:none;transform:translateX(-50%);background:rgba(20,22,27,0.92);color:#fff;font:13px sans-serif;padding:8px 10px;border-radius:8px;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.4);}
#toolbar.visible{display:flex;}
#size-label{opacity:0.75;white-space:nowrap;}
#toolbar button{font:13px sans-serif;border:none;border-radius:5px;padding:6px 12px;cursor:pointer;}
#confirm-btn{background:#5b8def;color:#fff;}
#cancel-btn{background:rgba(255,255,255,0.12);color:#fff;}
</style></head><body>
<div id="dim"></div>
<div id="box">
  <div class="handle nw" data-handle="nw"></div>
  <div class="handle n" data-handle="n"></div>
  <div class="handle ne" data-handle="ne"></div>
  <div class="handle w" data-handle="w"></div>
  <div class="handle e" data-handle="e"></div>
  <div class="handle sw" data-handle="sw"></div>
  <div class="handle s" data-handle="s"></div>
  <div class="handle se" data-handle="se"></div>
</div>
<div id="toolbar">
  <span id="size-label"></span>
  <button id="cancel-btn">Cancel</button>
  <button id="confirm-btn">Confirm</button>
</div>
<div id="hint">Drag to select a region</div>
<script>
var boxEl = document.getElementById('box')
var dimEl = document.getElementById('dim')
var toolbarEl = document.getElementById('toolbar')
var sizeLabel = document.getElementById('size-label')
var hintEl = document.getElementById('hint')
var MIN_SIZE = 20
var box = null
var mode = null // 'create' | 'move' | 'resize'
var activeHandle = null
var dragStart = null
var createStart = null

function clamp(box) {
  var w = window.innerWidth, h = window.innerHeight
  var width = Math.min(box.width, w), height = Math.min(box.height, h)
  var x = Math.min(Math.max(0, box.x), w - width)
  var y = Math.min(Math.max(0, box.y), h - height)
  return { x: x, y: y, width: width, height: height }
}

function resize(orig, handle, dx, dy) {
  var x1 = orig.x, y1 = orig.y, x2 = orig.x + orig.width, y2 = orig.y + orig.height
  if (handle.indexOf('w') !== -1) x1 = orig.x + dx
  if (handle.indexOf('e') !== -1) x2 = orig.x + orig.width + dx
  if (handle.indexOf('n') !== -1) y1 = orig.y + dy
  if (handle.indexOf('s') !== -1) y2 = orig.y + orig.height + dy
  if (x2 - x1 < MIN_SIZE) { if (handle.indexOf('w') !== -1) x1 = x2 - MIN_SIZE; else x2 = x1 + MIN_SIZE }
  if (y2 - y1 < MIN_SIZE) { if (handle.indexOf('n') !== -1) y1 = y2 - MIN_SIZE; else y2 = y1 + MIN_SIZE }
  x1 = Math.max(0, x1); y1 = Math.max(0, y1)
  x2 = Math.min(window.innerWidth, x2); y2 = Math.min(window.innerHeight, y2)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function render() {
  if (!box) { boxEl.style.display = 'none'; toolbarEl.classList.remove('visible'); dimEl.style.clipPath = ''; return }
  boxEl.style.display = 'block'
  boxEl.style.left = box.x + 'px'
  boxEl.style.top = box.y + 'px'
  boxEl.style.width = box.width + 'px'
  boxEl.style.height = box.height + 'px'
  var w = window.innerWidth, h = window.innerHeight
  var x1 = box.x, y1 = box.y, x2 = box.x + box.width, y2 = box.y + box.height
  dimEl.style.clipPath = 'polygon(evenodd, 0 0, ' + w + 'px 0, ' + w + 'px ' + h + 'px, 0 ' + h + 'px, 0 0, ' +
    x1 + 'px ' + y1 + 'px, ' + x1 + 'px ' + y2 + 'px, ' + x2 + 'px ' + y2 + 'px, ' + x2 + 'px ' + y1 + 'px, ' + x1 + 'px ' + y1 + 'px)'
}

function showToolbar() {
  hintEl.style.display = 'none'
  toolbarEl.classList.add('visible')
  sizeLabel.textContent = Math.round(box.width) + ' \\u00d7 ' + Math.round(box.height)
  var top = box.y + box.height + 12
  var toolbarH = 40
  if (top + toolbarH > window.innerHeight) top = box.y - toolbarH - 4
  toolbarEl.style.left = (box.x + box.width / 2) + 'px'
  toolbarEl.style.top = Math.max(4, top) + 'px'
}

document.addEventListener('pointerdown', function (e) {
  if (e.target.closest('#toolbar')) return
  var handle = e.target.getAttribute && e.target.getAttribute('data-handle')
  if (handle) {
    mode = 'resize'; activeHandle = handle
    dragStart = { x: e.clientX, y: e.clientY, box: Object.assign({}, box) }
    toolbarEl.classList.remove('visible')
    e.preventDefault()
    return
  }
  if (box && e.target === boxEl) {
    mode = 'move'
    dragStart = { x: e.clientX, y: e.clientY, box: Object.assign({}, box) }
    toolbarEl.classList.remove('visible')
    e.preventDefault()
    return
  }
  mode = 'create'
  createStart = { x: e.clientX, y: e.clientY }
  box = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
  toolbarEl.classList.remove('visible')
  render()
})
document.addEventListener('pointermove', function (e) {
  if (mode === 'create') {
    var x1 = Math.min(createStart.x, e.clientX), y1 = Math.min(createStart.y, e.clientY)
    var x2 = Math.max(createStart.x, e.clientX), y2 = Math.max(createStart.y, e.clientY)
    box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
    render()
  } else if (mode === 'move') {
    var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y
    box = clamp({ x: dragStart.box.x + dx, y: dragStart.box.y + dy, width: dragStart.box.width, height: dragStart.box.height })
    render()
  } else if (mode === 'resize') {
    box = resize(dragStart.box, activeHandle, e.clientX - dragStart.x, e.clientY - dragStart.y)
    render()
  }
})
document.addEventListener('pointerup', function () {
  if (mode === 'create' && box.width < MIN_SIZE && box.height < MIN_SIZE) { box = null; render() }
  else if (mode) { showToolbar() }
  mode = null
})
document.getElementById('confirm-btn').addEventListener('click', function () {
  if (box) window.regionPicker.submit({ x: box.x, y: box.y, width: box.width, height: box.height })
})
document.getElementById('cancel-btn').addEventListener('click', function () { window.regionPicker.submit(null) })
window.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') window.regionPicker.submit(null)
  if (e.key === 'Enter' && box) window.regionPicker.submit({ x: box.x, y: box.y, width: box.width, height: box.height })
})
</script>
</body></html>`
}

interface PickedRect {
  x: number
  y: number
  width: number
  height: number
}

interface ActivePicker {
  resolve: (region: ScreenRegion | null) => void
  display: Display
  win: BrowserWindow
}

let activePicker: ActivePicker | null = null
let handlersRegistered = false

// ipcMain.on is a process-wide singleton — registered once, lazily, the
// first time a picker is actually opened rather than unconditionally at
// module load (this module is imported by main/index.ts regardless of
// whether the feature is ever used).
function registerPickerIpcHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.on('region-picker:submit', (_event, rect: PickedRect | null) => {
    if (!activePicker) return
    const { resolve, display, win } = activePicker
    activePicker = null
    resolve(rect ? { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height } : null)
    win.close()
  })
}

// Opens a frameless, transparent, always-on-top overlay covering exactly
// the chosen display — the real desktop shows straight through it, dimmed
// by the page's own scrim, so this reads as a floating selection box over
// whatever's actually on screen rather than a picker over a frozen copy.
// Lets the user drag-select a rectangle (or Escape to cancel), and resolves
// with the picked region in absolute virtual-desktop (DIP) coordinates —
// or null if cancelled/closed without picking.
export function openRegionPicker(displayId: number): Promise<ScreenRegion | null> {
  registerPickerIpcHandlers()
  // Only one picker session at a time — opening a new one cancels any
  // still-pending one rather than leaving it dangling forever.
  if (activePicker) {
    const stale = activePicker
    activePicker = null
    stale.resolve(null)
    stale.win.close()
  }

  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/regionPicker.js')
      }
    })
    activePicker = { resolve, display, win }
    win.setMenuBarVisibility(false)
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pickerHtml())}`)
    win.on('closed', () => {
      if (activePicker?.win !== win) return
      const pending = activePicker
      activePicker = null
      pending.resolve(null)
    })
  })
}

export interface StreamConfig {
  region: ScreenRegion
  displayId: number
  quality: number
  sharpen: boolean
  fps: number
}

const MJPEG_BOUNDARY = 'boarderoni-frame'

interface StreamState {
  timeout: NodeJS.Timeout
  viewers: Set<ServerResponse>
}

// Per-widget capture loop, shared by every simultaneous viewer of that
// widget (desktop editor preview + N phones) — one running capture instead
// of one per connection, torn down the instant the last viewer disconnects
// so there's zero capture work while nobody's watching. A self-rescheduling
// setTimeout chain (not setInterval) rather than a single fixed-rate timer —
// `getConfig` is re-read before scheduling each next tick, so a live
// Properties change (region/quality/sharpen, AND fps) takes effect on the
// very next frame without needing any viewer to reconnect.
const streams = new Map<string, StreamState>()

export function addMjpegViewer(widgetId: string, res: ServerResponse, getConfig: () => StreamConfig | null): void {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
    'Cache-Control': 'no-store, no-cache',
    Connection: 'close'
  })

  let state = streams.get(widgetId)
  if (!state) {
    const viewers = new Set<ServerResponse>()
    const newState: StreamState = { timeout: setTimeout(tick, 0), viewers }

    async function tick(): Promise<void> {
      const config = getConfig()
      if (config) {
        try {
          const frame = await captureRegionJpeg(config.region, config.displayId, config.quality, config.sharpen)
          const header = `--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
          for (const viewer of viewers) {
            viewer.write(header)
            viewer.write(frame)
            viewer.write('\r\n')
          }
        } catch (err) {
          console.error(`[boarderoni] screen capture frame failed (widget ${widgetId})`, err)
        }
      }
      newState.timeout = setTimeout(tick, 1000 / clampFps(config?.fps))
    }

    state = newState
    streams.set(widgetId, state)
  }

  state.viewers.add(res)
  res.on('close', () => {
    const current = streams.get(widgetId)
    if (!current) return
    current.viewers.delete(res)
    if (current.viewers.size === 0) {
      clearTimeout(current.timeout)
      streams.delete(widgetId)
    }
  })
}
