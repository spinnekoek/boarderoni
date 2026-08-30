import { subscribeAircraft } from '../dcsBios/connectionManager'
import type { PluginProducer } from './types'

// Thin adapter — all batching/throttling already happened in the DCS-BIOS
// worker (fixed ~20Hz ceiling) and in connectionManager.subscribeAircraft
// (this instance's own configurable rate), so this just plugs straight into
// the existing per-field-diffing emit path in main/index.ts. Both
// config.aircraft and config.updateHz changes already restart this producer
// for free via syncPlugins' existing signature diffing.
export const dcsbiosProducer: PluginProducer = {
  start(instance, emit) {
    const aircraft = typeof instance.config?.aircraft === 'string' ? instance.config.aircraft : ''
    if (!aircraft) return () => {}
    const updateHz = typeof instance.config?.updateHz === 'number' ? instance.config.updateHz : undefined
    return subscribeAircraft(aircraft, emit, { updateHz })
  }
}
