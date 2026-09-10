import { useEffect } from 'react'
import { useDashboardStore } from './store'
import { useConfirmStore } from './confirmStore'
import { useClipboardStore } from './clipboardStore'
import { useHistoryStore } from './historyStore'
import { getSubDeckWidgets, getSubDeckGridSize } from '@shared/subDecks'

export function isTextInputElement(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

// [dx, dy] per arrow key, in grid-step units — multiplied by the actual
// pixel step (gridSize, or 1 with Ctrl/Cmd held — see handleKeyDown) at
// nudge time.
const NUDGE_DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
}

// Global editor keyboard shortcuts for the selected widget(s) on the canvas
// — copy/paste, delete, arrow-key nudging, and undo/redo (historyStore.ts).
// Lives outside any one widget component (mounted once by Canvas) since
// these should fire regardless of which widget, if any, last had pointer
// focus. The right-click context menu (ContextMenu.tsx) triggers the same
// underlying actions for the mouse-driven equivalent (copy/paste/delete;
// there's no mouse equivalent of a nudge or undo/redo).
export function useEditorShortcuts(): void {
  useEffect(() => {
    async function handleDelete(ids: string[]): Promise<void> {
      const confirm = useConfirmStore.getState().confirm
      const message = ids.length === 1 ? 'Delete this widget? This cannot be undone.' : `Delete ${ids.length} widgets? This cannot be undone.`
      const ok = await confirm(message, { confirmLabel: 'Delete' })
      if (ok) useDashboardStore.getState().removeWidgets(ids)
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (isTextInputElement(document.activeElement)) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedWidgetIds } = useDashboardStore.getState()
        if (selectedWidgetIds.length === 0) return
        e.preventDefault()
        void handleDelete(selectedWidgetIds)
        return
      }

      const direction = NUDGE_DIRECTIONS[e.key]
      if (direction) {
        const { selectedWidgetIds, dashboard, editingSubDeckId, updateWidgets } = useDashboardStore.getState()
        if (selectedWidgetIds.length === 0) return
        e.preventDefault()
        // Ctrl/Cmd steps by a single pixel for fine adjustment; otherwise by
        // this screen's own grid size — same value Toolbar's "Grid size"
        // field edits — regardless of whether "Snap to grid" is currently
        // on, since a keyboard nudge is already exact, not a drag that
        // needs snapping.
        const step = e.ctrlKey || e.metaKey ? 1 : getSubDeckGridSize(dashboard, editingSubDeckId)
        const [dx, dy] = direction
        const idSet = new Set(selectedWidgetIds)
        const widgets = getSubDeckWidgets(dashboard, editingSubDeckId)
        updateWidgets(widgets.map((w) => (idSet.has(w.id) ? { ...w, x: w.x + dx * step, y: w.y + dy * step } : w)))
        return
      }

      if (!(e.ctrlKey || e.metaKey) || e.altKey) return

      const key = e.key.toLowerCase()
      if (key === 'c' && !e.shiftKey) {
        // A real, non-empty text selection (e.g. log lines picked in the
        // debug console panel) means Ctrl+C should do the browser's own
        // native copy, not this shortcut's widget-copy — isTextInputElement
        // above only catches an actual input/textarea/contentEditable
        // focused, not plain selectable text sitting in a <span>/<div>.
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed && selection.toString().length > 0) return
        const { selectedWidgetIds, dashboard, editingSubDeckId } = useDashboardStore.getState()
        if (selectedWidgetIds.length === 0) return
        e.preventDefault()
        const idSet = new Set(selectedWidgetIds)
        useClipboardStore.getState().copy(getSubDeckWidgets(dashboard, editingSubDeckId).filter((w) => idSet.has(w.id)))
      } else if (key === 'v' && !e.shiftKey) {
        e.preventDefault()
        useClipboardStore.getState().paste()
      } else if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useHistoryStore.getState().undo()
      } else if (key === 'z' && e.shiftKey) {
        e.preventDefault()
        useHistoryStore.getState().redo()
      } else if (key === 'a' && !e.shiftKey) {
        e.preventDefault()
        const { dashboard, editingSubDeckId, selectWidgets } = useDashboardStore.getState()
        // Only whichever sub-deck is currently being edited — same scoping
        // every other shortcut here (nudge, copy) already uses via
        // getSubDeckWidgets, so this can't reach across into a sub-deck
        // that isn't even on screen right now.
        const widgets = getSubDeckWidgets(dashboard, editingSubDeckId)
        if (widgets.length === 0) return
        // Not additive — Ctrl+A means "select all," replacing whatever was
        // already selected, same as every other app's select-all.
        selectWidgets(widgets.map((w) => w.id))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
