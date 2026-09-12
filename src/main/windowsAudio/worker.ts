// Runs entirely off the main thread (see src/main/workerHost.ts and
// src/main/windowsAudio/connectionManager.ts), same isolation reasoning as
// dcsBios/worker.ts — every WASAPI/COM call this plugin makes happens here,
// on one thread that owns its own COM apartment, so nothing about it can
// ever jank the main process's own event loop (which also runs the WS
// server for every connected device).
//
// Everything here is POLLED, deliberately — native-sound-mixer's own
// Device.on('volume'|'mute', ...) push-callback API segfaulted the whole
// Electron process (not just this worker: a worker_threads.Worker shares
// its OS process with the main thread, so a native crash anywhere takes
// everything down, no crash isolation the way a separate child process
// would give) the first time a device's volume changed from an external
// source (Windows' own volume UI / hardware buttons) rather than a write
// this worker made itself. A plain synchronous property read, on our own
// thread, at our own cadence, is a different and much safer code path than
// accepting an async native callback fired from whatever thread WASAPI
// happens to deliver it on — VOLUME_POLL_INTERVAL_MS below re-reads every
// known device's volume/mute and only posts a push when something actually
// changed, same "instant-feeling but still just a poll" tradeoff a fast
// enough interval gets you without touching that callback API again.
//
// native-sound-mixer has no stable device id (see Device's own type
// defs — just name/type/volume/mute/balance/sessions), so `name` is the
// only handle this worker (and everything downstream of it) can key a
// device by. The device LIST itself is only rescanned on the slower
// DEVICE_RESCAN_INTERVAL_MS, both to notice the default device changing
// and to pick up hot-plugged devices — no need to re-enumerate on every
// fast volume-poll tick, just re-read the already-known Device handles.
import { parentPort } from 'node:worker_threads'
import type { AudioSession, Device, SoundMixer as SoundMixerType } from 'native-sound-mixer'
import type {
  WindowsAudioDeviceSnapshot,
  WindowsAudioSessionSnapshot,
  WindowsAudioWorkerPush,
  WindowsAudioWorkerRequest,
  WindowsAudioWorkerResponse
} from './messages'

// Plain require(), not an ESM import — native-sound-mixer's compiled CJS
// output has no `__esModule` marker, and Rollup/esbuild's own interop
// helper for that case (_interopNamespaceDefault) sets a namespace
// import's `.default` to the raw `module.exports` object itself, NOT that
// object's own nested `.default` property — so `import * as x` then
// `x.default` silently hands back the wrong, one-level-too-shallow object
// (tried this first: DeviceType resolved fine since it's a top-level
// property either way, but every real method — devices/getDefaultDevice —
// lives one level deeper, under the raw module's OWN `.default`). A bare
// require() bypasses every bundler ESM-interop guess entirely — this file
// compiles to CommonJS anyway, so require() here compiles straight through
// unchanged, giving back the exact raw module object confirmed to work in
// a throwaway plain-Node spike test before this feature was built.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nativeSoundMixerModule = require('native-sound-mixer') as {
  default: SoundMixerType
  DeviceType: typeof import('native-sound-mixer').DeviceType
  AudioSessionState: typeof import('native-sound-mixer').AudioSessionState
}
const SoundMixer = nativeSoundMixerModule.default
const { DeviceType, AudioSessionState } = nativeSoundMixerModule

if (!parentPort) throw new Error('windowsAudio/worker.ts must be run as a worker_threads Worker')
const port = parentPort

// ~30Hz — matches connectionManager.ts's own MAX_UPDATE_HZ, since this poll
// is the ONLY way an externally-caused change (dragging Windows' own volume
// slider, a hardware button) ever gets detected at all, unlike a change we
// made ourselves (see setVolume/setMute's own reportDeviceChange call,
// which reports immediately rather than waiting for this). A subscriber
// asking for more than the poll can supply would otherwise re-flush the
// same stale value on every tick until the next 200ms-interval poll caught
// up — externally-caused changes would always feel capped well below
// whatever updateHz was actually configured. Cheap enough at this rate: a
// plain native property read per known device/session, not the
// request/response round trip that flooding this same worker with rapid
// setVolume calls turned out to be expensive under (see reportDeviceChange's
// own comment).
const VOLUME_POLL_INTERVAL_MS = 33
const DEVICE_RESCAN_INTERVAL_MS = 2000

