import type { PluginTypeMeta } from './types'

// The template for a new plugin's metadata half — copy this file, rename
// the kind/label/fields, and register it in shared/plugins/index.ts. See
// docs/CONTRIBUTING.md's "Adding a plugin" section for the full walkthrough,
// including this kind's producer counterpart (main/plugins/random.ts).
// Deliberately real and working (not dead sample code) — enable it in
// Settings and add it from the Plugins toolbar button to see it run.
export const randomPlugin: PluginTypeMeta = {
  kind: 'random',
  label: 'Random Number (example)',
  // Range shown here is just the built-in default — RandomConfigPanel lets
  // it be narrowed/widened per instance, so this label doesn't reflect
  // whatever min/max is actually configured (same "static label, live
  // config elsewhere" split every other kind's fields already have).
  fields: [{ key: 'value', label: 'Random value' }],
  config: [
    { key: 'min', label: 'Minimum', type: 'number', description: 'Defaults to 0 if unset.' },
    { key: 'max', label: 'Maximum', type: 'number', description: 'Defaults to 1 if unset. Tolerated if saved backwards relative to min.' }
  ]
}
