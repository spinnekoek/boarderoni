import { useRef, useState } from 'react'
import { resolveBooleanExpr, type VariableMap } from '@shared/expr'
import type { PullConfig } from '@shared/types'
import { useDashboardStore } from './store'

const DOUBLE_CLICK_MS = 350
const DOUBLE_CLICK_SLOP_PX = 24
const TURN_SLOP_PX = 6

type PointerHandler = (e: React.PointerEvent) => void
export interface PointerHandlers {
  down: PointerHandler
  move: PointerHandler
  up: PointerHandler
}

function directionVector(direction: PullConfig['direction']): { x: number; y: number } {
  if (direction === 'up') return { x: 0, y: -1 }
  if (direction === 'down') return { x: 0, y: 1 }
  if (direction === 'left') return { x: -1, y: 0 }
  return { x: 1, y: 0 }
}

// Pull-out/push-in state for a dial or knob — see PullConfig. A double-click
// toggles it; `wrap` sits in front of the widget's own drag handlers, swallows
// the second click of a double-click, and blocks turning while turning isn't
// allowed. `offset` is how far the widget should currently be shifted.
export function usePull(
  widgetId: string,
  pull: PullConfig | undefined,
  variables: VariableMap,
  active = true
): {
  enabled: boolean
  pulled: boolean
  offset: { x: number; y: number }
  wrap: (inner: PointerHandlers) => PointerHandlers
} {
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const [localPulled, setLocalPulled] = useState(false)
  const lastDownRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const swallowRef = useRef(false)
  const startedRef = useRef(false)
  const pendingRef = useRef<{ e: React.PointerEvent; target: Element; x: number; y: number } | null>(null)

  const enabled = active && !!pull?.enabled
  const exprPulled = enabled && pull?.pulledExpr ? resolveBooleanExpr(pull.pulledExpr, variables) : undefined
  const pulled = enabled && (exprPulled ?? localPulled)
  const dir = directionVector(pull?.direction ?? 'down')
  const amount = Math.max(0, pull?.amount ?? 0)
  const offset = pulled ? { x: dir.x * amount, y: dir.y * amount } : { x: 0, y: 0 }
  const turnWhen = pull?.turnWhen ?? 'either'
  const canTurn = !enabled || turnWhen === 'either' || (turnWhen === 'pulled' ? pulled : !pulled)

  function togglePulled(): void {
    const next = !pulled
    setLocalPulled(next)
    triggerWidget(widgetId, next ? 'pull' : 'push', next ? 1 : 0)
  }

  // A touch only starts the widget's own drag once the pointer has actually
  // moved — otherwise the first press of a double-click would already turn
  // the dial/knob toward where it landed.
  function wrap(inner: PointerHandlers): PointerHandlers {
    if (!enabled) return inner
    return {
      down(e) {
        const now = Date.now()
        const last = lastDownRef.current
        if (last && now - last.t < DOUBLE_CLICK_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_CLICK_SLOP_PX) {
          lastDownRef.current = null
          pendingRef.current = null
          swallowRef.current = true
          togglePulled()
          return
        }
        lastDownRef.current = { t: now, x: e.clientX, y: e.clientY }
        swallowRef.current = !canTurn
        startedRef.current = false
        if (swallowRef.current) return
        const target = e.currentTarget as Element
        try {
          target.setPointerCapture(e.pointerId)
        } catch {
          // best-effort
        }
        pendingRef.current = { e, target, x: e.clientX, y: e.clientY }
      },
      move(e) {
        if (swallowRef.current) return
        const pending = pendingRef.current
        if (pending) {
          if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < TURN_SLOP_PX) return
          pendingRef.current = null
          startedRef.current = true
          inner.down(Object.create(pending.e, { currentTarget: { value: pending.target } }) as React.PointerEvent)
        }
        inner.move(e)
      },
      up(e) {
        pendingRef.current = null
        if (swallowRef.current) {
          swallowRef.current = false
          return
        }
        if (startedRef.current) inner.up(e)
        startedRef.current = false
      }
    }
  }

  return { enabled, pulled, offset, wrap }
}

export function pullStyle(offset: { x: number; y: number }): React.CSSProperties {
  return { position: 'absolute', inset: 0, transform: `translate(${offset.x}px, ${offset.y}px)`, transition: 'transform 120ms ease-out' }
}
