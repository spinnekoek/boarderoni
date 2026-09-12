import { WindowsAudioTargetPicker } from './WindowsAudioTargetPicker'
import type { PluginConfigPanelProps } from './types'

// Kept in sync manually with main/windowsAudio/connectionManager.ts's own
// copy of these same three constants — same "one's a renderer-side slider,
// the other's the main-process subscriber throttle" split
// ScreenCaptureConfigPanel's own MIN/MAX_OCR_INTERVAL_MS comment describes.
// See that file's own MAX_UPDATE_HZ comment for why asking well above the
// worker's fixed 5Hz poll ceiling is still worthwhile (less buffering delay
// after a change lands, not a no-op).
const MIN_UPDATE_HZ = 1
const MAX_UPDATE_HZ = 30
export const DEFAULT_UPDATE_HZ = 5

// Windows Audio's own plugin config — Device vs. Application mode (see
// WindowsAudioTargetPicker's own comment), and which specific device/app
// within that mode. config.appName set means Application mode
// (config.deviceName ignored then); unset means Device mode, where ''
// tracks whichever device is currently the system default, following it
// across a default-device change, and any other value is an exact device
// name (see SetWindowsAudioAction's own comment in shared/types.ts for why
// name rather than an id — this package has no stable device id to key on).
export function WindowsAudioConfigPanel({ source, onPatchConfig }: PluginConfigPanelProps): React.JSX.Element {
  const deviceName = typeof source.config?.deviceName === 'string' ? source.config.deviceName : ''
  const appName = typeof source.config?.appName === 'string' ? source.config.appName : undefined
  const updateHz = typeof source.config?.updateHz === 'number' ? source.config.updateHz : DEFAULT_UPDATE_HZ

  return (
    <div className="events-modal__source-config">
      <label className="dcsbios-settings__field">
        <span>Target</span>
        <WindowsAudioTargetPicker
          deviceName={deviceName}
          appName={appName}
          onChangeDeviceName={(nextDeviceName) => onPatchConfig({ ...source.config, deviceName: nextDeviceName })}
          onChangeAppName={(nextAppName) => onPatchConfig({ ...source.config, appName: nextAppName })}
        />
      </label>
      <p className="properties__hint-inline">
        Reports the target's volume (0-100), muted state, and name into variables. Picking a specific device or application identifies
        it by name — if it's ever renamed, replaced, or (for an application) closed and reopened, this stops matching it until you
        re-pick it here.
      </p>
      <label className="dcsbios-settings__field">
        <span>Update frequency: {updateHz}/sec</span>
        <input
          type="range"
          min={MIN_UPDATE_HZ}
          max={MAX_UPDATE_HZ}
          value={updateHz}
          onChange={(e) => onPatchConfig({ ...source.config, updateHz: Number(e.target.value) })}
        />
        <span className="properties__hint-inline">
          How often this plugin's mapped variables refresh — lower this if you don't need every change instantly and want to reduce
          broadcast/save load.
        </span>
      </label>
    </div>
  )
}

// Default config for a freshly-added Windows Audio event source — see
// EventSourcesModal.tsx's addSource, which calls this instead of
// hardcoding the shape inline (same convention as defaultDcsBiosConfig).
export function defaultWindowsAudioConfig(): Record<string, unknown> {
  return { deviceName: '', updateHz: DEFAULT_UPDATE_HZ }
}
