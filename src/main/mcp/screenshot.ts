// Captures real pixels from the editor window for the screenshot_dashboard/
// screenshot_widget MCP tools — everything else in main/mcp only ever hands
// an agent JSON data (x/y/w/h, colors, *Expr strings), which is a purely
// numeric/mental model of what a widget looks like with no actual visual
// confirmation. See docs/TODO.md's own "MCP server" item and the approved
// plan's "Screenshots" section for why this exists as its own thing rather
// than folded into tools.ts.
//
// Deliberately uses webContents.capturePage() (this app's own window
// content), NOT the desktopCapturer/node-screenshots pipeline in
// main/screenCapture.ts — that one captures the user's PHYSICAL monitor for
// the Screen Capture widget feature, an unrelated concern.
//
// Measures the ACTUAL rendered DOM element's getBoundingClientRect() rather
// than recomputing a scale/offset from the dashboard's own canvasWidth/
// canvasHeight — an earlier version of this file assumed the editor's
// canvas used the same fixed "contain" scale-to-fit LetterboxedCanvas.tsx
// uses for the client. It doesn't: the desktop editor's own
// Canvas.tsx has a free pan/zoom camera (see its own camera state in
// settingsStore.ts) with no fixed relationship to canvasWidth/canvasHeight
// at all. Querying the real widget/device-bounds element's own on-screen
// rect sidesteps needing to know (or keep in sync with) whatever transform
// math the canvas currently uses — correct regardless of zoom/pan, and
// regardless of any future canvas rendering changes.
import type { BrowserWindow } from 'electron'

// Confirmed the hard way (manual testing, minimizing the real app to tray
// via its close-to-tray behavior and then calling these tools): a hidden
// BrowserWindow's webContents.capturePage()/executeJavaScript() doesn't
// fail — it hangs indefinitely, and further calls appear to queue up
// behind the stuck one (a second capture attempt on the SAME now-hidden
// window hung too, even after the window was made visible again — the
// first call never recovered). This directly contradicts the assumption
// this feature was originally built on ("a hidden window keeps rendering
// off-screen, so capturePage still works") — it doesn't, at least not
// promptly. Two mitigations: fail fast up front via the synchronous
// isVisible() check (covers the common case — minimized to tray — with an
// immediate, clear error instead of ever starting a doomed capture), and a
// hard timeout around the actual capture as defense in depth for any other
// way a capture could stall (a busy/unresponsive renderer, etc).
const CAPTURE_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

function requireVisibleWindow(win: BrowserWindow): void {
  if (!win.isVisible()) {
    throw new Error(
      'The editor window is minimized to tray — screenshots need it visible to render. Call show_editor_window first. (A hidden window does not just fail this, it hangs the capture indefinitely, so this is checked up front rather than attempted.)'
    )
  }
}

interface ElementRect {
  left: number
  top: number
  width: number
  height: number
  devicePixelRatio: number
}

// `.canvas-viewport` (Canvas.tsx) is the actual clipped/visible canvas area
// — a normal flex box with `overflow: hidden` that shrinks to make room for
// the docked Properties panel when something's selected. The TARGET
// element's own getBoundingClientRect() does NOT account for that clipping
// though — it reports the element's full geometric position regardless of
// whether a parent's overflow:hidden is visually cutting part of it off, or
// whether something else (the Properties panel, docked immediately to the
// canvas-viewport's right) is actually drawn on top of that screen area.
// Confirmed the hard way: an early version of this cropped straight from
// the target element's own rect and included a chunk of the Properties
// panel in a screenshot_dashboard capture, because the dashboard's own
// device-bounds happened to extend past canvas-viewport's real clipped
// edge at the pan/zoom the canvas was at when captured. Intersecting with
// canvas-viewport's own rect (which genuinely reflects what's visible,
// since overflow:hidden governs ITS OWN box just fine) fixes this for both
// screenshot tools, not just the dashboard one — a widget positioned near
// the canvas edge has the exact same failure mode.
async function getElementRect(win: BrowserWindow, selector: string): Promise<ElementRect | null> {
  const result: ElementRect | null = await withTimeout(
    win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const viewport = document.querySelector('.canvas-viewport');
        if (!el || !viewport) return null;
        const r = el.getBoundingClientRect();
        const v = viewport.getBoundingClientRect();
        const left = Math.max(r.left, v.left);
        const top = Math.max(r.top, v.top);
        const right = Math.min(r.right, v.right);
        const bottom = Math.min(r.bottom, v.bottom);
        if (right <= left || bottom <= top) return null;
        return { left, top, width: right - left, height: bottom - top, devicePixelRatio: window.devicePixelRatio || 1 };
      })()`
    ),
    CAPTURE_TIMEOUT_MS,
    'Timed out reading the canvas layout from the editor window'
  )
  return result
}

export interface ImageResult {
  mimeType: string
  data: string
}

// Caps chosen so a screenshot tool call stays cheap for an agent to receive
// and look at — per explicit ask, not a full-resolution capture every time.
const MAX_DASHBOARD_WIDTH = 800
const MAX_WIDGET_WIDTH = 300
const JPEG_QUALITY = 80

function toImageResult(image: Electron.NativeImage, maxWidth: number): ImageResult {
  const resized = image.getSize().width > maxWidth ? image.resize({ width: maxWidth }) : image
  return { mimeType: 'image/jpeg', data: resized.toJPEG(JPEG_QUALITY).toString('base64') }
}

async function captureRect(win: BrowserWindow, rect: ElementRect, maxWidth: number): Promise<ImageResult> {
  const captured = await withTimeout(win.webContents.capturePage(), CAPTURE_TIMEOUT_MS, 'Timed out capturing the editor window')
  const dpr = rect.devicePixelRatio
  const cropped = captured.crop({
    x: Math.round(rect.left * dpr),
    y: Math.round(rect.top * dpr),
    width: Math.max(1, Math.round(rect.width * dpr)),
    height: Math.max(1, Math.round(rect.height * dpr))
  })
  return toImageResult(cropped, maxWidth)
}

// [data-canvas-device-bounds] (Canvas.tsx) — the actual designed area
// (matches the client's own dimensions), not the whole pannable/
// zoomable canvas-viewport, which can show empty space around it depending
// on the current camera position.
export async function captureDashboardScreenshot(win: BrowserWindow): Promise<ImageResult> {
  requireVisibleWindow(win)
  const rect = await getElementRect(win, '[data-canvas-device-bounds]')
  if (!rect) throw new Error('Canvas device bounds not found, or entirely outside the visible canvas area at the current pan/zoom')
  return captureRect(win, rect, MAX_DASHBOARD_WIDTH)
}

// [data-widget-id="..."] (CanvasWidget.tsx/MorphCanvasWidget.tsx) — the
// widget's own real rendered box, rotation and all (unlike a recomputed
// axis-aligned crop, this is the actual on-screen element, so a rotated
// widget's screenshot includes whatever visually falls within its
// bounding box after CSS rotation, same as looking at it in the app).
export async function captureWidgetScreenshot(win: BrowserWindow, widgetId: string): Promise<ImageResult> {
  requireVisibleWindow(win)
  const rect = await getElementRect(win, `[data-widget-id="${widgetId}"]`)
  if (!rect) throw new Error('Widget not found on screen — it may be off-canvas or fully hidden behind a docked panel at the current pan/zoom, or on a different sub-deck view than the one currently showing')
  return captureRect(win, rect, MAX_WIDGET_WIDTH)
}
