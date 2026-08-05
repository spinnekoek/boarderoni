import { useState } from 'react'
import { useDashboardStore } from '../store'
import { getDeviceId } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { friendlyDeviceName } from '@shared/deviceName'

export function DeviceSettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const devices = useDashboardStore((s) => s.devices)
  const renameDevice = useDashboardStore((s) => s.renameDevice)
  const disconnect = useDashboardStore((s) => s.disconnect)
  useEscapeToClose(onClose)

  const deviceId = getDeviceId()
  const device = devices.find((d) => d.id === deviceId)

  const [name, setName] = useState(device?.customName ?? '')

  function handleSave(): void {
    renameDevice(deviceId, name)
    onClose()
  }

  // No onClose() here — disconnect() clears the store's deckId, which is
  // what makes App.tsx fall back to the picker; this modal itself unmounts
  // along with the rest of the view tree at that point.
  function handleChangeDeck(): void {
    disconnect()
  }

  // A full reload — for when the WebView itself gets into a bad state (e.g.
  // stuck reconnect loop, stale bundle after an update) that navigating
  // within the app can't fix.
  function handleForceRefresh(): void {
    window.location.reload()
  }

  return (
    <div className="device-modal-overlay" onPointerDown={onClose}>
      <div className="device-modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="device-modal__title">Device settings</h2>

        <label className="device-modal__field">
          <span>Friendly name</span>
          <input value={name} placeholder={friendlyDeviceName(device?.userAgent)} onChange={(e) => setName(e.target.value)} />
        </label>

        <button className="device-modal__change-deck" onClick={handleChangeDeck}>
          Change deck
        </button>

        <button className="device-modal__change-deck" onClick={handleForceRefresh}>
          Force refresh
        </button>

        <div className="device-modal__actions">
          <button className="device-modal__cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="device-modal__save" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
