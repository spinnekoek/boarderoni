import { useState } from 'react'
import { useDashboardStore } from '../store'
import { getDeviceId, getKeepScreenOnPreference, setKeepScreenOnPreference } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { friendlyDeviceName } from '@shared/deviceName'
import { changeServer, isBoarderoniAndroidApp, setKeepScreenOn } from '../androidBridge'

export function DeviceSettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const devices = useDashboardStore((s) => s.devices)
  const renameDevice = useDashboardStore((s) => s.renameDevice)
  const disconnect = useDashboardStore((s) => s.disconnect)
  useEscapeToClose(onClose)

  const deviceId = getDeviceId()
  const device = devices.find((d) => d.id === deviceId)

  const [name, setName] = useState(device?.customName ?? '')
  // Only meaningful (and only rendered) inside the actual Android app — see
  // androidBridge.ts's comment on why presence of window.BoarderoniAndroid
  // is what that means, not e.g. a mobile-browser user-agent check.
  const [keepScreenOn, setKeepScreenOnState] = useState(getKeepScreenOnPreference)

  function handleSave(): void {
    renameDevice(deviceId, name)
    onClose()
  }

  // Applies immediately rather than waiting for Save — it's a live toggle
  // of the current screen, not a value that needs staging/confirming.
  function handleKeepScreenOnChange(enabled: boolean): void {
    setKeepScreenOnState(enabled)
    setKeepScreenOnPreference(enabled)
    setKeepScreenOn(enabled)
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

  // Drops the native app back to its searching/manual-entry screen —
  // replaces the old always-on-screen floating button. Only reachable here
  // (Android app only, see isBoarderoniAndroidApp's gate below): a regular
  // browser has no native discovery/manual-entry screen to drop back to.
  function handleChangeServer(): void {
    changeServer()
  }

  return (
    <div className="device-modal-overlay" onPointerDown={onClose}>
      <div className="device-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="device-modal__header">
          <h2 className="device-modal__title">Device settings</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="device-modal__body">
          <label className="device-modal__field">
            <span>Friendly name</span>
            <input value={name} placeholder={friendlyDeviceName(device?.userAgent)} onChange={(e) => setName(e.target.value)} />
          </label>

          {isBoarderoniAndroidApp() && (
            <label className="device-modal__checkbox">
              <input type="checkbox" checked={keepScreenOn} onChange={(e) => handleKeepScreenOnChange(e.target.checked)} />
              <span>Prevent screen timeout</span>
            </label>
          )}

          <button className="device-modal__change-deck" onClick={handleChangeDeck}>
            Change deck
          </button>

          <button className="device-modal__change-deck" onClick={handleForceRefresh}>
            Force refresh
          </button>

          {isBoarderoniAndroidApp() && (
            <button className="device-modal__change-deck" onClick={handleChangeServer}>
              Change server
            </button>
          )}

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
    </div>
  )
}
