import { useState } from 'react'
import { useEditorSettings } from '../settingsStore'
import { useDebugConsoleStore } from '../debugConsoleStore'
import { useHistoryStore } from '../historyStore'
import { useDashboardStore, useGridSize } from '../store'
import { DEVICE_PRESETS } from '../devicePresets'
import { displayDeviceName } from '@shared/deviceName'
import { VariablesModal } from './VariablesModal'
import { PluginsModal } from './PluginsModal'
import { EventSourcesModal } from './EventSourcesModal'
import { FontsModal } from './FontsModal'
import { DevicesModal } from './DevicesModal'
import { MobileAppModal } from './MobileAppModal'
import { ScreenSwitcher } from './ScreenSwitcher'

export function Toolbar(): React.JSX.Element {
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [eventSourcesOpen, setEventSourcesOpen] = useState(false)
  const [fontsOpen, setFontsOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [mobileAppOpen, setMobileAppOpen] = useState(false)
  // Store-backed, not local state — see settingsStore.ts's openPluginsModal
  // comment for why: EventSourcesModal's own "this plugin is disabled" hint
  // needs to open (and focus) this modal from outside Toolbar's own tree.
  const pluginsOpen = useEditorSettings((s) => s.pluginsModalOpen)
  const openPluginsModal = useEditorSettings((s) => s.openPluginsModal)
  const closePluginsModal = useEditorSettings((s) => s.closePluginsModal)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useGridSize()
  const setSnapToGrid = useEditorSettings((s) => s.setSnapToGrid)
  const setGridSize = useDashboardStore((s) => s.setGridSize)
  const selectedDeviceId = useEditorSettings((s) => s.selectedDeviceId)
  const setSelectedDeviceId = useEditorSettings((s) => s.setSelectedDeviceId)
  const debugMode = useEditorSettings((s) => s.debugMode)
  const setDebugMode = useEditorSettings((s) => s.setDebugMode)
  const consoleOpen = useDebugConsoleStore((s) => s.open)
  const toggleConsoleOpen = useDebugConsoleStore((s) => s.toggleOpen)
  const canUndo = useHistoryStore((s) => s.past.length > 0)
  const canRedo = useHistoryStore((s) => s.future.length > 0)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  const devices = useDashboardStore((s) => s.devices)

  const selectedConnectedDevice = devices.find((d) => d.id === selectedDeviceId)

  return (
    <div className="toolbar">
      <button type="button" className="toolbar__button" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        Undo
      </button>
      <button type="button" className="toolbar__button" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        Redo
      </button>
      <ScreenSwitcher />
      <label className="toolbar__control">
        <span>Device</span>
        <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
          <optgroup label="Presets">
            {DEVICE_PRESETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </optgroup>
          {devices.length > 0 && (
            <optgroup label="Devices">
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {displayDeviceName(d)} — {d.width}×{d.height}
                  {d.connected ? '' : ' (disconnected)'}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {selectedConnectedDevice && (
          <span className={`app__status app__status--${selectedConnectedDevice.connected ? 'on' : 'off'}`}>
            {selectedConnectedDevice.connected ? 'online' : 'offline'}
          </span>
        )}
      </label>
      <label className="toolbar__control">
        <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
        Snap to grid
      </label>
      <label
        className={`toolbar__control${!snapToGrid ? ' toolbar__control--disabled' : ''}`}
        title="Its own value per screen — switching screens (ScreenSwitcher, to the left) shows that screen's own grid size, not one shared across the whole deck."
      >
        <span>Grid size</span>
        <input
          type="number"
          min={1}
          value={gridSize}
          disabled={!snapToGrid}
          onChange={(e) => setGridSize(Number(e.target.value))}
        />
        <span className="toolbar__unit">px</span>
      </label>
      <label className="toolbar__control" title="Shows editor-only layout aids, like each position label's own alignment box, on the canvas.">
        <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
        Debug
      </label>
      <button
        type="button"
        className={`toolbar__button${consoleOpen ? ' toolbar__button--active' : ''}`}
        title="Shows a bottom panel that console.log from any fx expression prints to, while this panel is open."
        onClick={toggleConsoleOpen}
      >
        Console
      </button>
      <button type="button" className="toolbar__button" onClick={() => setMobileAppOpen(true)}>
        Mobile app
      </button>
      <button type="button" className="toolbar__button" onClick={() => openPluginsModal()}>
        Plugins
      </button>
      <button type="button" className="toolbar__button" onClick={() => setEventSourcesOpen(true)}>
        Event Sources
      </button>
      <button type="button" className="toolbar__button" onClick={() => setFontsOpen(true)}>
        Fonts
      </button>
      <button type="button" className="toolbar__button" onClick={() => setDevicesOpen(true)}>
        Devices
      </button>
      <button type="button" className="toolbar__button" onClick={() => setVariablesOpen(true)}>
        Variables
      </button>
      {mobileAppOpen && <MobileAppModal onClose={() => setMobileAppOpen(false)} />}
      {pluginsOpen && <PluginsModal onClose={closePluginsModal} />}
      {eventSourcesOpen && <EventSourcesModal onClose={() => setEventSourcesOpen(false)} />}
      {fontsOpen && <FontsModal onClose={() => setFontsOpen(false)} />}
      {devicesOpen && <DevicesModal onClose={() => setDevicesOpen(false)} />}
      {variablesOpen && <VariablesModal onClose={() => setVariablesOpen(false)} />}
    </div>
  )
}
