import { useState } from 'react'
import { useEditorSettings } from '../settingsStore'
import { useDashboardStore } from '../store'
import { DEVICE_PRESETS } from '../devicePresets'
import { displayDeviceName } from '@shared/deviceName'
import { VariablesModal } from './VariablesModal'
import { EventsModal } from './EventsModal'
import { SettingsModal } from './SettingsModal'
import { MobileAppModal } from './MobileAppModal'
import { ScreenSwitcher } from './ScreenSwitcher'

export function Toolbar(): React.JSX.Element {
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [mobileAppOpen, setMobileAppOpen] = useState(false)
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const setSnapToGrid = useEditorSettings((s) => s.setSnapToGrid)
  const setGridSize = useEditorSettings((s) => s.setGridSize)
  const selectedDeviceId = useEditorSettings((s) => s.selectedDeviceId)
  const setSelectedDeviceId = useEditorSettings((s) => s.setSelectedDeviceId)
  // Reads/writes the store, not local useState, so components other than
  // this toolbar (e.g. EventsModal's DCS-BIOS status banner) can also open
  // this modal, optionally focused on one data source's panel.
  const settingsOpen = useEditorSettings((s) => s.settingsModalOpen)
  const openSettings = useEditorSettings((s) => s.openSettings)
  const closeSettings = useEditorSettings((s) => s.closeSettings)

  const devices = useDashboardStore((s) => s.devices)

  const selectedConnectedDevice = devices.find((d) => d.id === selectedDeviceId)

  return (
    <div className="toolbar">
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
      <label className={`toolbar__control${!snapToGrid ? ' toolbar__control--disabled' : ''}`}>
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
      <button type="button" className="toolbar__button" onClick={() => setMobileAppOpen(true)}>
        Mobile app
      </button>
      <button type="button" className="toolbar__button" onClick={() => openSettings()}>
        Settings
      </button>
      <button type="button" className="toolbar__button" onClick={() => setEventsOpen(true)}>
        Events
      </button>
      <button type="button" className="toolbar__button" onClick={() => setVariablesOpen(true)}>
        Variables
      </button>
      {mobileAppOpen && <MobileAppModal onClose={() => setMobileAppOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={closeSettings} />}
      {eventsOpen && <EventsModal onClose={() => setEventsOpen(false)} />}
      {variablesOpen && <VariablesModal onClose={() => setVariablesOpen(false)} />}
    </div>
  )
}
