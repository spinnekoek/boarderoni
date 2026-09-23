import type { PluginTypeMeta } from './types'

// Fields are static, unlike 'dcsbios' — the producer (main/plugins/
// windowsAudio.ts) always emits exactly these four keys, regardless of
// whether the instance is watching a device or an application's own
// session. Which one (and which specific device/app) is set via
// config.deviceName/config.appName in
// renderer/src/plugins/WindowsAudioTargetPicker.tsx — config.appName set
// means "app session" mode (deviceName is ignored then; a session always
// lives on the current default device — see
// main/windowsAudio/connectionManager.ts's own comment on why), unset
// means "device" mode, where '' tracks whichever device is currently the
// system default, following it across a default-device change, and
// anything else is an exact device name (see SetWindowsAudioAction's own
// comment in shared/types.ts for why name rather than an id). deviceName
// is only meaningfully populated in device mode; appName only in app mode.
export const windowsAudioPlugin: PluginTypeMeta = {
  kind: 'windowsAudio',
  label: 'Windows Audio',
  fields: [
    { key: 'volume', label: 'Volume (0-100)' },
    { key: 'muted', label: 'Muted' },
    { key: 'deviceName', label: 'Device name' },
    { key: 'appName', label: 'Application name (when targeting an app instead of a device)' }
  ],
  config: [
    {
      key: 'deviceName',
      label: 'Device name',
      type: 'string',
      description:
        "Device mode only (ignored once appName is set). '' (the default for a freshly-added instance) tracks whichever device is currently the system default, following it across a default-device change; any other value must be an exact device name from list_windows_audio_devices."
    },
    {
      key: 'appName',
      label: 'Application name',
      type: 'string',
      description:
        "Set to target one application's own audio session instead of a device — deviceName is then ignored (a session always lives on the current default device). Unset (default) means device mode."
    },
    { key: 'updateHz', label: 'Update rate (Hz)', type: 'number', description: "Optional — defaults to this connection's own built-in rate if unset." }
  ]
}
