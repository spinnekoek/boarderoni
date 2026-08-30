// Singleton, main-thread client of the DCS-BIOS worker (see worker.ts and
// ../workerHost.ts) — module-level state, same always-resident philosophy
// as the `rooms` map in main/index.ts. DCS only ever streams one active
// aircraft on one multicast group, so one process-wide listener demuxed to
// however many Plugin instances/rooms care is correct; this is the
// only place in the app that talks to the underlying WorkerHost directly.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosSettings, DcsBiosStatus, DcsBiosWorkerStats } from '../../shared/dcsBiosTypes'
import { WorkerHost } from '../workerHost'
import { COMMON_DATA_AIRCRAFT_ID } from './messages'
import type { DcsBiosWorkerData, DcsBiosWorkerPush, DcsBiosWorkerRequest, DcsBiosWorkerResponse } from './messages'

const DEFAULT_MULTICAST_ADDRESS = '239.255.50.10'
const DEFAULT_MULTICAST_PORT = 5010
const DEFAULT_SEND_PORT = 7778
const DEFAULT_UPDATE_HZ = 10
const DEFAULT_SUBSCRIBER_HZ = 20
const MIN_UPDATE_HZ = 1
const MAX_UPDATE_HZ = 25

function docsDirCandidates(): string[] {
  return ['DCS', 'DCS.openbeta', 'DCS.openalpha'].map((branch) =>
    join(app.getPath('home'), 'Saved Games', branch, 'Scripts', 'DCS-BIOS', 'doc', 'json')
  )
}

// Probed only when no settings file exists yet — your own install is the
// plain `DCS` branch, not `DCS.openbeta`, which is exactly why this checks
// existence rather than assuming one fixed branch.
function probeDefaultDocsDir(): string {
  return docsDirCandidates().find((candidate) => existsSync(candidate)) ?? ''
}

function defaultSettings(): DcsBiosSettings {
  return {
    docsDir: probeDefaultDocsDir(),
    multicastAddress: DEFAULT_MULTICAST_ADDRESS,
    multicastPort: DEFAULT_MULTICAST_PORT,
    sendPort: DEFAULT_SEND_PORT,
    defaultUpdateHz: DEFAULT_UPDATE_HZ
  }
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'dcs-bios-settings.json')
}

let cachedSettings: DcsBiosSettings | null = null

function loadSettings(): DcsBiosSettings {
  if (cachedSettings) return cachedSettings
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DcsBiosSettings>
    cachedSettings = { ...defaultSettings(), ...parsed }
  } catch {
    cachedSettings = defaultSettings()
  }
  return cachedSettings
}

function persistSettings(settings: DcsBiosSettings): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function workerDataFromSettings(settings: DcsBiosSettings): DcsBiosWorkerData {
  return {
    docsDir: settings.docsDir,
    multicastAddress: settings.multicastAddress,
    multicastPort: settings.multicastPort,
    sendPort: settings.sendPort
  }
}

const host = new WorkerHost<DcsBiosWorkerRequest, DcsBiosWorkerResponse, DcsBiosWorkerPush>({
  scriptPath: join(__dirname, 'dcsBiosWorker.js'),
  workerData: workerDataFromSettings(loadSettings())
})

// ---- Status / stats: cached last-known value + subscriber lists ----

let cachedStatus: DcsBiosStatus = { connected: false, everConnected: false, activeAircraft: null }
let cachedStats: DcsBiosWorkerStats | null = null
const statusHandlers = new Set<(status: DcsBiosStatus) => void>()
const statsHandlers = new Set<(stats: DcsBiosWorkerStats) => void>()

// ---- Per-aircraft field subscribers, each with its own output-rate throttle ----

interface Subscriber {
  onUpdate: (fields: Record<string, unknown>) => void
  pending: Record<string, unknown>
  hasPending: boolean
  timer: ReturnType<typeof setInterval>
}
const subscribersByAircraft = new Map<string, Set<Subscriber>>()

