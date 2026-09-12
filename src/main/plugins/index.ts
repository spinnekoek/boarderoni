// The producer half of the plugin registry — one entry per kind in
// shared/plugins' PLUGIN_TYPES, keyed the same way. See that file's own
// comment for the full "how to add a plugin" pointer.
import type { PluginProducer } from './types'
import { datetimeProducer } from './datetime'
import { dcsbiosProducer } from './dcsbios'
import { screenCaptureProducer } from './screenCapture'
import { randomProducer } from './random'
import { windowsAudioProducer } from './windowsAudio'

export type { PluginProducer } from './types'

export const PLUGIN_PRODUCERS: Record<string, PluginProducer> = {
  datetime: datetimeProducer,
  dcsbios: dcsbiosProducer,
  screenCapture: screenCaptureProducer,
  random: randomProducer,
  windowsAudio: windowsAudioProducer
}
