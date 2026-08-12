import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useConfirmStore } from '../confirmStore'
import { uniqueVariableName } from '../variableNaming'
import type { SubDeck } from '@shared/types'

// One row of the popover — a plain deck's own main view (name fixed, no
// rename/delete) or a sub-deck (both). Same click-name-to-switch /
// pencil-to-rename / ×-to-delete shape as DeckPicker's own list rows, just
// condensed into a toolbar popover instead of a full-page list.
function ScreenRow({
  name,
  active,
  onSelect,
  onRename,
  onDelete
}: {
  name: string
  active: boolean
  onSelect: () => void
  onRename?: () => void
  onDelete?: () => void
}): React.JSX.Element {
  return (
    <div className={`screen-switcher__row${active ? ' screen-switcher__row--active' : ''}`}>
      <button type="button" className="screen-switcher__row-name" onClick={onSelect}>
        {name}
      </button>
      {(onRename || onDelete) && (
        <div className="screen-switcher__row-actions">
          {onRename && (
            <button
              type="button"
              className="screen-switcher__row-action"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
            >
              ✎
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="screen-switcher__row-action screen-switcher__row-action--danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Toolbar dropdown for switching which deck view (the main deck, or one of
// its sub-decks) the canvas/properties panel is currently designing, plus
// add/rename/delete for the sub-deck list — everything SubDecksModal used
// to need a separate dialog for, folded into one popover here instead.
export function ScreenSwitcher(): React.JSX.Element {
  const subDecks = useDashboardStore((s) => s.dashboard.subDecks) ?? []
  const editingSubDeckId = useDashboardStore((s) => s.editingSubDeckId)
  const setEditingSubDeck = useDashboardStore((s) => s.setEditingSubDeck)
  const addSubDeck = useDashboardStore((s) => s.addSubDeck)
  const renameSubDeck = useDashboardStore((s) => s.renameSubDeck)
  const removeSubDeck = useDashboardStore((s) => s.removeSubDeck)
  const confirm = useConfirmStore((s) => s.confirm)

  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Same capture-phase pointerdown + Escape pattern as ContextMenu.tsx/
  // ColorPickerButton.tsx.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const currentName = editingSubDeckId ? (subDecks.find((sd) => sd.id === editingSubDeckId)?.name ?? 'Main deck') : 'Main deck'

  function switchTo(subDeckId: string | null): void {
    setEditingSubDeck(subDeckId)
    setOpen(false)
  }

  function startRename(subDeck: SubDeck): void {
    setRenamingId(subDeck.id)
    setRenameValue(subDeck.name)
  }

  function commitRename(id: string): void {
    const name = renameValue.trim()
    setRenamingId(null)
    if (name) renameSubDeck(id, name)
  }

  async function handleDelete(subDeck: SubDeck): Promise<void> {
    const ok = await confirm(`Delete screen "${subDeck.name}"? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (ok) removeSubDeck(subDeck.id)
  }

  function handleAdd(): void {
    const taken = new Set(subDecks.map((sd) => sd.name))
    addSubDeck(uniqueVariableName('Screen', taken))
    setOpen(false)
  }

  return (
    <div className="screen-switcher" ref={rootRef}>
      <button type="button" className="toolbar__button screen-switcher__trigger" onClick={() => setOpen((o) => !o)}>
        {currentName} ▾
      </button>
      {open && (
        <div className="screen-switcher__menu">
          <ScreenRow name="Main deck" active={editingSubDeckId === null} onSelect={() => switchTo(null)} />
          {subDecks.map((subDeck) =>
            renamingId === subDeck.id ? (
              <input
                key={subDeck.id}
                className="screen-switcher__rename-input"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(subDeck.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <ScreenRow
                key={subDeck.id}
                name={subDeck.name}
                active={editingSubDeckId === subDeck.id}
                onSelect={() => switchTo(subDeck.id)}
                onRename={() => startRename(subDeck)}
                onDelete={() => handleDelete(subDeck)}
              />
            )
          )}
          <button type="button" className="screen-switcher__add" onClick={handleAdd}>
            + Add screen
          </button>
        </div>
      )}
    </div>
  )
}
