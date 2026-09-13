import type { PluginTypeMeta } from './types'

// Core plugin — see PluginTypeMeta.core's own comment for what that means.
// No `fields`/mappings of its own (never instantiated per-dashboard); this
// entry exists purely so REST Webhook Targets gets its own row in Settings'
// shared enable-toggle list, with RestWebhookTargetsSettingsPanel as its
// PLUGIN_SETTINGS_PANELS entry (see pluginSettingsPanels.tsx) — split out
// from restPlugin (see that file's own comment) since incoming and outgoing
// are unrelated concerns that only used to share one combined entity.
export const restWebhookTargetsPlugin: PluginTypeMeta = {
  kind: 'restWebhookTargets',
  label: 'REST Webhook Targets',
  fields: [],
  core: true
}
