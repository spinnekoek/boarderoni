import { create } from 'zustand'
import { useDashboardStore } from './store'
import { getSubDeckWidgets } from '@shared/subDecks'
import { extractWidgetStyle, applyWidgetStyle, type StyleClipboardEntry } from './widgetStyle'
import type { Widget } from '@shared/types'

interface StyleClipboardStore {
  entry: StyleClipboardEntry | null
  copyStyle: (widget: Widget) => void
  // Paste is gated the same way ContextMenu's own paste-style button is
  // gated (see canPasteStyle there) — this re-checks type equality itself
  // rather than trusting the caller, so a stale disabled-button state can
  // never smuggle a cross-type paste through.
  pasteStyle: (widgetIds: string[]) => void
}

export const useStyleClipboardStore = create<StyleClipboardStore>((set, get) => ({
  entry: null,

  copyStyle: (widget) => set({ entry: extractWidgetStyle(widget) }),

  pasteStyle: (widgetIds) => {
    const { entry } = get()
    if (!entry) return
    const idSet = new Set(widgetIds)
    const dashboardStore = useDashboardStore.getState()
    const widgets = getSubDeckWidgets(dashboardStore.dashboard, dashboardStore.editingSubDeckId).map((w) =>
      idSet.has(w.id) ? applyWidgetStyle(w, entry) : w
    )
    dashboardStore.updateWidgets(widgets)
  }
}))
