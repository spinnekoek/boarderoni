// Declarative metadata shape every plugin's kind file (datetime.ts,
// dcsbios.ts, screenCapture.ts, ...) exports one of — no logic, just what
// the renderer needs to render the "pick a kind" / "pick a field" pickers
// (see EventSourcesModal.tsx) and what main/plugins/index.ts's PLUGIN_PRODUCERS
// must emit exactly the field keys of. Kept dependency-free (no Node APIs,
// no React) so both the renderer and the main process can import it — the
// main-process producer for each kind lives in main/plugins/<kind>.ts
// instead, and any renderer-only config UI lives in
// renderer/src/plugins/<kind>.tsx — see that directory's own README-style
// comment in index.tsx for why those two are split out from this file.
export interface PluginField {
  key: string
  label: string
}

export interface PluginTypeMeta {
  kind: string
  // The plugin CAPABILITY's own name — shown in PluginsModal's enable-
  // toggle list. Most kinds also use this for their per-dashboard instance
  // (Event Sources modal's "+ Add event source" picker, an instance's own
  // kind badge) — see instanceLabel below for the one kind where those
  // diverge.
  label: string
  // Label for a per-dashboard INSTANCE of this kind, where that's a
  // narrower or differently-framed thing than the plugin capability itself
  // — e.g. the plugin is "Screen Capture + OCR" (gates both the widget and
  // this event source), but the event source you actually add only ever
  // produces OCR'd text/numbers, so it's just "OCR" there. Falls back to
  // `label` when unset, which covers every other kind today.
  instanceLabel?: string
  fields: PluginField[]
  // True when this kind's fields aren't statically known (see 'dcsbios') —
  // EventSourcesModal.tsx checks this to render a dynamic aircraft/field-
  // browser UI instead of the generic static-list field picker. An explicit flag
  // rather than inferring from `fields.length === 0`, since an empty array
  // is ambiguous (could just mean "not configured yet" for a still-static
  // kind added later).
  dynamicFields?: boolean
  // Widget types this plugin ALSO gates, beyond its own field→variable
  // mappings — e.g. Screen Capture governs both the 'screenCapture' event
  // source AND the 'screen-capture' widget's own live capture, since both
  // ride the same underlying OS-level screen-grab. Disabling the plugin
  // renders every widget of these types inert on the dashboard (see
  // isWidgetTypeGatedByDisabledPlugin in shared/plugins/index.ts), not just
  // pausing its own mappings. Most plugins gate nothing here — this is the
  // exception, not the norm.
  widgetTypes?: string[]
  // True for a plugin that's app-wide and singleton-shaped rather than
  // per-dashboard-instantiable — currently only 'rest' (see
  // shared/plugins/rest.ts). A core kind still gets a row in PluginsModal's
  // enable-toggle list (and its own PLUGIN_SETTINGS_PANELS entry, same as
  // any other kind), but is excluded from EventSourcesModal's "+ Add event
  // source" picker — there's no per-dashboard instance of it to add, since
  // its own dedicated UI (RestDataSourcesSettingsPanel) already manages its
  // own list of app-wide, independently-named instances. Not about who
  // wrote it (every kind shipped today is equally "built-in") — purely
  // about whether it fits the per-dashboard instance shape every other
  // kind does.
  core?: boolean
}
