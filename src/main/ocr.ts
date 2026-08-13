import { join } from 'node:path'
import type { ScreenRegion } from '../shared/types'
import { WorkerHost } from './workerHost'
import { captureRegionJpeg } from './screenCapture'
import type { OcrWorkerRequest, OcrWorkerResponse } from './ocrMessages'

// Fixed rather than user-configurable — this is feeding an OCR engine, not
// a human viewer, so there's no reason to trade quality for bandwidth the
// way the screen-capture widget's own quality slider does. Sharpening
// tends to help recognition of small on-screen text specifically.
const OCR_JPEG_QUALITY = 95

// Reuses the existing screen-capture worker for the actual grab/crop (see
// screenCapture.ts's captureRegionJpeg) rather than duplicating that logic
// here — this host only owns the OCR step, kept in its OWN worker
// (ocrWorker.ts) so a slow recognize() call can never contend with a live
// MJPEG capture stream running in screenCaptureWorker.ts.
const ocrHost = new WorkerHost<OcrWorkerRequest, OcrWorkerResponse, never>({
  scriptPath: join(__dirname, 'ocrWorker.js'),
  // Cold init (spawning tesseract.js's own nested worker, loading the WASM
  // core + vendored language data) can take several seconds on a slow
  // machine — WorkerHost's 5s default timeout is tuned for the much faster
  // screen-capture round trip, not this.
  requestTimeoutMs: 30000
})

// Same lazy-acquire-never-release shape as screenCaptureHost — an idle
// worker thread costs effectively nothing, and avoids spawn/teardown churn
// as OCR event sources come and go across syncEventSources restarts.
let hostAcquired = false
function ensureHostAcquired(): void {
  if (hostAcquired) return
  hostAcquired = true
  ocrHost.acquire()
}

export async function recognizeRegionText(region: ScreenRegion, displayId: number): Promise<string> {
  ensureHostAcquired()
  const jpeg = await captureRegionJpeg(region, displayId, OCR_JPEG_QUALITY, true)
  const { text } = await ocrHost.request({ jpeg })
  return text
}
