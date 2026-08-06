// Runs entirely off the main thread (see src/main/workerHost.ts and
// src/main/dcsBios/connectionManager.ts). Owns the DCS-BIOS UDP socket, the
// frame decoder, and every registered aircraft's parsed/cached field
// catalog + address table — all the CPU work a burst of sim traffic could
// otherwise cost the main process is isolated here.
import dgram from 'node:dgram'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { parentPort, workerData } from 'node:worker_threads'
import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosStatus, DcsBiosWorkerStats } from '../../shared/dcsBiosTypes'
import { parseAircraftCommands, parseAircraftDoc } from './docParser'
import type { DcsBiosWorkerData, DcsBiosWorkerPush, DcsBiosWorkerRequest, DcsBiosWorkerResponse } from './messages'
import { DcsBiosFrameDecoder, type DcsBiosWrite } from './protocol'

if (!parentPort) throw new Error('dcsBios/worker.ts must be run as a worker_threads Worker')
const port = parentPort

const { docsDir, multicastAddress, multicastPort, sendPort } = workerData as DcsBiosWorkerData

const FLUSH_INTERVAL_MS = 50 // ~20Hz ceiling on outbound field-batch pushes
const STATUS_STATS_INTERVAL_MS = 1000
const STALE_MS = 5000 // no packet within this window => not "connected"
const JSON_EXT = '.json'
const ACFT_NAME_KEY = '_ACFT_NAME'
// The DCS-BIOS command protocol (confirmed against the real developer
// guide): a limited UDP broadcast, not addressed to any specific host — the
// same approach DCS-BIOS-Communicator's own BiosSendClient uses.
const SEND_BROADCAST_ADDRESS = '255.255.255.255'

// One entry per address a field occupies. Integer fields occupy exactly one
// address; string fields occupy ceil(maxLength/2) consecutive addresses, all
// mapping to the SAME entry (shared buffer) since a write to any of them
// updates one shared decode.
interface DecodableField {
  entry: DcsBiosFieldCatalogEntry
  stringBuffer?: Buffer
  // Addresses within this field's span not yet written even once — only
  // string fields track this; a write isn't trusted until it's empty, so a
  // string field is never reported mid-assembly (see decodeWrite).
  pendingAddresses?: Set<number>
}

// A single 16-bit word very commonly packs several unrelated fields at once
// (confirmed against real aircraft docs — e.g. the Hornet packs 8 different
// controls, including a string, into one address via different bit masks)
// — so one address maps to a LIST of fields, not one. Every write must be
// decoded against every field living at that address, independently.
function addField(table: Map<number, DecodableField[]>, address: number, field: DecodableField): void {
  const list = table.get(address)
  if (list) list.push(field)
  else table.set(address, [field])
}

function buildAddressTable(entries: DcsBiosFieldCatalogEntry[]): Map<number, DecodableField[]> {
  const table = new Map<number, DecodableField[]>()
  for (const entry of entries) {
    if (entry.valueType === 'integer') {
      addField(table, entry.address, { entry })
      continue
    }
    const length = entry.maxLength ?? 0
    const wordCount = Math.ceil(length / 2)
    const stringBuffer = Buffer.alloc(length)
    const pendingAddresses = new Set<number>()
    for (let i = 0; i < wordCount; i++) pendingAddresses.add(entry.address + i * 2)
    const field: DecodableField = { entry, stringBuffer, pendingAddresses }
    for (const address of pendingAddresses) addField(table, address, field)
  }
  return table
}

