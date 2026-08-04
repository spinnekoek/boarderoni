import { useEffect, useRef } from 'react'
import { useDashboardStore } from '../store'
import { useConfirmStore } from '../confirmStore'
import { useClipboardStore } from '../clipboardStore'

// widgetIds is null for a right-click on empty canvas (paste-only); set for
// a right-click on a widget, in which case it's whatever's selected at open
// time (see Canvas's handleWidgetContextMenu for how that gets decided).
export function ContextMenu({
  x,
  y,
  widgetIds,
  onClose
}: {
  x: number
  y: number
  widgetIds: string[] | null
  onClose: () => void
}): React.JSX.Element {
  const dashboard = useDashboardStore((s) => s.dashboard)
  const bringToFront = useDashboardStore((s) => s.bringToFront)
  const sendToBack = useDashboardStore((s) => s.sendToBack)
  const removeWidgets = useDashboardStore((s) => s.removeWidgets)
  const copy = useClipboardStore((s) => s.copy)
  const paste = useClipboardStore((s) => s.paste)
  const canPaste = useClipboardStore((s) => s.widgets.length > 0)
  const confirm = useConfirmStore((s) => s.confirm)
  const menuRef = useRef<HTMLDivElement>(null)

  // Mounted fresh on every open (Canvas keys it by position), so this only
  // ever sees pointerdowns/keydowns that happen after the opening click —
  // no risk of the same right-click that opened the menu closing it again.
  //
  // Capture phase, not bubble — widgets' own pointerdown handlers (drag,
  // selection) call stopPropagation, which would otherwise stop a bubble-
  // phase listener here from ever seeing a click on another widget. Capture
  // runs top-down before any of that, so it always sees the click; we just
  // have to explicitly ignore clicks that land inside the menu itself,
  // since bubbling to (and calling onClose from) here is no longer what
  // filters those out.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  async function handleDelete(): Promise<void> {
    if (!widgetIds) return
    const message =
      widgetIds.length === 1 ? 'Delete this widget? This cannot be undone.' : `Delete ${widgetIds.length} widgets? This cannot be undone.`
    const ok = await confirm(message, { confirmLabel: 'Delete' })
    if (ok) removeWidgets(widgetIds)
    onClose()
  }

  function handleCopy(): void {
    if (!widgetIds) return
    const idSet = new Set(widgetIds)
    copy(dashboard.widgets.filter((w) => idSet.has(w.id)))
    onClose()
  }

  function handlePaste(): void {
    paste()
    onClose()
  }

  function handleBringToFront(): void {
    if (!widgetIds) return
    bringToFront(widgetIds)
    onClose()
  }

  function handleSendToBack(): void {
    if (!widgetIds) return
    sendToBack(widgetIds)
    onClose()
  }

  return (
    <div ref={menuRef} className="context-menu" style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {widgetIds && (
        <button type="button" className="context-menu__item" onClick={handleCopy}>
          Copy
        </button>
      )}
      <button type="button" className="context-menu__item" disabled={!canPaste} onClick={handlePaste}>
        Paste
      </button>
      {widgetIds && (
        <>
          <div className="context-menu__divider" />
          <button type="button" className="context-menu__item" onClick={handleBringToFront}>
            Bring to front
          </button>
          <button type="button" className="context-menu__item" onClick={handleSendToBack}>
            Send to back
          </button>
          <div className="context-menu__divider" />
          <button type="button" className="context-menu__item context-menu__item--danger" onClick={handleDelete}>
            Delete
          </button>
        </>
      )}
    </div>
  )
}
