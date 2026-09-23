import type { PluginProducer } from './types'

const DEFAULT_MIN = 0
const DEFAULT_MAX = 1

// The template for a new plugin's producer half — copy this file alongside
// shared/plugins/random.ts, then register it in main/plugins/index.ts. A
// producer's only job is to call `emit` with fresh field values whenever it
// has one; everything downstream (mapping into Variables, expressions,
// enabled/disabled gating, restart-on-config-change) is handled generically
// by main/index.ts's syncPlugins — a producer never needs to know about any
// of that.
//
// min/max also demonstrate the OTHER half of the template contract: a
// configurable per-instance field, read from `instance.config` (see
// renderer/src/plugins/RandomConfigPanel.tsx for the config UI half of
// this same pair) rather than hardcoded, the way ScreenCaptureConfigPanel/
// screenCapture.ts's own intervalMs pairing works. Config is fixed for the
// life of one start() call — a change to it is a signature change, which
// syncPlugins already turns into a stop+restart with a fresh `instance`,
// same as screenCapture.ts's own comment on this describes.
export const randomProducer: PluginProducer = {
  start(instance, emit) {
    const configMin = typeof instance.config?.min === 'number' ? instance.config.min : DEFAULT_MIN
    const configMax = typeof instance.config?.max === 'number' ? instance.config.max : DEFAULT_MAX
    // Tolerate min/max saved backwards (or equal) rather than emitting NaN
    // or a value stuck outside the intended range.
    const min = Math.min(configMin, configMax)
    const max = Math.max(configMin, configMax)
    const tick = (): void => emit({ value: min + Math.random() * (max - min) })
    tick()
    const intervalId = setInterval(tick, 1000)
    return () => clearInterval(intervalId)
  }
}
