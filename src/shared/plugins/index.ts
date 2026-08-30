// The plugin registry — the one place that needs to know every plugin kind
// exists. Adding a new plugin means: a metadata file here (copy an existing
// one), a producer file in main/plugins/ (see that directory's own
// PLUGIN_PRODUCERS registry), and, if it needs config UI beyond the generic
// field-mapping list, a config panel in renderer/src/plugins/ registered in
// PLUGIN_CONFIG_PANELS there. Nothing else in the app needs to change — see
// CONTRIBUTING.md's "Adding a plugin" section.
import type { PluginTypeMeta } from './types'
import { datetimePlugin } from './datetime'
import { dcsbiosPlugin } from './dcsbios'
import { dcsViewportsPlugin } from './dcsViewports'
import { screenCapturePlugin } from './screenCapture'
import { randomPlugin } from './random'
import { restPlugin } from './rest'

export type { PluginField, PluginTypeMeta } from './types'

export const PLUGIN_TYPES: PluginTypeMeta[] = [
  datetimePlugin,
  dcsbiosPlugin,
  dcsViewportsPlugin,
  screenCapturePlugin,
  randomPlugin,
  restPlugin
]

export function getPluginType(kind: string): PluginTypeMeta | undefined {
  return PLUGIN_TYPES.find((t) => t.kind === kind)
}

// Every kind EventSourcesModal's "+ Add event source" picker offers — every
// enabled kind EXCEPT a core one (see PluginTypeMeta.core), which has no
// per-dashboard instance shape to add.
export function instantiablePluginTypes(enabledKinds: string[]): PluginTypeMeta[] {
  return PLUGIN_TYPES.filter((t) => enabledKinds.includes(t.kind) && !t.core)
}

// True when `widgetType` should render as disabled because some plugin that
// declares it in `widgetTypes` (see PluginTypeMeta's own comment) is
// currently off — e.g. every 'screen-capture' widget once the Screen Capture
// plugin is disabled. Shared by the renderer (to show/hide the disabled
// state) and, indirectly, by the main process's own HTTP capture routes
// (which re-derive the same check against enabledPlugins — see
// main/index.ts's serveScreenCaptureFrame/serveScreenCaptureStream).
export function isWidgetTypeGatedByDisabledPlugin(widgetType: string, enabledPlugins: string[]): boolean {
  return PLUGIN_TYPES.some((t) => t.widgetTypes?.includes(widgetType) && !enabledPlugins.includes(t.kind))
}
