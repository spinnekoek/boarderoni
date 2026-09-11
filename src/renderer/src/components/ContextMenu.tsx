import { useEffect, useRef } from 'react'
import { useDashboardStore } from '../store'
import { useConfirmStore } from '../confirmStore'
import { usePromptStore } from '../promptStore'
import { useClipboardStore } from '../clipboardStore'
import { useStyleClipboardStore } from '../styleClipboardStore'
import { getSubDeckWidgets } from '@shared/subDecks'

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
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  const bringToFront = useDashboardStore((s) => s.bringToFront)
  const sendToBack = useDashboardStore((s) => s.sendToBack)
  const removeWidgets = useDashboardStore((s) => s.removeWidgets)
  const groupWidgets = useDashboardStore((s) => s.groupWidgets)
  const ungroupWidgets = useDashboardStore((s) => s.ungroupWidgets)
  const saveCustomVariant = useDashboardStore((s) => s.saveCustomVariant)
  const copy = useClipboardStore((s) => s.copy)
  const paste = useClipboardStore((s) => s.paste)
  const canPaste = useClipboardStore((s) => s.widgets.length > 0)
  const copyStyle = useStyleClipboardStore((s) => s.copyStyle)
  const pasteStyle = useStyleClipboardStore((s) => s.pasteStyle)
  const styleClipboardType = useStyleClipboardStore((s) => s.entry?.widgetType)
  const confirm = useConfirmStore((s) => s.confirm)
  const prompt = usePromptStore((s) => s.prompt)
  const menuRef = useRef<HTMLDivElement>(null)

  // Only meaningful once widgetIds is set (a right-click on a widget, not
  // empty canvas) — see canCopyStyle/canPasteStyle below.
  const selectedWidgets = widgetIds
    ? getSubDeckWidgets(dashboard, editingSubDeckId).filter((w) => widgetIds.includes(w.id))
    : []
  // Copying "the style" only makes sense from a single, unambiguous source
  // widget — same reasoning ContextMenu's own comment gives for widgetIds
  // being "whatever's selected at open time."
  const canCopyStyle = selectedWidgets.length === 1
  // Same-type-only, per the feature's own requirement: a rotary's style can
  // only paste onto another rotary, never a button, etc.
  const canPasteStyle =
    styleClipboardType !== undefined && selectedWidgets.length > 0 && selectedWidgets.every((w) => w.type === styleClipboardType)
  // "Group" always just reassigns a fresh groupId to whatever's currently
  // selected — regrouping an existing group or forming a new one from a
  // plain multi-select are both fine, so the only requirement is 2+ widgets.
  const canGroup = selectedWidgets.length > 1
  // "Ungroup" only makes sense when the CURRENT selection is exactly one
  // full existing group — every member shares the same non-null groupId.
  const canUngroup =
    selectedWidgets.length > 1 &&
    selectedWidgets[0].groupId != null &&
    selectedWidgets.every((w) => w.groupId === selectedWidgets[0].groupId)

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
    // Close right away, same as every other action below — awaiting
    // confirm() first (as this used to) left the context menu sitting open
    // behind the confirmation modal for as long as it took to answer.
    onClose()
    const message =
      widgetIds.length === 1 ? 'Delete this widget? This cannot be undone.' : `Delete ${widgetIds.length} widgets? This cannot be undone.`
    const ok = await confirm(message, { confirmLabel: 'Delete' })
    if (ok) removeWidgets(widgetIds)
  }

  function handleCopy(): void {
    if (!widgetIds) return
    const idSet = new Set(widgetIds)
    copy(getSubDeckWidgets(dashboard, editingSubDeckId).filter((w) => idSet.has(w.id)))
    onClose()
  }

  function handlePaste(): void {
    paste()
    onClose()
  }

  function handleCopyStyle(): void {
    if (selectedWidgets.length !== 1) return
    copyStyle(selectedWidgets[0])
    onClose()
  }

  function handlePasteStyle(): void {
    if (!widgetIds) return
    pasteStyle(widgetIds)
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

  function handleGroup(): void {
    if (!widgetIds) return
    groupWidgets(widgetIds)
    onClose()
  }

  function handleUngroup(): void {
    if (!widgetIds) return
    ungroupWidgets(widgetIds)
    onClose()
  }

  // A single selected widget saves as a single-widget variant (see its own
  // type's split-button dropdown in Palette.tsx); 2+ saves as a group
  // variant (Palette's standalone "Custom Variants" button) — same
  // permissive "any multi-select, not just an already-formed group"
  // threshold canGroup's own "Group" action uses. x/y normalized so the
  // saved widget(s)' own top-left sits at (0, 0) — see CustomVariant's own
  // comment in shared/types.ts for why: the palette adds the spawn position
  // back on, so a variant saved from anywhere on the canvas always drops in
  // wherever the user's currently looking, not back at its original spot.
  async function handleSaveVariant(): Promise<void> {
    if (selectedWidgets.length === 0) return
    onClose()
    const name = await prompt('Name this variant:', { confirmLabel: 'Save' })
    if (!name) return
    const minX = Math.min(...selectedWidgets.map((w) => w.x))
    const minY = Math.min(...selectedWidgets.map((w) => w.y))
    saveCustomVariant(
      name,
      selectedWidgets.map((w) => ({ ...w, x: w.x - minX, y: w.y - minY }))
    )
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
          {canCopyStyle && (
            <button type="button" className="context-menu__item" onClick={handleCopyStyle}>
              Copy style
            </button>
          )}
          <button type="button" className="context-menu__item" disabled={!canPasteStyle} onClick={handlePasteStyle}>
            Paste style
          </button>
          <div className="context-menu__divider" />
          <button type="button" className="context-menu__item" onClick={handleBringToFront}>
            Bring to front
          </button>
          <button type="button" className="context-menu__item" onClick={handleSendToBack}>
            Send to back
          </button>
          <div className="context-menu__divider" />
          <button type="button" className="context-menu__item" disabled={!canGroup} onClick={handleGroup}>
            Group
          </button>
          <button type="button" className="context-menu__item" disabled={!canUngroup} onClick={handleUngroup}>
            Ungroup
          </button>
          <div className="context-menu__divider" />
          <button type="button" className="context-menu__item" onClick={handleSaveVariant}>
            Save as variant
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
