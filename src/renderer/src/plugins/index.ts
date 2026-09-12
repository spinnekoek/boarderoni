// Renderer-side half of the plugin registry — maps a kind to its config
// panel component (see PluginConfigPanelProps in ./types), for kinds that
// need config UI beyond the generic field→variable mapping list
// EventSourcesModal.tsx already renders for every kind. A kind with nothing
// else to configure (e.g. 'datetime') simply has no entry here.
import type { ComponentType } from 'react'
import { DcsBiosConfigPanel } from './DcsBiosConfigPanel'
import { ScreenCaptureConfigPanel } from './ScreenCaptureConfigPanel'
import { WindowsAudioConfigPanel } from './WindowsAudioConfigPanel'
import type { PluginConfigPanelProps } from './types'

export type { PluginConfigPanelProps } from './types'
export { defaultDcsBiosConfig } from './DcsBiosConfigPanel'
export { DEFAULT_OCR_INTERVAL_MS } from './ScreenCaptureConfigPanel'
export { defaultWindowsAudioConfig } from './WindowsAudioConfigPanel'

export const PLUGIN_CONFIG_PANELS: Partial<Record<string, ComponentType<PluginConfigPanelProps>>> = {
  dcsbios: DcsBiosConfigPanel,
  screenCapture: ScreenCaptureConfigPanel,
  windowsAudio: WindowsAudioConfigPanel
}
