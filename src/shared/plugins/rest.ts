import type { PluginTypeMeta } from './types'

// Core plugin — see PluginTypeMeta.core's own comment for what that means.
// No `fields`/mappings of its own (never instantiated per-dashboard); this
// entry exists purely so REST Data Sources gets a row in Settings' shared
// enable-toggle list, with RestDataSourcesSettingsPanel as its
// PLUGIN_SETTINGS_PANELS entry (see pluginSettingsPanels.tsx) — the actual
// list of named REST integrations is still managed there exactly as before,
// unaffected by any of this. Disabling this kind stops every REST listener
// from binding its port at all, regardless of each individual source's own
// `enabled` flag (see main/restIncoming.ts). Incoming-only — see
// restWebhookTargetsPlugin for the unrelated outgoing direction, split out
// of what used to be this same kind's own combined entity.
export const restPlugin: PluginTypeMeta = {
  kind: 'rest',
  label: 'REST Data Sources',
  fields: [],
  core: true
}
