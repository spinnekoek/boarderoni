import { create } from 'zustand'
import { useDashboardStore } from './store'
import { nextId } from './id'
import type { Widget } from '@shared/types'

// Pixel offset applied per paste (compounding with paste count), so pasting
// the same clipboard repeatedly fans copies out instead of stacking them
// exactly on top of each other and their source.
const PASTE_OFFSET = 24

function cloneWidget(widget: Widget, offset: number): Widget {
  if (widget.type === 'gauge' || widget.type === 'adjuster' || widget.type === 'encoder') {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      labels: widget.labels.map((label) => ({ ...label, id: nextId() }))
    }
  }

  if (widget.type === 'switch-rocker' || widget.type === 'switch-dial' || widget.type === 'dropdown') {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      positions: widget.positions.map((position) => ({
        ...position,
        id: nextId(),
        labels: position.labels.map((label) => ({ ...label, id: nextId() }))
      }))
    }
  }

  // Tracks old state id -> new state id so a morph widget's blocks (below)
  // can rekey their perState overrides onto the states they actually get
  // cloned alongside, instead of pointing at ids that no longer exist.
  const stateIdMap = new Map<string, string>()
  const states = widget.states.map((state) => {
    const newStateId = nextId()
    stateIdMap.set(state.id, newStateId)
    return { ...state, id: newStateId, labels: state.labels.map((label) => ({ ...label, id: nextId() })) }
  })

  if (widget.type === 'morph') {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      states,
      blocks: widget.blocks.map((block) => ({
        ...block,
        id: nextId(),
        perState: Object.fromEntries(
          Object.entries(block.perState).map(([stateId, override]) => [stateIdMap.get(stateId) ?? stateId, override])
        )
      }))
    }
  }

  return { ...widget, id: nextId(), x: widget.x + offset, y: widget.y + offset, states }
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