// Returns `ready: false` for a string field until every one of its
// addresses has been written at least once, so a caller never observes a
// string mid-assembly (e.g. half of _ACFT_NAME after only one of its two
// words has arrived).
function decodeWrite(field: DecodableField, write: DcsBiosWrite): { value: unknown; ready: boolean } {
  if (field.entry.valueType === 'integer') {
    const mask = field.entry.mask ?? 0xffff
    const shiftBy = field.entry.shiftBy ?? 0
    return { value: (write.data & mask) >> shiftBy, ready: true }
  }
  const buf = field.stringBuffer!
  const offset = write.address - field.entry.address
  if (offset >= 0 && offset < buf.length) buf[offset] = write.data & 0xff
  if (offset + 1 >= 0 && offset + 1 < buf.length) buf[offset + 1] = (write.data >> 8) & 0xff
  field.pendingAddresses!.delete(write.address)
  const ready = field.pendingAddresses!.size === 0
  // No multi-byte/UTF-8 decoding — per-byte chars, matching the confirmed
  // protocol behavior. Trailing NUL/space padding trimmed.
  return { value: buf.toString('latin1').replace(/[\0 ]+$/, ''), ready }
}

function prettifyAircraftName(id: string): string {
  const spaced = id.replace(/[_-]+/g, ' ').trim()
  return spaced.length > 0 ? spaced : id
}

// ---- Aircraft catalog cache (per-doc parse, keyed by filename+mtime) ----

// Fields (outputs) and commands (inputs) both come from parsing the SAME
// file — cached together so getFieldCatalog/getCommandCatalog/
// registerAircraft never re-read-and-re-parse a doc that's already cached,
// regardless of which one asks first.
interface AircraftData {
  fields: DcsBiosFieldCatalogEntry[]
  commands: DcsBiosCommandCatalogEntry[]
}

const catalogCache = new Map<string, { mtimeMs: number; data: AircraftData }>()

function aircraftDocPath(aircraft: string): string {
  return join(docsDir, `${aircraft}${JSON_EXT}`)
}

function loadAircraftData(aircraft: string): AircraftData {
  const file = aircraftDocPath(aircraft)
  const stat = statSync(file)
  const cached = catalogCache.get(aircraft)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data
  const json: unknown = JSON.parse(readFileSync(file, 'utf-8'))
  const data: AircraftData = { fields: parseAircraftDoc(json), commands: parseAircraftCommands(json) }
  catalogCache.set(aircraft, { mtimeMs: stat.mtimeMs, data })
  return data
}

// Shared/infrastructure doc files, not real pickable aircraft — confirmed
// against a real DCS-BIOS docs folder. AircraftAliases.json is the real
// source of truth for which files are "primary" vs. shared modules (see
// AircraftAliases.json's format: each DCS unit type maps to a list of doc
// files to merge, e.g. "EA-18G" -> ["CommonData", "FA-18C_hornet"]) — using
// it properly would also let a shared-cockpit variant like EA-18G resolve
// to its parent aircraft's fields, which this simpler filename-per-aircraft
// model deliberately doesn't attempt (out of scope for now: variant
// aircraft that don't have their own primary doc file just won't show up,
// same as if they weren't installed). This hardcoded list is a pragmatic
// stand-in for that, scoped to what's actually been seen in a real docs
// folder — CommonData/NS430/FC3 are shared avionics modules aliased by
// several aircraft, never a real aircraft's own `_ACFT_NAME`.
const NON_AIRCRAFT_DOCS = new Set(['AircraftAliases', 'CommonData', 'MetadataStart', 'MetadataEnd', 'NS430', 'FC3'])

function listAircraft(): { id: string; name: string }[] {
  let files: string[]
  try {
    files = readdirSync(docsDir).filter((f) => f.toLowerCase().endsWith(JSON_EXT))
  } catch {
    return []
  }
  return files
    .map((f) => f.slice(0, -JSON_EXT.length))
    .filter((id) => !NON_AIRCRAFT_DOCS.has(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, name: prettifyAircraftName(id) }))
}

// _ACFT_NAME (and other core metadata) lives in these two always-loaded
// files, NOT inside any individual aircraft's own doc — confirmed against a
// real docs folder. Loaded once, independent of aircraft registration, so
// active-aircraft tracking works even before the user has registered any
// aircraft at all. Absence (older/newer DCS-BIOS versions may differ)
// degrades gracefully to "activeAircraft never resolves," not a crash.
function loadMetadataTable(): Map<number, DecodableField[]> {
  const entries: DcsBiosFieldCatalogEntry[] = []
  for (const file of ['MetadataStart.json', 'MetadataEnd.json']) {
    try {
      const json: unknown = JSON.parse(readFileSync(join(docsDir, file), 'utf-8'))
      entries.push(...parseAircraftDoc(json))
    } catch (err) {
      console.error(`[dcsBios worker] failed to load ${file}`, err)
    }
  }
  return buildAddressTable(entries)
}

