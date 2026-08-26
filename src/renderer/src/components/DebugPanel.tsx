import { useEffect, useRef } from 'react'
import { useDebugConsoleStore } from '../debugConsoleStore'

export function DebugPanel(): React.JSX.Element | null {
  const open = useDebugConsoleStore((s) => s.open)
  const logs = useDebugConsoleStore((s) => s.logs)
  const setOpen = useDebugConsoleStore((s) => s.setOpen)
  const clearLogs = useDebugConsoleStore((s) => s.clearLogs)
  const groupSimilar = useDebugConsoleStore((s) => s.groupSimilar)
  const toggleGroupSimilar = useDebugConsoleStore((s) => s.toggleGroupSimilar)
  const listRef = useRef<HTMLDivElement>(null)

  // Sticks to the newest entry as more come in, same as a real devtools
  // console — only while already at (or starting at) the bottom, so
  // scrolling up to read older entries doesn't get yanked back down.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [logs])

  if (!open) return null

  return (
    <div className="debug-panel">
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
