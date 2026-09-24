import { useEffect, useRef } from 'react'
import { useDashboardStore } from './store'

// How long a tap is held back waiting for a possible next one, once a
// widget actually has doublePress and/or triplePress steps configured (see
// ButtonWidget.events' own comment in shared/types.ts) — standard desktop
// double-click timing, generous enough for a touchscreen tap-tap-tap
// without feeling laggy for the (much more common) single tap that then has
// to wait this long to resolve. Only ever consulted when at least one of
// those two is non-empty; with both empty this whole arbiter never engages
// and press fires the instant it's pressed, same as it always has.
const MULTI_PRESS_WINDOW_MS = 350

// Counts consecutive taps within MULTI_PRESS_WINDOW_MS of each other and
// resolves to exactly one of 'press'/'doublePress'/'triplePress' — never
// more than one network trigger per physical tap-sequence, and never a
// 'press' that then ALSO gets followed by a 'doublePress' for the same two
// taps. Caps at whichever of double/triple is actually configured: a third
// tap on a widget with only doublePress resolves immediately as the second
// (no triplePress to wait for), and one with triplePress configured still
// resolves after exactly 2 taps if that pair's window lapses without a
// third.
//
// Its own file (not living alongside TriggerableClientWidget in
// ClientCanvas.tsx, its original home) specifically so useAdjusterDrag.ts can
// import it too without a circular import back into ClientCanvas.tsx, which
// already imports useAdjusterDrag for ClientAdjuster's own rendering.
export function useMultiPressArbiter(
  widgetId: string,
  hasDoublePress: boolean,
  hasTriplePress: boolean
): { registerTap: (value?: number) => void } {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const countRef = useRef(0)
  // An adjuster's initial touch-down carries a live `value`, unlike a plain
  // button's or dial switch's — threaded through to whichever of
  // press/doublePress/triplePress actually fires, undefined for callers
  // that never pass one.
  const valueRef = useRef<number | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function resolve(count: number): void {
    timerRef.current = undefined
    countRef.current = 0
    const value = valueRef.current
    if (count >= 3 && hasTriplePress) triggerWidget(widgetId, 'triplePress', value)
    else if (count >= 2 && hasDoublePress) triggerWidget(widgetId, 'doublePress', value)
    else triggerWidget(widgetId, 'press', value)
  }

  function registerTap(value?: number): void {
    countRef.current += 1
    valueRef.current = value
    clearTimeout(timerRef.current)
    const capped = hasTriplePress ? 3 : 2
    if (countRef.current >= capped) {
      resolve(countRef.current)
      return
    }
    timerRef.current = setTimeout(() => resolve(countRef.current), MULTI_PRESS_WINDOW_MS)
  }

  return { registerTap }
}
