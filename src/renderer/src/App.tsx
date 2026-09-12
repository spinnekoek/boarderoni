import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useDashboardStore } from './store'
import { getLastDeckId } from './id'
import { Canvas } from './components/Canvas'
import { ViewCanvas } from './components/ViewCanvas'
import { Palette } from './components/Palette'
import { PropertiesPanel } from './components/PropertiesPanel'
import { Toolbar } from './components/Toolbar'
import { ConfirmModal } from './components/ConfirmModal'
import { PromptModal } from './components/PromptModal'
import { VariantWarningToasts } from './components/VariantWarningToasts'
import { DeckPicker } from './components/DeckPicker'
import { DeviceApprovalBanner } from './components/DeviceApprovalBanner'
import { DebugPanel } from './components/DebugPanel'
import { StatusBar } from './components/StatusBar'

function readMode(): 'edit' | 'view' {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'view' ? 'view' : 'edit'
}

// Passed by main/index.ts's createEditorWindow as a query param (same
// mechanism as mode above) rather than read from package.json directly —
// the renderer bundle is also served as-is to Android view clients, which
// have no window title bar to show it in and no reason to know it.
function readVersion(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('version') ?? ''
}

export function App(): React.JSX.Element {
  const mode = useMemo(readMode, [])
  const version = useMemo(readVersion, [])
  const deckId = useDashboardStore((s) => s.deckId)
  const connect = useDashboardStore((s) => s.connect)
  const connectLobby = useDashboardStore((s) => s.connectLobby)
  const dashboardName = useDashboardStore((s) => s.dashboard.name)
  const devicePending = useDashboardStore((s) => s.devicePending)
  const deviceDenied = useDashboardStore((s) => s.deviceDenied)

  // Runs once, before paint, so a remembered deck connects straight away
  // instead of flashing the picker first. If the remembered id is stale
  // (deck since deleted), the server's 4004 close code falls back to the
  // picker anyway (see store.ts's close listener) and forgets it. Without a
  // remembered deck, a view client still needs to clear approval before it
  // can even see the deck list — see connectLobby's comment; an edit client
  // never does (the desktop is always trusted) and just shows the picker's
  // own REST-fetched list instead. Deliberately mount-only: mode is stable
  // for the component's lifetime (see readMode above) and connect/
  // connectLobby's identities never change, so this never needs to re-run.
  useLayoutEffect(() => {
    const lastDeckId = getLastDeckId()
    if (lastDeckId) {
      connect(mode, lastDeckId)
    } else if (mode === 'view') {
      connectLobby()
    }
  }, [])

  // Editor-only (see readVersion above — a view client's WebView title bar
  // isn't visible anyway): reflects the loaded deck's own name in the OS
  // window title, in addition to the same name already shown in-app
  // (header, moved into Toolbar's "← Decks" button's neighborhood). Plain
  // document.title assignment — Electron's default 'page-title-updated'
  // handling reflects it to the actual window chrome with no IPC needed.
  useEffect(() => {
    if (mode !== 'edit') return
    document.title = deckId !== null ? `${dashboardName} - Boarderoni v${version}` : `Boarderoni v${version}`
  }, [mode, deckId, dashboardName, version])

  // Applies whether or not a deck has been chosen yet — a pending/denied
  // view device shouldn't see even the deck list, let alone a dashboard
  // (see connectLobby/DeckPicker's view-mode branch, which is what this
  // otherwise sits in front of).
  if (mode === 'view' && deviceDenied) {
    return <div className="view-status-screen">This device was denied access. Ask someone with an approved device to let it in, then reopen the app.</div>
  }
  if (mode === 'view' && devicePending) {
    return <div className="view-status-screen">Waiting for approval on the desktop…</div>
  }

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
    return (
      <>
        <ViewCanvas />
        <DeviceApprovalBanner />
      </>
    )
  }

  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        <Palette />
        <Canvas />
        <PropertiesPanel />
      </div>
      <DebugPanel />
      <StatusBar />
      <ConfirmModal />
      <PromptModal />
      <VariantWarningToasts />
      <DeviceApprovalBanner />
    </div>
  )
}
