import type { ScreenRegion } from '../../shared/types'
import { recognizeRegionText } from '../ocr'
import type { PluginProducer } from './types'

const DEFAULT_OCR_INTERVAL_MS = 1000
const MIN_OCR_INTERVAL_MS = 200
const MAX_OCR_INTERVAL_MS = 5000

function clampOcrIntervalMs(ms: unknown): number {
  const n = typeof ms === 'number' ? ms : DEFAULT_OCR_INTERVAL_MS
  return Math.min(MAX_OCR_INTERVAL_MS, Math.max(MIN_OCR_INTERVAL_MS, Math.round(n)))
}

function isScreenRegion(value: unknown): value is ScreenRegion {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return typeof r.x === 'number' && typeof r.y === 'number' && typeof r.width === 'number' && typeof r.height === 'number'
}

// First signed decimal number found in the recognized text, e.g. "Fuel:
// -12.5 kg" -> -12.5. undefined (rather than NaN) when none is found, so
// this key is simply left out of the emitted fields for that tick — same
// "field this tick didn't produce" case every mapping already tolerates
// (see syncPlugins' `!(mapping.field in values)` check).
function extractOcrNumber(text: string): number | undefined {
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}

// This producer only ever covers the OCR half (the 'screenCapture' event
// source's own text/value fields) — the widget's own live image bypasses
// this entirely via a direct HTTP pull (see ScreenCaptureWidgetContent and
// main/index.ts's serveScreenCaptureFrame/serveScreenCaptureStream, both
// separately gated on the same plugin — see shared/plugins/screenCapture.ts's
// widgetTypes).
//
// Config (region/displayId/intervalMs) is fixed for the life of one start()
// call — a change to any of it is a signature change, which syncPlugins
// already turns into a stop+restart with a fresh `instance`, so there's no
// need to re-read room.dashboard here. Ticks via a self-rescheduling
// setTimeout chain (not setInterval) purely to keep recognize() calls from
// overlapping — OCR latency can exceed the configured interval, especially
// on the very first (cold) tick.
export const screenCaptureProducer: PluginProducer = {
  start(instance, emit) {
    const region = instance.config?.region
    const displayId = instance.config?.displayId
    if (!isScreenRegion(region) || typeof displayId !== 'number') return () => {}
    const intervalMs = clampOcrIntervalMs(instance.config?.intervalMs)

    let cancelled = false
    let timeoutId: NodeJS.Timeout
    // Logged only on failure<->success transitions, not every tick — a
    // missing display fails identically on every poll until someone fixes
    // it (or captureRegionJpeg's own id-migration heals it), and re-logging
    // that as often as every 200ms drowns out everything else.
    let lastTickFailed = false

    async function tick(): Promise<void> {
      try {
        const text = (await recognizeRegionText(region, displayId)).trim()
        const value = extractOcrNumber(text)
        if (!cancelled) emit(value === undefined ? { text } : { text, value })
        if (lastTickFailed) {
          lastTickFailed = false
          console.log(`[boarderoni] Screen Capture OCR recovered (${instance.name})`)
        }
      } catch (err) {
        if (!lastTickFailed) {
          lastTickFailed = true
          console.error(`[boarderoni] Screen Capture OCR tick failed (${instance.name})`, err)
        }
      }
      if (!cancelled) timeoutId = setTimeout(tick, intervalMs)
    }

    timeoutId = setTimeout(tick, 0)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }
}
