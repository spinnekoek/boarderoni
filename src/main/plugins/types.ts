import type { Plugin } from '../../shared/types'

// One producer per plugin kind. `start` may be called any number of times
// across a room's lifetime (once per matching Plugin instance); `emit` may
// be called any number of times after that; `stop` fully releases whatever
// `start` acquired and is called at most once per start. Producers only
// ever see raw field values — mapping/variable logic is entirely the
// caller's job (see syncPlugins in main/index.ts).
//
// This shape already generalizes to future kinds: a webhook producer would
// register a route on start and deregister it on stop (via a small shared
// route-registry the HTTP server consults), and a system-stats poller looks
// identical to the datetime one, just with a different tick body.
export interface PluginProducer {
  start(instance: Plugin, emit: (values: Record<string, unknown>) => void): () => void
}
