import type { ScreenRegion } from '../shared/types'

export interface ScreenCaptureWorkerRequest {
  region: ScreenRegion
  // Electron's own DIP bounds + scale factor for the target display — the
  // worker has no access to Electron's `screen` module (main-process-only),
  // so the host resolves these and hands them over. `displayBounds *
  // displayScaleFactor` is an ESTIMATE of the display's physical-pixel
  // top-left, used only to identify which node-screenshots Monitor is the
  // same physical screen (see screenCaptureWorker.ts's findMonitor) — the
  // actual crop math re-derives the real scale from the two images' own
  // reported sizes, same as before, so this estimate only has to be close
  // enough to disambiguate between monitors, not pixel-exact.
  displayBounds: ScreenRegion
  displayScaleFactor: number
  quality: number
  sharpen: boolean
}

export interface ScreenCaptureWorkerResponse {
  jpeg: Buffer
}
