import { useEffect } from 'react'
import { useDashboardStore } from './store'
import { useConfirmStore } from './confirmStore'
import { useClipboardStore } from './clipboardStore'
import { getSubDeckWidgets } from '@shared/subDecks'

export function isTextInputElement(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

// Global editor keyboard shortcuts for the selected widget(s) on the canvas
// — copy/paste and delete. Lives outside any one widget component (mounted
// once by Canvas) since these should fire regardless of which widget, if
// any, last had pointer focus. The right-click context menu (ContextMenu.tsx)
// triggers the same underlying actions for the mouse-driven equivalent.
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

      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return

      const key = e.key.toLowerCase()
      if (key === 'c') {
        const { selectedWidgetIds, dashboard, editingSubDeckId } = useDashboardStore.getState()
        if (selectedWidgetIds.length === 0) return
        e.preventDefault()
        const idSet = new Set(selectedWidgetIds)
        useClipboardStore.getState().copy(getSubDeckWidgets(dashboard, editingSubDeckId).filter((w) => idSet.has(w.id)))
      } else if (key === 'v') {
        e.preventDefault()
        useClipboardStore.getState().paste()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
