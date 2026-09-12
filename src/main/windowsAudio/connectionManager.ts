// Singleton, main-thread client of the windows-audio worker (see worker.ts
// and ../workerHost) — same "one process-wide worker demuxed to however
// many Plugin instances care" shape as dcsBios/connectionManager.ts, just
// simpler: no settings file (nothing to configure beyond which device a
// given instance wants), and no crash-restart bookkeeping beyond what
// WorkerHost already does on its own (no per-aircraft-style registration
// state here that would need replaying).
import { join } from 'node:path'
import { WorkerHost } from '../workerHost'
import type {
  WindowsAudioDeviceSnapshot,
  WindowsAudioSessionSnapshot,
  WindowsAudioWorkerPush,
  WindowsAudioWorkerRequest,
  WindowsAudioWorkerResponse
} from './messages'

const host = new WorkerHost<WindowsAudioWorkerRequest, WindowsAudioWorkerResponse, WindowsAudioWorkerPush>({
  scriptPath: join(__dirname, 'windowsAudioWorker.js')
})

// WorkerHost's own acquire()/release() tear the worker down the instant
// refCount hits 0 and spawn a fresh one on the very next acquire() — fine
// for DCS-BIOS's plain UDP-socket worker (closing and reopening a socket
// mid-flight is harmless), but syncPlugins in main/index.ts stops the OLD
// producer and starts the NEW one synchronously, back-to-back, on ANY
// config change (see pluginSignature's own comment) — including just
// dragging this plugin's own update-frequency slider. That 0-then-1
// refCount blip made WorkerHost tear down and immediately respawn the
// worker, and for a brief window BOTH the dying old worker and the fresh
// new one had native-sound-mixer loaded and touching the same OS audio
// subsystem at once — which segfaulted the whole Electron process
// (confirmed 2026-09-11 reproducing it live: sliding the update-frequency
// slider alone was enough, no external volume change needed). Rather than
// changing WorkerHost itself (shared, tested, and this overlap genuinely
// is harmless for its other consumer), every acquire/release in this file
// goes through this tiny local debounce instead: a release() only reaches
// WorkerHost after a grace period with nobody re-acquiring, so a
// stop-then-immediately-start cycle never actually unbalances the
// underlying host.acquire()/release() pair at all — the same worker just
// keeps running through it, no teardown/respawn, no overlap.
const RELEASE_GRACE_MS = 2000
let keepAliveCount = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null

function keepAliveAcquire(): void {
  keepAliveCount++
  if (releaseTimer) {
    // A release was pending but never actually reached WorkerHost — the
    // original host.acquire() is still outstanding/balanced, so there's
    // nothing more to do here.
    clearTimeout(releaseTimer)
    releaseTimer = null
    return
  }
  if (keepAliveCount === 1) host.acquire()
}

function keepAliveRelease(): void {
  keepAliveCount--
  if (keepAliveCount > 0) return
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    host.release()
  }, RELEASE_GRACE_MS)
}

// The worker's own VOLUME_POLL_INTERVAL_MS (see worker.ts) is a fixed 5Hz
// ceiling on how often a real change can even be DETECTED — a subscriber
// asking for more than that won't see new values arrive any faster, but
// still meaningfully cuts the extra buffering delay between a change
// landing and this subscriber's own flush timer next firing (worst case
// ~1000/MAX_UPDATE_HZ ms of that on top of however long detection itself
// took), so allowing well above 5Hz here is still a real "feels more live"
// knob, not just a no-op past the ceiling. A subscriber can also ask for
// LESS (to cut down on broadcast/save load, same reasoning DCS-BIOS's own
// updateHz field gives) — same "ceiling vs. subscriber rate are
// independent knobs" shape dcsBios/connectionManager.ts's own
// subscribeAircraft already uses.
export const MIN_UPDATE_HZ = 1
export const MAX_UPDATE_HZ = 30
export const DEFAULT_UPDATE_HZ = 5

function clampUpdateHz(hz: number | undefined): number {
  if (!hz || !Number.isFinite(hz)) return DEFAULT_UPDATE_HZ
  return Math.min(MAX_UPDATE_HZ, Math.max(MIN_UPDATE_HZ, hz))
}

