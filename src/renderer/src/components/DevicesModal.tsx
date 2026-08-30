import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import { useEscapeToClose } from '../useEscapeToClose'

// Approved devices — split out of the old monolithic SettingsModal into its
// own toolbar modal, same as Plugins/Fonts, each now a focused concern with
// its own toolbar button instead of one kitchen-sink Settings modal.
export function DevicesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const approvedDevices = useDashboardStore((s) => s.approvedDevices)
  const requestApprovedDevices = useDashboardStore((s) => s.requestApprovedDevices)
  const revokeDeviceApproval = useDashboardStore((s) => s.revokeDeviceApproval)
  useEscapeToClose(onClose)

  useEffect(() => {
    requestApprovedDevices()
  }, [requestApprovedDevices])

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal settings-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Devices</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
          <p className="properties__hint">
            Devices that can see the deck list and connect without going through approval again. Revoking one ends
            its current session too, not just future ones.
          </p>

          <div className="variables-modal__scroll">
            {approvedDevices.length === 0 ? (
              <p className="properties__hint">No devices approved yet.</p>
            ) : (
              <ul className="settings-modal__device-list">
                {approvedDevices.map((device) => (
                  <li key={device.id} className="settings-modal__device-row">
                    <span className="settings-modal__device-name">{device.name}</span>
                    <button type="button" className="device-approval-card__deny" onClick={() => revokeDeviceApproval(device.id)}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="variables-modal__actions">
            <button type="button" className="device-modal__save" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