// ---- Live registration / address tables ----

const registrationRefCounts = new Map<string, number>()
const addressTables = new Map<string, Map<number, DecodableField[]>>()

function registerAircraft(aircraft: string): void {
  const count = registrationRefCounts.get(aircraft) ?? 0
  registrationRefCounts.set(aircraft, count + 1)
  if (count === 0) {
    addressTables.set(aircraft, buildAddressTable(loadAircraftData(aircraft).fields))
  }
}

function unregisterAircraft(aircraft: string): void {
  const count = registrationRefCounts.get(aircraft) ?? 0
  if (count <= 1) {
    registrationRefCounts.delete(aircraft)
    addressTables.delete(aircraft)
  } else {
    registrationRefCounts.set(aircraft, count - 1)
  }
}

// ---- Live decode state ----

const metadataTable = loadMetadataTable()
let activeAircraft: string | null = null
let lastPacketAt: number | null = null
let everConnected = false
let lastPushedStatus: DcsBiosStatus = { connected: false, everConnected: false, activeAircraft: null }

const pendingValues: Record<string, unknown> = {}
const changedSinceFlush = new Set<string>()
let lastBatchFieldCount = 0

let packetsThisWindow = 0
let writesThisWindow = 0
const eventLoopDelay = monitorEventLoopDelay()
eventLoopDelay.enable()

function handleWrite(write: DcsBiosWrite): void {
  writesThisWindow++

  // _ACFT_NAME lives in the always-loaded metadata table (see
  // loadMetadataTable), never in a per-aircraft doc — checked independent of
  // which aircraft (if any) is currently registered.
  const metadataFields = metadataTable.get(write.address)
  if (metadataFields) {
    for (const field of metadataFields) {
      const { value, ready } = decodeWrite(field, write)
      if (ready && field.entry.key === ACFT_NAME_KEY) {
        activeAircraft = typeof value === 'string' && value.length > 0 ? value : null
      }
    }
  }

  for (const [aircraftId, table] of addressTables) {
    const fields = table.get(write.address)
    if (!fields) continue
    // Only trust an ordinary mapped field while this table's own aircraft
    // is the one actually active, so two aircraft with coincidentally
    // overlapping addresses never cross-contaminate each other's values.
    if (aircraftId !== activeAircraft) continue
    // A single word commonly packs several unrelated fields at once (e.g.
    // the Hornet packs 8 different controls into one address) — every field
    // living at this address needs its own independent decode against the
    // same raw word, not just the first one.
    for (const field of fields) {
      const { value, ready } = decodeWrite(field, write)
      if (!ready) continue
      if (pendingValues[field.entry.key] !== value) {
        pendingValues[field.entry.key] = value
        changedSinceFlush.add(field.entry.key)
      }
    }
  }
}

function postPush(payload: DcsBiosWorkerPush): void {
  port.postMessage({ kind: 'push', payload })
}

function flushFields(): void {
  if (changedSinceFlush.size === 0 || !activeAircraft) return
  const updates: Record<string, unknown> = {}
  for (const key of changedSinceFlush) updates[key] = pendingValues[key]
  lastBatchFieldCount = changedSinceFlush.size
  changedSinceFlush.clear()
  postPush({ kind: 'fields', activeAircraft, updates })
}

function nsToMs(ns: number): number {
  return Number.isFinite(ns) ? ns / 1e6 : 0
}