host.subscribe((push) => {
  if (push.kind === 'status') {
    cachedStatus = push.status
    for (const handler of statusHandlers) handler(push.status)
    return
  }
  if (push.kind === 'stats') {
    cachedStats = push.stats
    for (const handler of statsHandlers) handler(push.stats)
    return
  }
  // A push's own `updates` is whatever changed across EVERY table
  // worker.ts's handleWrite decoded this tick, real aircraft and CommonData
  // alike, all merged into one flat object (see flushFields in worker.ts) —
  // so a CommonData subscriber just needs the same push everyone subscribed
  // to the real activeAircraft gets, not a separately-tagged one. It's
  // tagged with activeAircraft (never literally "CommonData" — that's
  // always a real _ACFT_NAME) purely for routing to THOSE subscribers, so a
  // subscriber registered under COMMON_DATA_AIRCRAFT_ID needs its own,
  // separate delivery here — see subscribeAircraft's own comment.
  for (const key of push.activeAircraft === COMMON_DATA_AIRCRAFT_ID ? [push.activeAircraft] : [push.activeAircraft, COMMON_DATA_AIRCRAFT_ID]) {
    const subscribers = subscribersByAircraft.get(key)
    if (!subscribers) continue
    for (const subscriber of subscribers) {
      Object.assign(subscriber.pending, push.updates)
      subscriber.hasPending = true
    }
  }
})

// A crash-restart loses all worker-side state (address tables, registration
// counts) — the one thing this manager owns that the worker doesn't is
// "which aircraft currently have subscribers," so re-issue registerAircraft
// once per distinct aircraft still subscribed. Status is reset to
// disconnected until the fresh worker reports back in.
host.onRestart(() => {
  for (const aircraft of subscribersByAircraft.keys()) {
    void host.request({ type: 'registerAircraft', aircraft }).catch((err: unknown) => {
      console.error(`[dcsBios] failed to re-register aircraft "${aircraft}" after worker restart`, err)
    })
  }
  cachedStatus = { connected: false, everConnected: cachedStatus.everConnected, activeAircraft: null }
  for (const handler of statusHandlers) handler(cachedStatus)
})

function clampUpdateHz(hz: number | undefined): number {
  if (!hz || !Number.isFinite(hz)) return DEFAULT_SUBSCRIBER_HZ
  return Math.min(MAX_UPDATE_HZ, Math.max(MIN_UPDATE_HZ, hz))
}

// Subscribes to live field updates for one aircraft, throttled to this
// subscriber's own rate — deliberately separate from the worker's own
// ~20Hz internal push ceiling (see worker.ts): that ceiling reflects DCS's
// own output rate and isn't user-controllable, while `updateHz` here
// controls how often *this app* re-broadcasts to its own WS clients and
// re-saves to disk, which is a downstream concern each Plugin
// instance may want tuned differently. Multiple subscribers to the same
// aircraft each get their own independent timer off the same worker pushes.
// Passing COMMON_DATA_AIRCRAFT_ID here (a real, pickable choice — see its
// own comment in messages.ts) subscribes the same way, and still gets
// registerAircraft'd on the worker like any other id — the one thing that's
// different is push routing (see the host.subscribe callback above), since
// a push is never actually tagged with that id, only a real _ACFT_NAME.
export function subscribeAircraft(
  aircraft: string,
  onUpdate: (fields: Record<string, unknown>) => void,
  options?: { updateHz?: number }
): () => void {
  const intervalMs = 1000 / clampUpdateHz(options?.updateHz)
  host.acquire()

  const subscriber: Subscriber = {
    onUpdate,
    pending: {},
    hasPending: false,
    timer: setInterval(() => {
      if (!subscriber.hasPending) return
      const updates = subscriber.pending
      subscriber.pending = {}
      subscriber.hasPending = false
      onUpdate(updates)
    }, intervalMs)
  }

  let set = subscribersByAircraft.get(aircraft)
  const isFirstForAircraft = !set || set.size === 0
  if (!set) {
    set = new Set()
    subscribersByAircraft.set(aircraft, set)
  }
  set.add(subscriber)

  if (isFirstForAircraft) {
    void host.request({ type: 'registerAircraft', aircraft }).catch((err: unknown) => {
      console.error(`[dcsBios] failed to register aircraft "${aircraft}"`, err)
    })
  }

  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true
    clearInterval(subscriber.timer)
    const currentSet = subscribersByAircraft.get(aircraft)
    currentSet?.delete(subscriber)
    if (currentSet && currentSet.size === 0) {
      subscribersByAircraft.delete(aircraft)
      void host.request({ type: 'unregisterAircraft', aircraft }).catch(() => {})
    }
    host.release()
  }
}

