import type { PluginProducer } from './types'

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

// Field keys here must exactly match shared/plugins/datetime.ts's own list.
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

export const datetimeProducer: PluginProducer = {
  start(_instance, emit) {
    // 250ms, not 1000ms, so `secondHalf` actually resolves at that
    // granularity (any slower and a 500ms-wide window could get missed
    // entirely) — cheap even for consumers that don't map it: syncPlugins
    // only broadcasts a field whose value actually changed since the last
    // tick, so a mapping on e.g. `second` still only fires once a second.
    const tick = (): void => emit(computeDatetimeFields())
    tick()
    const intervalId = setInterval(tick, 250)
    return () => clearInterval(intervalId)
  }
}