interface Subscriber {
  // '' means "track whichever device is currently the system default" —
  // see worker.ts's own comment on why that needs separate handling from a
  // literal device name (the underlying real device it resolves to can
  // change without this subscription's own deviceName ever changing).
  deviceName: string
  onUpdate: (fields: Record<string, unknown>) => void
  // Same per-subscriber throttle shape as dcsBios/connectionManager.ts's
  // own Subscriber — the worker pushes at its own fixed ceiling regardless
  // of who's listening; each subscriber batches into `pending` and flushes
  // on its own independent timer instead.
  pending: Record<string, unknown>
  hasPending: boolean
  timer: ReturnType<typeof setInterval>
}
const subscribers = new Set<Subscriber>()
// Mirrors the worker's own currentDefaultName — kept here too so a
// device-update push (tagged with the real device name, never '') can be
// routed to every '' subscriber without asking the worker "is this the
// default?" on every single volume tick.
let currentDefaultName: string | null = null

function stageFields(sub: Subscriber, snapshot: WindowsAudioDeviceSnapshot): void {
  Object.assign(sub.pending, { volume: Math.round(snapshot.volume * 100), muted: snapshot.muted, deviceName: snapshot.name })
  sub.hasPending = true
}

// Per-application sessions — see worker.ts's own comment on why these are
// always scoped to the current default device rather than taking a
// deviceName the way subscribeDevice does: an AudioSession lives under
// whichever device it's actively outputting through, and generalizing this
// to "sessions on an arbitrary picked device" would mean tracking that
// device's own default-ness too, for a case (an app playing on a
// non-default device) that's rare enough not to bother with yet.
interface SessionSubscriber {
  appName: string
  onUpdate: (fields: Record<string, unknown>) => void
  pending: Record<string, unknown>
  hasPending: boolean
  timer: ReturnType<typeof setInterval>
}
const sessionSubscribers = new Set<SessionSubscriber>()

function stageSessionFields(sub: SessionSubscriber, snapshot: WindowsAudioSessionSnapshot): void {
  Object.assign(sub.pending, { volume: Math.round(snapshot.volume * 100), muted: snapshot.muted, appName: snapshot.appName, name: snapshot.name })
  sub.hasPending = true
}

host.subscribe((push) => {
  if (push.type === 'device-update') {
    for (const sub of subscribers) {
      const matches = sub.deviceName === '' ? push.snapshot.name === currentDefaultName : sub.deviceName === push.snapshot.name
      if (matches) stageFields(sub, push.snapshot)
    }
    return
  }

  if (push.type === 'session-update') {
    for (const sub of sessionSubscribers) {
      if (sub.appName === push.snapshot.appName) stageSessionFields(sub, push.snapshot)
    }
    return
  }

  // 'default-changed' — the underlying device every '' subscriber tracks
  // just swapped out from under them. They won't get a device-update for
  // the new one until IT actually changes, so fetch its current snapshot
  // and stage that immediately instead of leaving them stale until then.
  currentDefaultName = push.deviceName
  const defaultSubs = [...subscribers].filter((s) => s.deviceName === '')
  if (defaultSubs.length === 0) return
  void host
    .request({ type: 'listDevices' })
    .then((res) => {
      if (res.type !== 'devices') return
      const snapshot = res.devices.find((d) => d.name === push.deviceName)
      if (!snapshot) return
      for (const sub of defaultSubs) stageFields(sub, snapshot)
    })
    .catch(() => {})
})

// Live field updates for one device (or '' for "whichever is default"),
// throttled to this subscriber's own updateHz. Seeds an immediate value on
// subscribe rather than waiting for the first real change — unlike
// DCS-BIOS (nothing to report until the sim actually sends a packet),
// Windows' own audio state is always synchronously known, so there's no
// reason to leave a freshly-added event source blank until someone happens
// to touch a volume slider.
export function subscribeDevice(deviceName: string, onUpdate: (fields: Record<string, unknown>) => void, options?: { updateHz?: number }): () => void {
  keepAliveAcquire()
  const intervalMs = 1000 / clampUpdateHz(options?.updateHz)
  const sub: Subscriber = {
    deviceName,
    onUpdate,
    pending: {},
    hasPending: false,
    timer: setInterval(() => {
      if (!sub.hasPending) return
      const fields = sub.pending
      sub.pending = {}
      sub.hasPending = false
      onUpdate(fields)
    }, intervalMs)
  }
  subscribers.add(sub)

  void host
    .request({ type: 'listDevices' })
    .then((res) => {
      if (res.type !== 'devices' || !subscribers.has(sub)) return
      const target = deviceName === '' ? res.devices.find((d) => d.isDefault) : res.devices.find((d) => d.name === deviceName)
      if (!target) return
      if (deviceName === '') currentDefaultName = target.name
      stageFields(sub, target)
    })
    .catch(() => {})

  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true
    clearInterval(sub.timer)
    subscribers.delete(sub)
    keepAliveRelease()
  }
}

