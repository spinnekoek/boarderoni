// Runs entirely off the main thread (see src/main/workerHost.ts) — owns the
// actual screen grab + JPEG encode, the two costs that used to run
// synchronously on Electron's own UI thread via desktopCapturer (that API
// is main-process-only, so there used to be no way off it — see git history
// on main/screenCapture.ts's old captureDisplay). node-screenshots is a
// native N-API addon with zero Electron dependency, so unlike
// desktopCapturer it works from a plain worker_threads worker: this worker
// captures full-native-resolution monitor images and crops/encodes,
// entirely isolated from whatever the main thread is doing (window resize,
// IPC, the HTTP server).
import { parentPort } from 'node:worker_threads'
import { Monitor } from 'node-screenshots'
import sharp from 'sharp'
import type { ScreenCaptureWorkerRequest, ScreenCaptureWorkerResponse } from './screenCaptureMessages'

if (!parentPort) throw new Error('screenCaptureWorker.ts must be run as a worker_threads Worker')
const port = parentPort

type HostToWorker = { kind: 'req'; id: string; payload: ScreenCaptureWorkerRequest }
type WorkerToHost = { kind: 'res'; id: string; ok: true; payload: ScreenCaptureWorkerResponse } | { kind: 'res'; id: string; ok: false; error: string }

// Electron's screen.getAllDisplays() (host side) and node-screenshots'
// Monitor.all() (here) enumerate the same physical monitors but in
// unrelated, unspecified orders — matching by *position* rather than index
// is the robust option: `estimatedX/Y` is the target display's DIP
// top-left scaled by its own scaleFactor, which should land close to
// whichever monitor's own (physical-pixel) x()/y() is the same screen,
// regardless of what order either side enumerated in.
function findMonitor(monitors: Monitor[], estimatedX: number, estimatedY: number): Monitor | undefined {
  let best: Monitor | undefined
  let bestDist = Infinity
  for (const m of monitors) {
    const dx = m.x() - estimatedX
    const dy = m.y() - estimatedY
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = m
    }
  }
  return best
}

async function handle(payload: ScreenCaptureWorkerRequest): Promise<ScreenCaptureWorkerResponse> {
  const { region, displayBounds, displayScaleFactor, quality, sharpen } = payload

  // Re-enumerated per request rather than cached — cheap relative to the
  // capture itself, and stays correct across a monitor being unplugged/
  // replugged without needing to listen for that separately.
  const monitors = Monitor.all()
  const monitor = findMonitor(monitors, displayBounds.x * displayScaleFactor, displayBounds.y * displayScaleFactor)
  if (!monitor) throw new Error('No monitor available to capture')

  // node-screenshots has no thumbnail/downscale option — it always captures
  // at the monitor's full native resolution, unlike the old desktopCapturer
  // path which deliberately asked for less. That's an accepted trade: the
  // extra pixels cost time here, on this worker thread, never on the app's
  // own UI thread.
  const image = monitor.captureImageSync()

  // `region`/`displayBounds` are DIP coordinates (Electron's own space,
  // same as the region-picker overlay hands back); the captured image is in
  // physical pixels, so the crop rect needs scaling by however the two
  // relate for THIS monitor specifically, not an assumed scale factor.
  const scaleX = image.width / displayBounds.width
  const scaleY = image.height / displayBounds.height
  const x = Math.max(0, Math.min(image.width - 1, Math.round((region.x - displayBounds.x) * scaleX)))
  const y = Math.max(0, Math.min(image.height - 1, Math.round((region.y - displayBounds.y) * scaleY)))
  const width = Math.max(1, Math.min(image.width - x, Math.round(region.width * scaleX)))
  const height = Math.max(1, Math.min(image.height - y, Math.round(region.height * scaleY)))

  const cropped = image.cropSync(x, y, width, height)
  const raw = cropped.toRawSync()
  // node-screenshots' own toJpeg has no quality knob — routed through sharp
  // (already a dependency) for that, same as the old sharpen-only path did,
  // just unconditionally now.
  const encoder = sharp(raw, { raw: { width: cropped.width, height: cropped.height, channels: 4 } })
  if (sharpen) encoder.sharpen()
  const jpeg = await encoder.jpeg({ quality }).toBuffer()
  return { jpeg }
}

port.on('message', (message: HostToWorker) => {
  if (message.kind !== 'req') return
  handle(message.payload)
    .then((result) => {
      const response: WorkerToHost = { kind: 'res', id: message.id, ok: true, payload: result }
      port.postMessage(response)
    })
    .catch((err: unknown) => {
      const response: WorkerToHost = { kind: 'res', id: message.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      port.postMessage(response)
    })
})
