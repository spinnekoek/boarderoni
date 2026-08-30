import type { PluginTypeMeta } from './types'

// Core plugin — see PluginTypeMeta.core's own comment for what that means,
// and shared/plugins/rest.ts for the identical no-per-dashboard-instance
// shape this is modeled on. This kind performs setup side effects only
// (detect the Virtual Display Driver, keep a virtual monitor at the right
// resolution, write Boarderoni.lua) — it emits no dashboard variables, so
// unlike screenCapture.ts it has no `widgetTypes` gate here; the
// 'dcs-viewport' widget type's own availability is gated by a combination
// of this kind's enabled state AND live driver-readiness (see
// main/index.ts), not the blanket widgetTypes mechanism.
export const dcsViewportsPlugin: PluginTypeMeta = {
  kind: 'dcsViewports',
  label: 'DCS Viewports',
  fields: [],
  core: true
}