function reportStatusAndStats(): void {
  const now = Date.now()
  const connected = lastPacketAt !== null && now - lastPacketAt < STALE_MS
  if (connected) everConnected = true

  const status: DcsBiosStatus = { connected, everConnected, activeAircraft: connected ? activeAircraft : null }
  if (
    status.connected !== lastPushedStatus.connected ||
    status.everConnected !== lastPushedStatus.everConnected ||
    status.activeAircraft !== lastPushedStatus.activeAircraft
  ) {
    lastPushedStatus = status
    postPush({ kind: 'status', status })
  }

  const windowSeconds = STATUS_STATS_INTERVAL_MS / 1000
  const stats: DcsBiosWorkerStats = {
    packetsPerSec: packetsThisWindow / windowSeconds,
    writesPerSec: writesThisWindow / windowSeconds,
    eventLoopDelayMeanMs: nsToMs(eventLoopDelay.mean),
    eventLoopDelayMaxMs: nsToMs(eventLoopDelay.max),
    lastBatchFieldCount
  }
  packetsThisWindow = 0
  writesThisWindow = 0
  eventLoopDelay.reset()
  postPush({ kind: 'stats', stats })
}

// ---- UDP receive ----

const decoder = new DcsBiosFrameDecoder()
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
socket.on('message', (msg) => {
  packetsThisWindow++
  lastPacketAt = Date.now()
  decoder.processBuffer(msg, handleWrite)
})
socket.on('error', (err) => {
  // A bind/membership failure here (e.g. bad multicast address, port in
  // use) shouldn't crash silently — surface it via console so it lands in
  // the main process's logs; the worker keeps running (request handling
  // for listAircraft/getFieldCatalog still works even with no live socket).
  console.error('[dcsBios worker] UDP socket error', err)
})
socket.bind(multicastPort, () => {
  try {
    socket.addMembership(multicastAddress)
  } catch (err) {
    console.error('[dcsBios worker] failed to join multicast group', err)
  }
  try {
    // Required before sending to a broadcast address — sendDcsBiosCommand
    // below would otherwise fail with EACCES.
    socket.setBroadcast(true)
  } catch (err) {
    console.error('[dcsBios worker] failed to enable broadcast (sending commands will fail)', err)
  }
})

setInterval(flushFields, FLUSH_INTERVAL_MS)
setInterval(reportStatusAndStats, STATUS_STATS_INTERVAL_MS)

// ---- Sending commands ----

// Wire format confirmed against the real developer guide: "A command
// consists of a control identifier, a space, an argument and a newline
// character," broadcast as UDP to DcsBiosSettings.sendPort. No response is
// expected from DCS-BIOS — this is fire-and-forget, same as a physical
// switch flip.
function sendDcsBiosCommand(identifier: string, argument: string): void {
  const message = `${identifier} ${argument}\n`
  socket.send(Buffer.from(message, 'ascii'), sendPort, SEND_BROADCAST_ADDRESS, (err) => {
    if (err) console.error(`[dcsBios worker] failed to send command "${message.trim()}"`, err)
  })
}

// ---- Request handling ----

function handleRequest(req: DcsBiosWorkerRequest): DcsBiosWorkerResponse {
  switch (req.type) {
    case 'listAircraft':
      return { type: 'aircraftList', aircraft: listAircraft() }
    case 'getFieldCatalog':
      return { type: 'fieldCatalog', fields: loadAircraftData(req.aircraft).fields }
    case 'getCommandCatalog':
      return { type: 'commandCatalog', commands: loadAircraftData(req.aircraft).commands }
    case 'registerAircraft':
      registerAircraft(req.aircraft)
      return { type: 'ack' }
    case 'unregisterAircraft':
      unregisterAircraft(req.aircraft)
      return { type: 'ack' }
    case 'sendCommand':
      sendDcsBiosCommand(req.identifier, req.argument)
      return { type: 'ack' }
  }
}

port.on('message', (msg: { kind: 'req'; id: string; payload: DcsBiosWorkerRequest }) => {
  if (msg.kind !== 'req') return
  try {
    const payload = handleRequest(msg.payload)
    port.postMessage({ kind: 'res', id: msg.id, ok: true, payload })
  } catch (err) {
    port.postMessage({ kind: 'res', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
