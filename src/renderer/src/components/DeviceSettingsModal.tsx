import { useState } from 'react'
import { useDashboardStore } from '../store'
import { getDeviceId } from '../id'
import { friendlyDeviceName } from '@shared/deviceName'

export function DeviceSettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const devices = useDashboardStore((s) => s.devices)
  const renameDevice = useDashboardStore((s) => s.renameDevice)

  const deviceId = getDeviceId()
  const device = devices.find((d) => d.id === deviceId)

  const [name, setName] = useState(device?.customName ?? '')

  function handleSave(): void {
    renameDevice(deviceId, name)
    onClose()
  }

  return (
    <div className="device-modal-overlay" onPointerDown={onClose}>
      <div className="device-modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="device-modal__title">Device settings</h2>

        <label className="device-modal__field">
          <span>Friendly name</span>
          <input
            value={name}
            placeholder={friendlyDeviceName(device?.userAgent)}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

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
