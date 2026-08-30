import type { Plugin } from '@shared/types'

// Optional renderer-side config UI a plugin kind can register in
// PLUGIN_CONFIG_PANELS below — anything beyond the generic field→variable
// mapping list EventSourcesModal.tsx already renders for every kind (e.g.
// DCS-BIOS's aircraft picker, Screen Capture's region picker). A kind with
// nothing else to configure (e.g. 'datetime') simply has no entry.
export interface PluginConfigPanelProps {
  source: Plugin
  // Whether this plugin's kind is currently enabled (see PluginsModal's
  // enable-toggle list) — a disabled plugin's mappings are frozen, so most
  // panels use this to hide "live" bits (status banners, test buttons) while
  // still letting the static config underneath stay editable.
  kindEnabled: boolean
  onPatchConfig: (config: Record<string, unknown> | undefined) => void
  // Opens PluginsModal, focused on this plugin's own row — e.g. from a
  // "this plugin is disabled" or "configure the DCS-BIOS docs folder" link.
  onOpenSettings: () => void
}
