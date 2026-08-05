import { useLayoutEffect, useMemo } from 'react'
import { useDashboardStore } from './store'
import { getLastDeckId } from './id'
import { Canvas } from './components/Canvas'
import { ViewCanvas } from './components/ViewCanvas'
import { Palette } from './components/Palette'
import { PropertiesPanel } from './components/PropertiesPanel'
import { Toolbar } from './components/Toolbar'
import { ConfirmModal } from './components/ConfirmModal'
import { DeckPicker } from './components/DeckPicker'

function readMode(): 'edit' | 'view' {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'view' ? 'view' : 'edit'
}

export function App(): React.JSX.Element {
  const mode = useMemo(readMode, [])
  const deckId = useDashboardStore((s) => s.deckId)
  const connect = useDashboardStore((s) => s.connect)
  const disconnect = useDashboardStore((s) => s.disconnect)
  const connected = useDashboardStore((s) => s.connected)
  const dashboardName = useDashboardStore((s) => s.dashboard.name)

  // Runs once, before paint, so a remembered deck connects straight away
  // instead of flashing the picker first. If the remembered id is stale
  // (deck since deleted), the server's 4004 close code falls back to the
  // picker anyway (see store.ts's close listener) and forgets it.
  // Deliberately mount-only: mode is stable for the component's lifetime
  // (see readMode above) and connect's identity never changes, so this
  // never needs to re-run.
  useLayoutEffect(() => {
    const lastDeckId = getLastDeckId()
    if (lastDeckId) connect(mode, lastDeckId)
  }, [])

  // ConfirmModal is hoisted above the deckId branch below so it's reachable
  // from the picker screen too (its own delete confirmation needs it), not
  // just from the editor tree.
  if (deckId === null) {
    return (
      <>
        <DeckPicker mode={mode} />
        <ConfirmModal />
      </>
    )
  }

  if (mode === 'view') {
    // No chrome here on purpose: widget (x, y) must map 1:1 to page pixels
    // from the top-left corner, matching the device-bounds rectangle shown
    // in the editor. Any header/margin here would offset that mapping.
    return <ViewCanvas />
  }

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__bar-left">
          <button className="app__back" onClick={disconnect}>
            ← Decks
          </button>
          <span className="app__title">{dashboardName}</span>
        </div>
        <span className={`app__status app__status--${connected ? 'on' : 'off'}`}>
          {connected ? 'connected' : 'disconnected'}
        </span>
      </header>
      <Toolbar />
      <div className="app__body">
        <Palette />
        <Canvas />
        <PropertiesPanel />
      </div>
      <ConfirmModal />
    </div>
  )
}