export async function listDevices(): Promise<{ name: string; isDefault: boolean }[]> {
  keepAliveAcquire()
  try {
    const res = await host.request({ type: 'listDevices' })
    return res.type === 'devices' ? res.devices.map((d) => ({ name: d.name, isDefault: d.isDefault })) : []
  } finally {
    keepAliveRelease()
  }
}

// Full snapshot (including current volume/muted, unlike listDevices' own
// trimmed name/isDefault-only shape sent to the renderer) for one device —
// only needed by the 'toggle' half of SetWindowsAudioAction (see
// runSetWindowsAudioAction in main/index.ts), which is the one caller that
// actually needs to read current mute state before flipping it.
export async function getSnapshot(deviceName: string): Promise<WindowsAudioDeviceSnapshot | undefined> {
  keepAliveAcquire()
  try {
    const res = await host.request({ type: 'listDevices' })
    if (res.type !== 'devices') return undefined
    return deviceName === '' ? res.devices.find((d) => d.isDefault) : res.devices.find((d) => d.name === deviceName)
  } finally {
    keepAliveRelease()
  }
}

// volumePercent: 0-100, converted to native-sound-mixer's own 0.0-1.0
// VolumeScalar range here so callers (the plugin producer, the action
// handler) only ever deal in the same percent scale the properties panel
// and the emitted `volume` field both use.
export async function setVolume(deviceName: string, volumePercent: number): Promise<void> {
  keepAliveAcquire()
  try {
    await host.request({ type: 'setVolume', deviceName, volume: Math.min(1, Math.max(0, volumePercent / 100)) })
  } finally {
    keepAliveRelease()
  }
}

export async function setMute(deviceName: string, muted: boolean): Promise<void> {
  keepAliveAcquire()
  try {
    await host.request({ type: 'setMute', deviceName, muted })
  } finally {
    keepAliveRelease()
  }
}

// Live field updates for one app's audio session, throttled the same way
// subscribeDevice's own is. No "seed an immediate value" special-casing
// beyond what subscribeDevice already does — same reasoning, Windows'
// audio state (including which apps currently have a session) is always
// synchronously known.
export function subscribeSession(appName: string, onUpdate: (fields: Record<string, unknown>) => void, options?: { updateHz?: number }): () => void {
  keepAliveAcquire()
  const intervalMs = 1000 / clampUpdateHz(options?.updateHz)
  const sub: SessionSubscriber = {
    appName,
    onUpdate,
    pending: {},
    hasPending: false,
    timer: setInterval(() => {
      if (!sub.hasPending) return
      const fields = sub.pending
      sub.pending = {}
      sub.hasPending = false
      onUpdate(fields)
    }, intervalMs)
  }
  sessionSubscribers.add(sub)

  void host
    .request({ type: 'listSessions' })
    .then((res) => {
      if (res.type !== 'sessions' || !sessionSubscribers.has(sub)) return
      const target = res.sessions.find((s) => s.appName === appName)
      if (target) stageSessionFields(sub, target)
    })
    .catch(() => {})

  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true
    clearInterval(sub.timer)
    sessionSubscribers.delete(sub)
    keepAliveRelease()
  }
}

export async function listSessions(): Promise<{ name: string; appName: string }[]> {
  keepAliveAcquire()
  try {
    const res = await host.request({ type: 'listSessions' })
    return res.type === 'sessions' ? res.sessions.map((s) => ({ name: s.name, appName: s.appName })) : []
  } finally {
    keepAliveRelease()
  }
}

// Same "full snapshot for the toggle-mute case" reasoning as getSnapshot
// above, just for a session instead of a device.
export async function getSessionSnapshot(appName: string): Promise<WindowsAudioSessionSnapshot | undefined> {
  keepAliveAcquire()
  try {
    const res = await host.request({ type: 'listSessions' })
    if (res.type !== 'sessions') return undefined
    return res.sessions.find((s) => s.appName === appName)
  } finally {
    keepAliveRelease()
  }
}

export async function setSessionVolume(appName: string, volumePercent: number): Promise<void> {
  keepAliveAcquire()
  try {
    await host.request({ type: 'setSessionVolume', appName, volume: Math.min(1, Math.max(0, volumePercent / 100)) })
  } finally {
    keepAliveRelease()
  }
}

export async function setSessionMute(appName: string, muted: boolean): Promise<void> {
  keepAliveAcquire()
  try {
    await host.request({ type: 'setSessionMute', appName, muted })
  } finally {
    keepAliveRelease()
  }
}
