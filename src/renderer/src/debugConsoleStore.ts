import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setExpressionConsoleSink } from '@shared/expr'

export interface DebugLogEntry {
  id: number
  time: number
  message: string
  // How many consecutive times this exact message has logged in a row —
  // only ever >1 when groupSimilar is on (see below); a fresh entry (or any
  // entry logged while grouping is off) always starts at 1.
  count: number
}

// Caps memory/DOM growth from a runaway expression logging every frame —
// oldest entries just fall off the front, same tradeoff as a real devtools
// console's own scrollback limit.
const MAX_LOG_ENTRIES = 500

const MIN_PANEL_HEIGHT = 100
const MAX_PANEL_HEIGHT = 640
const DEFAULT_PANEL_HEIGHT = 220

interface DebugConsoleState {
  open: boolean
  logs: DebugLogEntry[]
  // Chrome devtools' own default behavior — a message logged back-to-back
  // collapses onto its previous line with a repeat-count badge instead of
  // spamming a new line each time. Toggleable per the panel's own button;
  // turning it off only affects new entries going forward, it doesn't
  // retroactively split already-grouped ones back apart.
  groupSimilar: boolean
  // Drag-resized via the panel's own top-edge handle — persisted (unlike
  // `open`/`logs` below) since it's a size preference, same as
  // settingsStore's propertiesWidth.
  height: number
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  clearLogs: () => void
  toggleGroupSimilar: () => void
  setHeight: (value: number) => void
}

let nextLogId = 0

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

export const useDebugConsoleStore = create<DebugConsoleState>()(
  persist(
    (set) => ({
      open: false,
      logs: [],
      groupSimilar: true,
      height: DEFAULT_PANEL_HEIGHT,
      setOpen: (open) => set({ open }),
      toggleOpen: () => set((s) => ({ open: !s.open })),
      clearLogs: () => set({ logs: [] }),
      toggleGroupSimilar: () => set((s) => ({ groupSimilar: !s.groupSimilar })),
      setHeight: (value) => set({ height: Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(value))) })
    }),
    {
      name: 'boarderoni-debug-console',
      // Transient — reopening the app with the panel already open (or full
      // of last session's logs) would be a surprise, not a convenience, same
      // reasoning as settingsStore's own settingsModalOpen/camera exclusions.
      partialize: (state) => {
        const { open: _open, logs: _logs, ...rest } = state
        return rest
      }
    }
  )
)

// Registered once at module load — always wired up, but the sink itself
// checks `open` (see useDebugConsoleStore.getState() below) so a
// console.log from an expression is silently dropped whenever the panel
// isn't open, per the panel's whole point: it's a debug view, not a second
// always-on log store.
setExpressionConsoleSink((args) => {
  if (!useDebugConsoleStore.getState().open) return
  const message = args.map(formatArg).join(' ')
  // Deferred a tick — an expression's console.log can fire mid-render (e.g.
  // a label's textExpr, evaluated inline while its widget renders), and
  // updating this store synchronously at that point is a React "setState
  // while rendering a different component" violation. A microtask runs
  // right after the current render finishes, not on some later frame, so
  // the panel still updates effectively immediately.
  queueMicrotask(() => {
    if (!useDebugConsoleStore.getState().open) return
    useDebugConsoleStore.setState((s) => {
      const last = s.logs[s.logs.length - 1]
      if (s.groupSimilar && last && last.message === message) {
        const bumped: DebugLogEntry = { ...last, count: last.count + 1, time: Date.now() }
        return { logs: [...s.logs.slice(0, -1), bumped] }
      }
      const entry: DebugLogEntry = { id: nextLogId++, time: Date.now(), message, count: 1 }
      return { logs: [...s.logs, entry].slice(-MAX_LOG_ENTRIES) }
    })
  })
})
