import { subscribeDevice, subscribeSession } from '../windowsAudio/connectionManager'
import type { PluginProducer } from './types'

// Thin adapter, same shape as main/plugins/dcsbios.ts — all the actual
// device/session/worker lifecycle lives in connectionManager. config.appName
// set means "app session" mode; unset (the default for a freshly-added
// instance before its config panel has been touched) means "device" mode,
// where config.deviceName defaults to '' (track the system default device).
export const windowsAudioProducer: PluginProducer = {
  start(instance, emit) {
    const updateHz = typeof instance.config?.updateHz === 'number' ? instance.config.updateHz : undefined
    const appName = typeof instance.config?.appName === 'string' ? instance.config.appName : undefined
    if (appName !== undefined) return subscribeSession(appName, emit, { updateHz })
    const deviceName = typeof instance.config?.deviceName === 'string' ? instance.config.deviceName : ''
    return subscribeDevice(deviceName, emit, { updateHz })
  }
}
