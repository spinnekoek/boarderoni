import { useEffect, useState } from 'react'
import { useDashboardStore } from '../store'
import { useConfirmStore } from '../confirmStore'
import { SERVER_PORT } from '@shared/constants'
import type { DeckSummary } from '@shared/types'

function apiUrl(path: string): string {
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${SERVER_PORT}${path}`
}

export function DeckPicker({ mode }: { mode: 'edit' | 'view' }): React.JSX.Element {
  const connect = useDashboardStore((s) => s.connect)
  // Populated by the lobby connection (see connectLobby in store.ts) — a
  // view client no longer fetches this over REST at all, so even the deck
  // list itself goes through the same approval gate as dashboard content.
  // Edit mode ignores it entirely; the desktop is always trusted, so it
  // keeps using its own REST fetch below same as before this existed.
  const lobbyDecks = useDashboardStore((s) => s.decks)
  const confirm = useConfirmStore((s) => s.confirm)

  const [restDecks, setRestDecks] = useState<DeckSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  // Non-blocking, dismissible — collectImportWarnings' findings (an
  // unresolved REST data source, a screen-capture region that needs
  // re-picking) don't mean the import failed, just that something needs
  // manual follow-up. Separate from `error` since a successful import can
  // still have warnings, and an import error shouldn't be swallowed by
  // dismissing an unrelated stale warning (or vice versa).
  const [importWarnings, setImportWarnings] = useState<string[] | null>(null)

  const canManage = mode === 'edit'
  const decks = canManage ? restDecks : lobbyDecks

  function load(): void {
    setError(null)
    setRestDecks(null)
    fetch(apiUrl('/api/decks'))
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded ${res.status}`)
        return res.json() as Promise<DeckSummary[]>
      })
      .then(setRestDecks)
      .catch(() => setError('Could not load decks.'))
  }

  useEffect(() => {
    if (canManage) load()
  }, [])

  function openDeck(id: string): void {
    connect(mode, id)
  }

  async function handleCreate(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiUrl('/api/decks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() || undefined })
      })
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const created = (await res.json()) as DeckSummary
      openDeck(created.id)
    } catch {
      setError('Could not create a new deck.')
      setBusy(false)
    }
  }

  function startRename(deck: DeckSummary): void {
    setRenamingId(deck.id)
    setRenameValue(deck.name)
  }

  async function commitRename(id: string): Promise<void> {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name || !restDecks) return
    const previous = restDecks
    setRestDecks(restDecks.map((d) => (d.id === id ? { ...d, name } : d)))
    try {
      const res = await fetch(apiUrl(`/api/decks/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
    } catch {
      setRestDecks(previous)
      setError('Could not rename that deck.')
    }
  }

  async function handleDelete(deck: DeckSummary): Promise<void> {
    const ok = await confirm(`Delete "${deck.name}"? This cannot be undone.`, { confirmLabel: 'Delete' })
    if (!ok || !restDecks) return
    const previous = restDecks
    setRestDecks(restDecks.filter((d) => d.id !== deck.id))
    try {
      const res = await fetch(apiUrl(`/api/decks/${deck.id}`), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`Server responded ${res.status}`)
    } catch {
      setRestDecks(previous)
      setError('Could not delete that deck.')
    }
  }

  // The main process owns the native save dialog and does the file write
  // itself (see the /api/decks/:id/export handler in main/index.ts) — this
  // request just triggers it and reports whether it actually happened.
  async function handleExport(deck: DeckSummary): Promise<void> {
    if (exportingId) return
    setExportingId(deck.id)
    try {
      const res = await fetch(apiUrl(`/api/decks/${deck.id}/export`), { method: 'POST' })
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
    } catch {
      setError(`Could not export "${deck.name}".`)
    } finally {
      setExportingId(null)
    }
  }

  // Same "main process owns the native dialog" shape as export — this picks
  // the file, validates/normalizes it, writes the new deck, and returns
  // both the new DeckSummary and any collectImportWarnings findings.
  async function handleImport(): Promise<void> {
    if (importing) return
    setImporting(true)
    setImportWarnings(null)
    try {
      const res = await fetch(apiUrl('/api/decks/import'), { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not import that deck.')
        return
      }
      const body = (await res.json()) as { canceled?: true } | { deck: DeckSummary; warnings: string[] }
      if ('canceled' in body) return
      load()
      if (body.warnings.length > 0) setImportWarnings(body.warnings)
    } catch {
      setError('Could not import that deck.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="deck-picker">
      <div className="deck-picker__panel">
        <h1 className="deck-picker__title">Decks</h1>

        {error && (
          <div className="deck-picker__error">
            <p>{error}</p>
            <button className="deck-picker__retry" onClick={load}>
              Retry
            </button>
          </div>
        )}

        {importWarnings && (
          <div className="deck-picker__error">
            <p>Deck imported, but needs a look:</p>
            <ul>
              {importWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <button className="deck-picker__retry" onClick={() => setImportWarnings(null)}>
              Dismiss
            </button>
          </div>
        )}

        {decks === null && !error && <p className="deck-picker__hint">Loading decks…</p>}

        {decks !== null && decks.length === 0 && !error && (
          <p className="deck-picker__hint">
            {canManage ? 'No decks yet — create your first one below.' : 'No decks yet — create one from the desktop editor.'}
          </p>
        )}

        {decks !== null && decks.length > 0 && (
          <ul className="deck-picker__list">
            {decks.map((deck) => (
              <li key={deck.id} className="deck-picker__item">
                {renamingId === deck.id ? (
                  <input
                    className="deck-picker__rename-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(deck.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <button className="deck-picker__item-name" onClick={() => openDeck(deck.id)}>
                    {deck.name}
                  </button>
                )}
                {canManage && renamingId !== deck.id && (
                  <div className="deck-picker__item-actions">
                    <button
                      className="deck-picker__item-action"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(deck)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="deck-picker__item-action"
                      title="Export"
                      disabled={exportingId === deck.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExport(deck)
                      }}
                    >
                      ⇩
                    </button>
                    <button
                      className="deck-picker__item-action deck-picker__item-action--danger"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(deck)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="deck-picker__create">
            <input
              placeholder="New deck name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
            <button disabled={busy} onClick={handleCreate}>
              + Create
            </button>
            <button disabled={importing} onClick={handleImport}>
              Import…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
