import { create } from 'zustand'
import { useDashboardStore } from './store'
import { findWidgetAnywhere } from '@shared/subDecks'
import type { Dashboard } from '@shared/types'

// Bounds memory the same way toasts/debug logs already cap themselves
// elsewhere in this app — undo history isn't meant to reach back to the
// start of a long editing session, just cover recent work.
const MAX_HISTORY_ENTRIES = 100

// Below this many ms since the last recordBeforeMutation call, a new
// property-edit/meta-change call merges into whatever undo entry is already
// open instead of pushing its own — otherwise typing one word into a label
// field would take 5 separate Ctrl+Z presses to undo. Doesn't apply to a
// widget-drag's own coalescing (see `coalescing` below), which is bounded by
// the gesture itself (final:false/true) rather than a timeout, so a slow,
// deliberate drag with pauses still stays one undo step throughout.
const COALESCE_WINDOW_MS = 500

interface HistoryStore {
  past: Dashboard[]
  future: Dashboard[]
  // True for the duration of an in-flight widget drag (between the first
  // final:false tick and its matching final:true commit) — see
  // recordBeforeMutation.
  coalescing: boolean
  lastActionAt: number
  // Called by store.ts as the FIRST line of every action that's about to
  // mutate `dashboard` — captures the PRE-mutation value as this edit's undo
  // target, subject to the coalescing rules above. `options.final` mirrors
  // updateWidgets' own final param 1:1 (undefined for every other mutating
  // action, which always goes through the idle-time path instead).
  recordBeforeMutation: (options?: { final?: boolean }) => void
  undo: () => void
  redo: () => void
  // Deck switch (connect/disconnect in store.ts) — undo history from one
  // deck has no meaning once you're looking at a different one.
  clear: () => void
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  coalescing: false,
  lastActionAt: 0,

  recordBeforeMutation: (options) => {
    const { coalescing, lastActionAt, past } = get()
    const dashboard = useDashboardStore.getState().dashboard

    if (options?.final === false) {
      if (coalescing) return
      set({ past: [...past, dashboard].slice(-MAX_HISTORY_ENTRIES), future: [], coalescing: true, lastActionAt: Date.now() })
      return
    }
    if (options?.final === true && coalescing) {
      // The drag's commit tick — the pre-drag snapshot already went in on
      // the first final:false tick above, so this just closes the gesture.
      set({ coalescing: false, lastActionAt: Date.now() })
      return
    }
    if (Date.now() - lastActionAt < COALESCE_WINDOW_MS) {
      // Merges into the still-open previous entry — reset the idle clock so
      // a steady burst of keystrokes/nudges keeps extending it rather than
      // splitting after exactly COALESCE_WINDOW_MS regardless of activity.
      set({ lastActionAt: Date.now() })
      return
    }
    set({ past: [...past, dashboard].slice(-MAX_HISTORY_ENTRIES), future: [], lastActionAt: Date.now() })
  },

  undo: () => {
    const { past } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const current = useDashboardStore.getState().dashboard
    set((s) => ({ past: past.slice(0, -1), future: [...s.future, current] }))
    applyRestoredDashboard(previous)
  },

  redo: () => {
    const { future } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    const current = useDashboardStore.getState().dashboard
    set((s) => ({ future: future.slice(0, -1), past: [...s.past, current] }))
    applyRestoredDashboard(next)
  },

  clear: () => set({ past: [], future: [], coalescing: false, lastActionAt: 0 })
}))

// Restoring a snapshot from before/after a widget was deleted (or a
// sub-deck removed out from under it) can easily leave the current
// selection pointing at ids that no longer exist in `dashboard` — dangling
// selection nothing else in the app expects, since every other
// selection-changing action already clears/replaces it wholesale (see
// selectWidget/pasteWidgets/removeWidget(s) in store.ts). Filtering here
// once, on the way in, is simpler than teaching every selection-reading
// component to tolerate a stale id.
function applyRestoredDashboard(dashboard: Dashboard): void {
  useDashboardStore.getState().restoreDashboard(dashboard)
  const { selectedWidgetIds, selectedBlockId } = useDashboardStore.getState()
  const stillSelected = selectedWidgetIds.filter((id) => findWidgetAnywhere(dashboard, id) !== undefined)
  if (stillSelected.length !== selectedWidgetIds.length) {
    useDashboardStore.setState({
      selectedWidgetIds: stillSelected,
      selectedBlockId: stillSelected.length === 0 ? null : selectedBlockId
    })
  }
}
