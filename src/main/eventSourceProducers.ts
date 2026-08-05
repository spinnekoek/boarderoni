import type { EventSource } from '../shared/types'

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

  return {
    hour24,
    hour12,
    minute,
    second,
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
      const tick = (): void => emit(computeDatetimeFields())
      tick()
      const intervalId = setInterval(tick, 1000)
      return () => clearInterval(intervalId)
    }
  }
}
