import { create } from 'zustand'
import { useDashboardStore } from './store'
import { nextId } from './id'
import type { Widget } from '@shared/types'

// Pixel offset applied per paste (compounding with paste count), so pasting
// the same clipboard repeatedly fans copies out instead of stacking them
// exactly on top of each other and their source.
const PASTE_OFFSET = 24

function cloneWidget(widget: Widget, offset: number): Widget {
  return {
    ...widget,
    id: nextId(),
    x: widget.x + offset,
    y: widget.y + offset,
    states: widget.states.map((state) => ({
      ...state,
      id: nextId(),
      labels: state.labels.map((label) => ({ ...label, id: nextId() }))
    }))
  }
}

interface ClipboardStore {
  widgets: Widget[]
  pasteCount: number
  copy: (widgets: Widget[]) => void
  paste: () => void
}

// Editor-local clipboard, shared between the keyboard shortcuts (Ctrl+C/V)
// and the right-click context menu — both just call these two actions
// instead of each keeping their own copy of "what's copied."
export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  widgets: [],
  pasteCount: 0,

  copy: (widgets) => set({ widgets, pasteCount: 0 }),

  paste: () => {
    const { widgets, pasteCount } = get()
    if (widgets.length === 0) return
    const nextCount = pasteCount + 1
    const offset = PASTE_OFFSET * nextCount
    set({ pasteCount: nextCount })
    useDashboardStore.getState().pasteWidgets(widgets.map((w) => cloneWidget(w, offset)))
  }
}))
