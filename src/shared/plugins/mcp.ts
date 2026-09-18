import type { PluginTypeMeta } from './types'

// Core plugin — see PluginTypeMeta.core's own comment for what that means.
// No `fields`/mappings of its own (never instantiated per-dashboard); this
// entry exists purely so the MCP Server gets a row in Settings' shared
// enable-toggle list, with McpServerSettingsPanel as its
// PLUGIN_SETTINGS_PANELS entry (see pluginSettingsPanels.tsx). Unlike every
// other kind here, this one is deliberately excluded from
// appSettings.ts's default-enabled list (see defaultSettings' own comment
// there) — enabling it grants an external process (an MCP client/AI agent)
// direct write access to every deck's live state over a local HTTP server,
// so it must be a deliberate, informed opt-in, never a silent default.
export const mcpPlugin: PluginTypeMeta = {
  kind: 'mcp',
  label: 'MCP Server',
  fields: [],
  core: true
}
