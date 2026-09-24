import { useDashboardStore } from '../store'
import { displayDeviceName } from '@shared/deviceName'

// Mounted in both edit mode and client mode (see App.tsx) — any trusted
// device, not just the desktop, can approve/deny a new one (see
// isTrustedSocket in main/index.ts). Renders nothing when empty, same
// always-mounted approach ToastStack uses.
export function DeviceApprovalBanner(): React.JSX.Element {
  const pendingApprovals = useDashboardStore((s) => s.pendingApprovals)
  const approveDevice = useDashboardStore((s) => s.approveDevice)
  const denyDevice = useDashboardStore((s) => s.denyDevice)

  return (
    <div className="device-approval-stack">
      {pendingApprovals.map((device) => (
        <div key={device.id} className="device-approval-card">
          <div className="device-approval-card__title">New device wants to connect</div>
          <div className="device-approval-card__name">{displayDeviceName(device)}</div>
          <div className="device-approval-card__actions">
            <button type="button" className="device-approval-card__deny" onClick={() => denyDevice(device.id)}>
              Deny
            </button>
            <button type="button" className="device-approval-card__approve" onClick={() => approveDevice(device.id)}>
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
