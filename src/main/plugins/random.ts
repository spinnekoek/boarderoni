import type { PluginProducer } from './types'

// The template for a new plugin's producer half — copy this file alongside
// shared/plugins/random.ts, then register it in main/plugins/index.ts. A
// producer's only job is to call `emit` with fresh field values whenever it
// has one; everything downstream (mapping into Variables, expressions,
// enabled/disabled gating, restart-on-config-change) is handled generically
// by main/index.ts's syncPlugins — a producer never needs to know about any
// of that.
export const randomProducer: PluginProducer = {
  start(_instance, emit) {
    const tick = (): void => emit({ value: Math.random() })
    tick()
    const intervalId = setInterval(tick, 1000)
    return () => clearInterval(intervalId)
  }
}