function post(push: WindowsAudioWorkerPush): void {
  port.postMessage({ kind: 'push', payload: push })
}

function snapshotOf(device: Device, isDefault: boolean): WindowsAudioDeviceSnapshot {
  return { name: device.name, volume: device.volume, muted: device.mute, isDefault }
}

// Every render (output) device seen so far, keyed by name — holds the live
// native-sound-mixer Device handle (not just a snapshot) so setVolume/
// setMute below can write straight back to it, and so pollVolumes below has
// a fixed set of handles to re-read without calling SoundMixer.devices
// (a real WASAPI enumeration call) on every fast tick.
const knownDevices = new Map<string, Device>()
// This worker's own last-seen volume/mute per device — pollVolumes diffs
// against this so a push only ever goes out when something actually
// changed, same "only the delta" shape the native callback would have
// given us, just polled instead of pushed.
const lastKnownState = new Map<string, { volume: number; muted: boolean }>()
let currentDefaultName: string | null = null

function renderDevices(): Device[] {
  return SoundMixer.devices.filter((d) => d.type === DeviceType.RENDER)
}

function rescan(): void {
  const defaultDevice = SoundMixer.getDefaultDevice(DeviceType.RENDER)
  const defaultName = defaultDevice ? defaultDevice.name : null
  if (defaultName !== currentDefaultName) {
    currentDefaultName = defaultName
    if (defaultName) post({ type: 'default-changed', deviceName: defaultName })
  }

  for (const device of renderDevices()) {
    if (knownDevices.has(device.name)) continue
    knownDevices.set(device.name, device)
    lastKnownState.set(device.name, { volume: device.volume, muted: device.mute })
  }
  // A device that's vanished (unplugged) just stops appearing in
  // renderDevices() — its stale Device handle in knownDevices/lastKnownState
  // is harmless (pollVolumes below silently no-ops reading a handle whose
  // real device is gone, same as it always tolerated a mid-poll unplug), so
  // it's left in place rather than torn down; the next rescan would re-add
  // it fresh if it comes back.
}

// Posts a device-update and records it in lastKnownState so pollVolumes'
// own next tick doesn't see the same value and post a redundant duplicate.
// Shared by pollVolumes (an externally-caused change, discovered by
// polling) and setVolume/setMute below (a change WE just caused — see
// their own comment on why those push immediately instead of waiting for
// the next poll tick to notice).
function reportDeviceChange(device: Device): void {
  lastKnownState.set(device.name, { volume: device.volume, muted: device.mute })
  post({ type: 'device-update', snapshot: snapshotOf(device, device.name === currentDefaultName) })
}

function pollVolumes(): void {
  for (const [name, device] of knownDevices) {
    const previous = lastKnownState.get(name)
    if (previous && previous.volume === device.volume && previous.muted === device.mute) continue
    reportDeviceChange(device)
  }
}

function findDevice(deviceName: string): Device | undefined {
  if (deviceName === '') return SoundMixer.getDefaultDevice(DeviceType.RENDER) ?? undefined
  return knownDevices.get(deviceName) ?? renderDevices().find((d) => d.name === deviceName)
}

// Per-application sessions — always scoped to the CURRENT default device,
// never a picked one (see connectionManager.ts's own comment on why the
// app-vs-device picker doesn't also ask "which device"). Unlike Device,
// an AudioSession explicitly has an EXPIRED state signaling its own handle
// may no longer be safe/meaningful to read — so sessions are always
// re-fetched fresh from device.sessions on every poll/request rather than
// cached across ticks the way knownDevices caches Device handles.
//
// Also excludes any session with an empty appName (seen in practice —
// likely Windows' own "System Sounds" session, which has no real owning
// application path) since that's the only handle a session has (see
// sessionSnapshotOf's own comment) — surfacing one would show up as a
// blank, unselectable-in-any-meaningful-way row in the picker, and every
// caller (listSessions, findSession, pollSessions) needs the same
// exclusion, so it lives here once rather than being repeated at each.
function activeSessions(): AudioSession[] {
  const defaultDevice = SoundMixer.getDefaultDevice(DeviceType.RENDER)
  if (!defaultDevice) return []
  return defaultDevice.sessions.filter((s) => s.state !== AudioSessionState.EXPIRED && s.appName !== '')
}

