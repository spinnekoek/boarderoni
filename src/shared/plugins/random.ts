import type { PluginTypeMeta } from './types'

// The template for a new plugin's metadata half — copy this file, rename
// the kind/label/fields, and register it in shared/plugins/index.ts. See
// CONTRIBUTING.md's "Adding a plugin" section for the full walkthrough,
// including this kind's producer counterpart (main/plugins/random.ts).
// Deliberately real and working (not dead sample code) — enable it in
// Settings and add it from the Plugins toolbar button to see it run.
export const randomPlugin: PluginTypeMeta = {
  kind: 'random',
  label: 'Random Number (example)',
  fields: [{ key: 'value', label: 'Random value (0–1)' }]
}