export async function listInstalledAircraft(): Promise<{ id: string; name: string }[]> {
  host.acquire()
  try {
    const res = await host.request({ type: 'listAircraft' })
    return res.type === 'aircraftList' ? res.aircraft : []
  } finally {
    host.release()
  }
}

export async function getFieldCatalog(aircraft: string): Promise<DcsBiosFieldCatalogEntry[]> {
  host.acquire()
  try {
    const res = await host.request({ type: 'getFieldCatalog', aircraft })
    return res.type === 'fieldCatalog' ? res.fields : []
  } finally {
    host.release()
  }
}

export async function getCommandCatalog(aircraft: string): Promise<DcsBiosCommandCatalogEntry[]> {
  host.acquire()
  try {
    const res = await host.request({ type: 'getCommandCatalog', aircraft })
    return res.type === 'commandCatalog' ? res.commands : []
  } finally {
    host.release()
  }
}

// Fire-and-forget from DCS-BIOS's side (no response protocol) — the
// resolved/rejected promise here only reflects whether the worker accepted
// and sent the UDP packet, not whether DCS actually did anything with it.
// A short-lived acquire/release, same as the other one-off requests above —
// sending a command doesn't need a standing subscription, so it doesn't
// keep the worker alive past this one call unless something else already is.
export async function sendCommand(identifier: string, argument: string): Promise<void> {
  host.acquire()
  try {
    await host.request({ type: 'sendCommand', identifier, argument })
  } finally {
    host.release()
  }
}

export function getStatus(): DcsBiosStatus {
  return cachedStatus
}

export function onStatusChange(handler: (status: DcsBiosStatus) => void): () => void {
  statusHandlers.add(handler)
  return () => statusHandlers.delete(handler)
}

export function getWorkerStats(): DcsBiosWorkerStats | null {
  return cachedStats
}

export function onStatsChange(handler: (stats: DcsBiosWorkerStats) => void): () => void {
  statsHandlers.add(handler)
  return () => statsHandlers.delete(handler)
}

export function getSettings(): DcsBiosSettings {
  return loadSettings()
}

// Persists the merged settings, and — only if a field the running worker
// actually holds onto (docsDir/multicastAddress/multicastPort/sendPort),
// not defaultUpdateHz which only seeds new sources — actually changed,
// restarts the worker so the change takes effect immediately, no app
// restart needed. subscribeAircraft's onRestart handler above re-registers
// every currently-subscribed aircraft against the fresh worker
// automatically.
export async function updateSettings(patch: Partial<DcsBiosSettings>): Promise<DcsBiosSettings> {
  const current = loadSettings()
  const next: DcsBiosSettings = { ...current, ...patch }
  cachedSettings = next
  persistSettings(next)

  const connectionRelevantChanged =
    next.docsDir !== current.docsDir ||
    next.multicastAddress !== current.multicastAddress ||
    next.multicastPort !== current.multicastPort ||
    next.sendPort !== current.sendPort
  if (connectionRelevantChanged) {
    host.restart(workerDataFromSettings(next))
  }

  return next
}

// Checks an arbitrary candidate path directly (not necessarily the saved
// docsDir) — lets the settings UI show "found 47 aircraft" / "nothing here"
// before the user saves. Plain fs call, no worker involvement needed.
export function validateDocsDir(candidateDir: string): { valid: boolean; aircraftCount: number } {
  try {
    const count = readdirSync(candidateDir).filter((f) => f.toLowerCase().endsWith('.json')).length
    return { valid: count > 0, aircraftCount: count }
  } catch {
    return { valid: false, aircraftCount: 0 }
  }
}
