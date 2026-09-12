import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import { WindowsAudioDevicePicker } from './WindowsAudioDevicePicker'
import { WindowsAudioSessionPicker } from './WindowsAudioSessionPicker'

// Device vs. Application mode toggle, shared by WindowsAudioConfigPanel
// (the event source's own target) and SetWindowsAudioActionEditor (the
// action's own target) — same widget, two call sites, same reasoning
// WindowsAudioDevicePicker's own doc comment gives. `appName` present
// (including '', not yet actually picked) means Application mode;
// undefined means Device mode — see SetWindowsAudioAction's own comment in
// shared/types.ts for why this is two plain fields rather than a nested
// discriminated union.
//
// Application mode only ever looks at the current default device's own
// sessions (see main/windowsAudio/connectionManager.ts's own comment on
// why) — there's deliberately no separate "which device to look for apps
// on" picker here.
export function WindowsAudioTargetPicker({
  deviceName,
  appName,
  onChangeDeviceName,
  onChangeAppName
}: {
  deviceName: string
  appName: string | undefined
  onChangeDeviceName: (deviceName: string) => void
  onChangeAppName: (appName: string | undefined) => void
}): React.JSX.Element {
  const windowsAudioDevices = useDashboardStore((s) => s.windowsAudioDevices)
  const requestWindowsAudioDevices = useDashboardStore((s) => s.requestWindowsAudioDevices)
  const windowsAudioSessions = useDashboardStore((s) => s.windowsAudioSessions)
  const requestWindowsAudioSessions = useDashboardStore((s) => s.requestWindowsAudioSessions)

  const mode: 'device' | 'application' = appName !== undefined ? 'application' : 'device'

  // Fetches both fresh on mount, not just whichever mode is currently
  // active — switching modes shouldn't show a stale/empty list from
  // before this editor was opened. Same "re-fetch on mount, not just once
  // per app session" reasoning as WindowsAudioDevicePicker's own comment.
  useEffect(() => {
    requestWindowsAudioDevices()
    requestWindowsAudioSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="windows-audio-target-picker__mode">
        <button
          type="button"
          className={`windows-audio-target-picker__mode-button${mode === 'device' ? ' windows-audio-target-picker__mode-button--active' : ''}`}
          onClick={() => onChangeAppName(undefined)}
        >
          Device
        </button>
        <button
          type="button"
          className={`windows-audio-target-picker__mode-button${mode === 'application' ? ' windows-audio-target-picker__mode-button--active' : ''}`}
          onClick={() => onChangeAppName(appName ?? '')}
        >
          Application
        </button>
      </div>
      <div className="properties__file-row">
        {mode === 'device' ? (
          <WindowsAudioDevicePicker devices={windowsAudioDevices} value={deviceName} onChange={onChangeDeviceName} />
        ) : (
          <WindowsAudioSessionPicker sessions={windowsAudioSessions} value={appName ?? ''} onChange={onChangeAppName} />
        )}
        <button
          type="button"
          className="properties__file-button"
          title={mode === 'device' ? 'Re-check for connected/paired devices' : 'Re-check for currently active applications'}
          onClick={() => (mode === 'device' ? requestWindowsAudioDevices() : requestWindowsAudioSessions())}
        >
          Refresh
        </button>
      </div>
    </>
  )
}
