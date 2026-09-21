# Contributing

Boarderoni is an Electron app: `src/main` (Node, the desktop process),
`src/renderer` (React, the editor UI), `src/shared` (isomorphic — no Node
APIs, no React, safe for both sides to import). `npm run dev` starts
everything with hot reload.

## Ports

Three ports are in play, all defined in `shared/constants.ts`:

- **`SERVER_PORT`** (17334) — the app's own HTTP/WS server: state sync,
  triggers, and (in a packaged build) the static renderer bundle the Android
  client loads. Binds on all interfaces and is advertised over mDNS.
- **`MCP_SERVER_PORT`** (17335) — the MCP server, loopback-only
  (127.0.0.1) and bearer-token gated, deliberately separate from
  `SERVER_PORT` since an AI agent driving live dashboard edits is a more
  powerful surface than anything else the app exposes on the LAN.
- **Vite's dev server** (5173) — only exists in `npm run dev`; the editor
  window still loads through `SERVER_PORT` (which proxies to Vite), but the
  Android client gets pointed straight at 5173 via mDNS TXT records so it
  gets the same hot-reload loop the desktop window does.

See each constant's own comment in `shared/constants.ts` for the full
reasoning, and the Networking item in `docs/TODO.md` for the case for
eventually consolidating this.

## Adding a plugin

A **plugin** (Date & Time, DCS-BIOS, Screen Capture + OCR, ...) is a
capability that can be individually enabled/disabled from the Plugins
toolbar button — disabling one stops it doing any work at all, and (for a
plugin that also gates a widget type, like Screen Capture) renders that
widget inert too. A per-dashboard **event source** is an actual running
instance of one, added from the separate Event Sources toolbar button,
whose fields get mapped into `variables`. Most plugins use the same name
for both; a kind can set `instanceLabel` in its metadata when the instance
is a narrower thing than the plugin capability itself (Screen Capture + OCR
→ "OCR," since the widget half of that plugin isn't an event source at
all). A `core: true` plugin (currently only `rest`) is app-wide and
singleton-shaped rather than per-dashboard-instantiable, so it only ever
shows up in Plugins, never in the Event Sources add-picker.

Adding one touches at most three places, and usually just one or two. The
`random` kind (`shared/plugins/random.ts` + `main/plugins/random.ts`) is a
real, working, minimal example — copy it as your starting point.

1. **`shared/plugins/<kind>.ts`** — required. Declarative metadata only: the
   kind's id, its display label, and the list of fields it produces (each a
   `{ key, label }` pair). No logic, no imports beyond `./types`. Register it
   in `shared/plugins/index.ts`'s `PLUGIN_TYPES` array.

2. **`main/plugins/<kind>.ts`** — required. The actual producer: a `start(instance, emit)`
   function that calls `emit({ ...fields })` whenever it has fresh values,
   and returns a `stop()` cleanup. `emit`'s keys must match the field keys
   you declared in step 1. Register it in `main/plugins/index.ts`'s
   `PLUGIN_PRODUCERS` map, keyed by the same kind string. Everything else —
   mapping fields into Variables, running each mapping's optional
   expression, enable/disable gating, restarting on config changes — is
   handled generically by `syncPlugins` in `main/index.ts`; your producer
   never needs to know about any of that.

3. **`renderer/src/plugins/<Kind>ConfigPanel.tsx`** — optional. Only needed
   if your plugin has its own per-instance settings beyond the generic
   field→variable mapping list (e.g. DCS-BIOS's aircraft picker, Screen
   Capture's region picker). Implement `PluginConfigPanelProps` (see
   `renderer/src/plugins/types.ts`) and register it in
   `renderer/src/plugins/index.ts`'s `PLUGIN_CONFIG_PANELS` map. A plugin
   with nothing extra to configure (like `datetime` or `random`) skips this
   entirely.

Two smaller, rarer extension points:

- **App-wide settings** (config that exists before any instance does, like
  DCS-BIOS's docs-folder path) — add a panel in `pluginSettingsPanels.tsx`.
- **Also gating a widget type** (like Screen Capture gating the
  `screen-capture` widget) — add `widgetTypes: ['your-widget-type']` to the
  metadata in step 1; disabling the plugin will render every widget of that
  type inert automatically.

A `dynamicFields: true` kind (fields not statically known — currently only
DCS-BIOS, since its fields depend on which aircraft module is installed) is
the one case that currently still needs a small addition inside
`EventSourcesModal.tsx` itself (its own field browser) rather than being
fully self-contained — most plugins have a static field list and never
touch that file at all.
