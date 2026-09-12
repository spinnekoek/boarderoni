// Request/response/push shapes for the windows-audio worker (see worker.ts)
// — main-process-internal only, distinct from the shared windows-audio:*
// WS messages in shared/types.ts (those are what the renderer sees; these
// are what connectionManager.ts and worker.ts speak to each other over
// WorkerHost's postMessage channel). Same split as dcsBios/messages.ts.

export interface WindowsAudioDeviceSnapshot {
  name: string
  volume: number // 0.0-1.0, native-sound-mixer's own VolumeScalar range
  muted: boolean
  isDefault: boolean
}

// A per-application audio stream (native-sound-mixer's AudioSession) —
// always scoped to whichever device is CURRENTLY the system default (see
// worker.ts's own comment on why this doesn't take a deviceName), and
// transient: it only exists while that app is actually making sound, gone
// the moment it stops (see AudioSessionState.EXPIRED filtering in worker.ts).
// Same no-stable-id situation as WindowsAudioDeviceSnapshot's own `name` —
// `appName` is the closest thing to one here, used as the key everywhere
// this needs to target a specific session again later.
export interface WindowsAudioSessionSnapshot {
  appName: string
  name: string
  volume: number
  muted: boolean
}

export type WindowsAudioWorkerRequest =
  | { type: 'listDevices' }
  | { type: 'setVolume'; deviceName: string; volume: number }
  | { type: 'setMute'; deviceName: string; muted: boolean }
  | { type: 'listSessions' }
  | { type: 'setSessionVolume'; appName: string; volume: number }
  | { type: 'setSessionMute'; appName: string; muted: boolean }

export type WindowsAudioWorkerResponse =
  | { type: 'devices'; devices: WindowsAudioDeviceSnapshot[] }
  | { type: 'sessions'; sessions: WindowsAudioSessionSnapshot[] }
  | { type: 'ack' }

// Unsolicited — one push per device (or app session) whose volume/mute
// actually changed, detected by worker.ts's own poll (see its
// VOLUME_POLL_INTERVAL_MS comment for why this is polled rather than using
// native-sound-mixer's own push-callback API), plus a slow separate poll
// for the default device itself changing (no native push event for that
// either).
export type WindowsAudioWorkerPush =
  | { type: 'device-update'; snapshot: WindowsAudioDeviceSnapshot }
  | { type: 'session-update'; snapshot: WindowsAudioSessionSnapshot }
  | { type: 'default-changed'; deviceName: string }
