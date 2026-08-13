import type { EventSource, ScreenRegion } from '../shared/types'
import { subscribeAircraft } from './dcsBios/connectionManager'
import { recognizeRegionText } from './ocr'

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
// (see syncEventSources' `!(mapping.field in values)` check).
function extractOcrNumber(text: string): number | undefined {
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Field keys here must exactly match the 'datetime' entry in
// shared/eventSources.ts.
function computeDatetimeFields(): Record<string, unknown> {
  const now = new Date()
  const hour24 = now.getHours()
  const hour12 = hour24 % 12 || 12
  const day = now.getDate()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const minute = now.getMinutes()
  const second = now.getSeconds()
  const secondHalf = second + (now.getMilliseconds() >= 500 ? 0.5 : 0)

  return {
    hour24,
    hour12,
    minute,
    second,
    secondHalf,
    ampm: hour24 < 12 ? 'AM' : 'PM',
    dayOfWeek: now.getDay(),
    dayOfWeekName: DAY_NAMES[now.getDay()],
    day,
    month,
    monthName: MONTH_NAMES[month - 1],
    year,
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour24)}:${pad2(minute)}:${pad2(second)}`,
    iso: now.toISOString(),
    unixMs: now.getTime(),
    unixSeconds: Math.floor(now.getTime() / 1000)
  }
}

// One producer per event-source kind. `start` may be called any number of
// times across a room's lifetime (once per matching EventSource instance);
// `emit` may be called any number of times after that; `stop` fully
// releases whatever `start` acquired and is called at most once per start.
// Producers only ever see raw field values — mapping/variable logic is
// entirely the caller's job (see syncEventSources in main/index.ts).
export interface EventSourceProducer {
  start(instance: EventSource, emit: (values: Record<string, unknown>) => void): () => void
}

// This shape already generalizes to future kinds: a webhook producer would
// register a route on start and deregister it on stop (via a small shared
// route-registry the HTTP server consults), and a system-stats poller looks
// identical to this one, just with a different tick body.
export const EVENT_SOURCE_PRODUCERS: Record<string, EventSourceProducer> = {
  datetime: {
    start(_instance, emit) {
      // 250ms, not 1000ms, so `secondHalf` actually resolves at that
      // granularity (any slower and a 500ms-wide window could get missed
      // entirely) — cheap even for consumers that don't map it:
      // syncEventSources only broadcasts a field whose value actually
      // changed since the last tick, so a mapping on e.g. `second` still
      // only fires once a second.
      const tick = (): void => emit(computeDatetimeFields())
      tick()
      const intervalId = setInterval(tick, 250)
      return () => clearInterval(intervalId)
    }
  },
  // Thin adapter — all batching/throttling already happened in the DCS-BIOS
  // worker (fixed ~20Hz ceiling) and in connectionManager.subscribeAircraft
  // (this instance's own configurable rate), so this just plugs straight
  // into the existing per-field-diffing emit path in main/index.ts. Both
  // config.aircraft and config.updateHz changes already restart this
  // producer for free via syncEventSources' existing signature diffing.
  dcsbios: {
    start(instance, emit) {
      const aircraft = typeof instance.config?.aircraft === 'string' ? instance.config.aircraft : ''
      if (!aircraft) return () => {}
      const updateHz = typeof instance.config?.updateHz === 'number' ? instance.config.updateHz : undefined
      return subscribeAircraft(aircraft, emit, { updateHz })
    }
  },
  // Config (region/displayId/intervalMs) is fixed for the life of one
  // start() call — a change to any of it is a signature change, which
  // syncEventSources already turns into a stop+restart with a fresh
  // `instance`, so there's no need to re-read room.dashboard here. Ticks
  // via a self-rescheduling setTimeout chain (not setInterval) purely to
  // keep recognize() calls from overlapping — OCR latency can exceed the
  // configured interval, especially on the very first (cold) tick.
  ocrRegion: {
    start(instance, emit) {
      const region = instance.config?.region
      const displayId = instance.config?.displayId
      if (!isScreenRegion(region) || typeof displayId !== 'number') return () => {}
      const intervalMs = clampOcrIntervalMs(instance.config?.intervalMs)

      let cancelled = false
      let timeoutId: NodeJS.Timeout

      async function tick(): Promise<void> {
        try {
          const text = (await recognizeRegionText(region, displayId)).trim()
          const value = extractOcrNumber(text)
          if (!cancelled) emit(value === undefined ? { text } : { text, value })
        } catch (err) {
          console.error(`[boarderoni] OCR event source tick failed (${instance.name})`, err)
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
}
