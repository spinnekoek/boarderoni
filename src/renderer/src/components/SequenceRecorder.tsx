import { useRef, useState } from 'react'
import { codeToKeyName } from '../keyCapture'
import { nextId } from '../id'
import type { SequenceStep } from '@shared/types'

// A chord held shorter than this records as a single atomic "press and
// release" step; held longer records as a 'down' step, a delay spanning the
// measured hold, and an 'up' step — same mode vocabulary KeypressAction's
// own doc comment already describes as how a held-key sequence is built.
const QUICK_TAP_THRESHOLD_MS = 150
// Gaps between chords shorter than this are treated as "immediate" and
// don't get their own delay step — keeps ordinary human key-timing jitter
// from cluttering the recording with near-zero delays.
const MIN_RECORDED_DELAY_MS = 30

// Records a live sequence of keypresses (in-app only — same focus-scoped
// technique as KeyCapture.tsx, not a global/system-wide hook, see that
// file's own onKeyDown/onKeyUp) and converts it into a run of
// ActionStep/DelayStep entries, appended onto an event's existing sequence
// by the caller (EventSequenceEditor). Unlike KeyCapture (one combo, replace
// on new chord), this accumulates a whole timestamped sequence of chords —
// each press/release becomes its own step(s) instead of overwriting the
// last.
export function SequenceRecorder({ onRecorded }: { onRecorded: (steps: SequenceStep[]) => void }): React.JSX.Element {
  const [active, setActive] = useState(false)
  const [stepCount, setStepCount] = useState(0)
  const heldCodes = useRef<Set<string>>(new Set())
  const chordKeys = useRef<string[]>([])
  const chordDownTime = useRef<number | null>(null)
  const lastChordEndTime = useRef<number | null>(null)
  const recordedSteps = useRef<SequenceStep[]>([])

  function finalizeChord(now: number): void {
    if (chordDownTime.current === null || chordKeys.current.length === 0) return
    const holdMs = now - chordDownTime.current
    const keys = [...chordKeys.current]
    if (holdMs < QUICK_TAP_THRESHOLD_MS) {
      recordedSteps.current.push({ kind: 'action', id: nextId(), action: { kind: 'keypress', keys, mode: 'press' } })
    } else {
      recordedSteps.current.push({ kind: 'action', id: nextId(), action: { kind: 'keypress', keys, mode: 'down' } })
      recordedSteps.current.push({ kind: 'delay', id: nextId(), delayMs: Math.round(holdMs) })
      recordedSteps.current.push({ kind: 'action', id: nextId(), action: { kind: 'keypress', keys, mode: 'up' } })
    }
    lastChordEndTime.current = now
    chordDownTime.current = null
    chordKeys.current = []
    setStepCount(recordedSteps.current.length)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat || heldCodes.current.has(e.code)) return

    const startingNewChord = heldCodes.current.size === 0
    heldCodes.current.add(e.code)

    const mapped = codeToKeyName(e.code)
    if (!mapped) return

    if (startingNewChord) {
      const now = performance.now()
      if (lastChordEndTime.current !== null) {
        const gap = now - lastChordEndTime.current
        if (gap > MIN_RECORDED_DELAY_MS) {
          recordedSteps.current.push({ kind: 'delay', id: nextId(), delayMs: Math.round(gap) })
        }
      }
      chordKeys.current = [mapped]
      chordDownTime.current = now
    } else {
      chordKeys.current.push(mapped)
    }
  }

  function handleKeyUp(e: React.KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()
    heldCodes.current.delete(e.code)
    if (heldCodes.current.size === 0) finalizeChord(performance.now())
  }

  // Clicking away mid-recording commits whatever was captured (including a
  // still-held chord, finalized as if released now) rather than silently
  // discarding it — same "never lose captured input" principle as the rest
  // of this app's editors.
  function stop(): void {
    finalizeChord(performance.now())
    heldCodes.current.clear()
    onRecorded([...recordedSteps.current])
  }

  return (
    <div
      className={`sequence-recorder${active ? ' sequence-recorder--active' : ''}`}
      tabIndex={0}
      onFocus={() => setActive(true)}
      onBlur={stop}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <span>{active ? `Recording… ${stepCount} step${stepCount === 1 ? '' : 's'} captured. Press keys, click away or Stop to finish.` : 'Click, then press keys to record'}</span>
      <button type="button" className="properties__file-remove" onMouseDown={(e) => e.preventDefault()} onClick={stop}>
        Stop
      </button>
    </div>
  )
}
