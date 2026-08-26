import { useEffect, useRef } from 'react'
import { useDebugConsoleStore } from '../debugConsoleStore'

interface ResizeState {
  startY: number
  startHeight: number
}

export function DebugPanel(): React.JSX.Element | null {
  const open = useDebugConsoleStore((s) => s.open)
  const logs = useDebugConsoleStore((s) => s.logs)
  const setOpen = useDebugConsoleStore((s) => s.setOpen)
  const clearLogs = useDebugConsoleStore((s) => s.clearLogs)
  const groupSimilar = useDebugConsoleStore((s) => s.groupSimilar)
  const toggleGroupSimilar = useDebugConsoleStore((s) => s.toggleGroupSimilar)
  const height = useDebugConsoleStore((s) => s.height)
  const setHeight = useDebugConsoleStore((s) => s.setHeight)
  const listRef = useRef<HTMLDivElement>(null)
  const resizeState = useRef<ResizeState | null>(null)

  // Sticks to the newest entry as more come in, same as a real devtools
  // console — only while already at (or starting at) the bottom, so
  // scrolling up to read older entries doesn't get yanked back down.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [logs])

  function handleResizePointerDown(e: React.PointerEvent): void {
    resizeState.current = { startY: e.clientY, startHeight: height }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // best-effort, see CanvasWidget's handlePointerDown
    }
  }

  function handleResizePointerMove(e: React.PointerEvent): void {
    const state = resizeState.current
    if (!state) return
    // The handle sits on the panel's own top edge, and the panel itself is
    // pinned to the window's bottom edge (see App.tsx) — dragging up
    // (clientY decreasing) should grow it, the reverse of a left-edge
    // handle's dx (see PropertiesPanel.tsx's own handleResizePointerMove).
    setHeight(state.startHeight + (state.startY - e.clientY))
  }

  function handleResizePointerUp(): void {
    resizeState.current = null
  }

  if (!open) return null

  return (
    <div className="debug-panel" style={{ height }}>
      <div
        className="debug-panel__resize-handle"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
      />
      <div className="debug-panel__header">
        <span className="debug-panel__title">Console</span>
        <span className="debug-panel__hint">console.log from any fx expression prints here while this panel is open</span>
        <button
          type="button"
          className={`debug-panel__button${groupSimilar ? ' debug-panel__button--active' : ''}`}
          title="Combine consecutive identical console lines into one, with a repeat-count badge — same as Chrome DevTools."
          onClick={toggleGroupSimilar}
        >
          Group similar
        </button>
        <button type="button" className="debug-panel__button" onClick={clearLogs}>
          Clear
        </button>
        <button type="button" className="debug-panel__button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="debug-panel__list" ref={listRef}>
        {logs.length === 0 ? (
          <div className="debug-panel__empty">No console output yet.</div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="debug-panel__entry">
              <span className="debug-panel__time">{new Date(entry.time).toLocaleTimeString()}</span>
              {entry.count > 1 && <span className="debug-panel__badge">{entry.count}</span>}
              <span className="debug-panel__message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
