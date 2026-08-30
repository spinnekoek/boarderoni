import { DcsBiosSettingsPanel } from './components/DcsBiosSettingsPanel'
import { DcsViewportsSettingsPanel } from './components/DcsViewportsSettingsPanel'
import { RestDataSourcesSettingsPanel } from './components/RestDataSourcesSettingsPanel'

// Registry of per-kind APP-WIDE settings panels, keyed by PluginTypeMeta.kind
// (see shared/plugins). Distinct from renderer/src/plugins' PLUGIN_CONFIG_PANELS
// — that's a plugin INSTANCE's own config (aircraft, region, ...), this is
// app-wide setup that applies before any instance even exists (DCS-BIOS's
// docs folder/multicast settings, REST's own list of named integrations). A
// kind with nothing app-wide to configure (e.g. 'datetime', 'screenCapture')
// simply has no entry here — PluginsModal.tsx only renders an expandable
// panel for kinds present in this map. This is the
// actual extension point for a future plugin: add a shared/plugins entry,
// optionally a producer, and optionally one line here — nothing else needs
// to change. 'rest' is a core plugin (see PluginTypeMeta.core) — it reuses
// this exact same slot even though it has no per-dashboard instances of its
// own; RestDataSourcesSettingsPanel already manages its own list
// internally, unaffected by any of this.
export const PLUGIN_SETTINGS_PANELS: Partial<Record<string, React.ComponentType>> = {
  dcsbios: DcsBiosSettingsPanel,
  dcsViewports: DcsViewportsSettingsPanel,
  rest: RestDataSourcesSettingsPanel
}