// appName is "the path to the application" per native-sound-mixer's own
// type defs, name is a possibly-empty display name — appName is the more
// reliably-populated of the two, so it's the key everything targets a
// session by; name is only for display, falling back to appName when
// blank. Not yet verified against a real app's session (Discord, a
// browser, ...) which of the two actually reads better in practice — may
// need revisiting once tested live.
function sessionSnapshotOf(session: AudioSession): WindowsAudioSessionSnapshot {
  return { appName: session.appName, name: session.name || session.appName, volume: session.volume, muted: session.mute }
}

function findSession(appName: string): AudioSession | undefined {
  return activeSessions().find((s) => s.appName === appName)
}

const lastKnownSessionState = new Map<string, { volume: number; muted: boolean }>()

// Same immediate-report shape as reportDeviceChange above, for a session
// instead of a device.
function reportSessionChange(session: AudioSession): void {
  lastKnownSessionState.set(session.appName, { volume: session.volume, muted: session.mute })
  post({ type: 'session-update', snapshot: sessionSnapshotOf(session) })
}

function pollSessions(): void {
  for (const session of activeSessions()) {
    const previous = lastKnownSessionState.get(session.appName)
    if (previous && previous.volume === session.volume && previous.muted === session.mute) continue
    reportSessionChange(session)
  }
  // Same "leave a stale entry in place, harmless" reasoning as rescan()'s
  // own comment on knownDevices — a closed app's own key just never gets
  // touched again unless it reopens.
}

function handleRequest(req: WindowsAudioWorkerRequest): WindowsAudioWorkerResponse {
  switch (req.type) {
    case 'listDevices': {
      const defaultDevice = SoundMixer.getDefaultDevice(DeviceType.RENDER)
      return {
        type: 'devices',
        devices: renderDevices().map((d) => snapshotOf(d, defaultDevice !== undefined && d.name === defaultDevice.name))
      }
    }
    case 'setVolume': {
      const device = findDevice(req.deviceName)
      if (!device) throw new Error(`Windows Audio: device "${req.deviceName || 'default'}" not found`)
      device.volume = Math.min(1, Math.max(0, req.volume))
      // Report this change immediately rather than waiting for pollVolumes'
      // next tick to notice it — under a rapid stream of these (an
      // AdjusterWidget drag firing this on every move tick), the incoming
      // request messages themselves can keep the worker's event loop busy
      // enough that its setInterval timers get starved and arrive
      // significantly late (confirmed live: dragging produced a steady
      // ~60Hz stream of setVolume calls with pollVolumes barely firing at
      // all for seconds at a stretch), so the reported variable badly
      // lagged the actual (fast, smooth) device change. We already know
      // the exact new value here — no reason to wait on a timer to
      // rediscover what we just did ourselves.
      reportDeviceChange(device)
      return { type: 'ack' }
    }
    case 'setMute': {
      const device = findDevice(req.deviceName)
      if (!device) throw new Error(`Windows Audio: device "${req.deviceName || 'default'}" not found`)
      device.mute = req.muted
      reportDeviceChange(device)
      return { type: 'ack' }
    }
    case 'listSessions':
      return { type: 'sessions', sessions: activeSessions().map(sessionSnapshotOf) }
    case 'setSessionVolume': {
      const session = findSession(req.appName)
      if (!session) throw new Error(`Windows Audio: application "${req.appName}" not found`)
      session.volume = Math.min(1, Math.max(0, req.volume))
      reportSessionChange(session)
      return { type: 'ack' }
    }
    case 'setSessionMute': {
      const session = findSession(req.appName)
      if (!session) throw new Error(`Windows Audio: application "${req.appName}" not found`)
      session.mute = req.muted
      reportSessionChange(session)
      return { type: 'ack' }
    }
  }
}

port.on('message', (msg: { kind: 'req'; id: string; payload: WindowsAudioWorkerRequest }) => {
  if (msg.kind !== 'req') return
  try {
    const payload = handleRequest(msg.payload)
    port.postMessage({ kind: 'res', id: msg.id, ok: true, payload })
  } catch (err) {
    port.postMessage({ kind: 'res', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

rescan()
setInterval(rescan, DEVICE_RESCAN_INTERVAL_MS)
setInterval(pollVolumes, VOLUME_POLL_INTERVAL_MS)
setInterval(pollSessions, VOLUME_POLL_INTERVAL_MS)
