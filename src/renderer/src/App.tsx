import { useEffect, useMemo } from 'react'
import { useDashboardStore } from './store'
import { Canvas } from './components/Canvas'
import { ViewCanvas } from './components/ViewCanvas'
import { Palette } from './components/Palette'
import { PropertiesPanel } from './components/PropertiesPanel'
import { Toolbar } from './components/Toolbar'

function readMode(): 'edit' | 'view' {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'view' ? 'view' : 'edit'
}

export function App(): React.JSX.Element {
  const mode = useMemo(readMode, [])
  const connect = useDashboardStore((s) => s.connect)
  const connected = useDashboardStore((s) => s.connected)
  const dashboardName = useDashboardStore((s) => s.dashboard.name)

  useEffect(() => {
    connect(mode)
  }, [connect, mode])

  if (mode === 'view') {
    // No chrome here on purpose: widget (x, y) must map 1:1 to page pixels
    // from the top-left corner, matching the device-bounds rectangle shown
    // in the editor. Any header/margin here would offset that mapping.
    return <ViewCanvas />
  }

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">{dashboardName}</span>
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
    </div>
  )
}
