// App-wide, user-created REST data sources — same cached-JSON-in-userData
// idiom as appSettings.ts/deviceApproval.ts (get() caches+loads on first
// call, update() merges/replaces and writes back). Unlike those, this store
// is a list of independent instances (id-keyed), not a single settings
// object, so `update` here replaces the whole array — the Settings panel
// always round-trips its full locally-edited draft, same as
// DcsBiosSettingsPanel's Save button does for its one settings object.
// Incoming-only — see RestWebhookTarget/restWebhookTargets.ts for the
// unrelated outgoing direction, split out from what used to be this same
// entity's `outgoing` half.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RestDataSource } from '../shared/types'

const DEFAULT_PORT_START = 18080

function dataFilePath(): string {
  return join(app.getPath('userData'), 'rest-data-sources.json')
}

let cached: RestDataSource[] | null = null

// Tolerates a pre-split file still shaped like the old combined entity
// (`{ incoming: {port, bearerToken, targetDeckId, mappings}, outgoing }`) —
// lifts the incoming half up flat and drops outgoing, rather than losing an
// existing source's port/token/mappings/target-deck the first time this
// runs after upgrading.
function normalize(raw: unknown): RestDataSource[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const legacyIncoming = (entry as { incoming?: Partial<RestDataSource> }).incoming
    if (!legacyIncoming) return entry as RestDataSource
    const { id, name, enabled } = entry as { id: string; name: string; enabled: boolean }
    return { id, name, enabled, ...legacyIncoming } as RestDataSource
  })
}

export function getRestDataSources(): RestDataSource[] {
  if (cached) return cached
  try {
    const raw = readFileSync(dataFilePath(), 'utf-8')
    cached = normalize(JSON.parse(raw))
  } catch {
    cached = []
  }
  return cached
}

export function updateRestDataSources(sources: RestDataSource[]): RestDataSource[] {
  cached = sources
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(dataFilePath(), JSON.stringify(sources, null, 2), 'utf-8')
  return cached
}

// First port at/after DEFAULT_PORT_START not already claimed by another
// configured source — just a starting suggestion for a freshly-created
// source, not a reservation; the user can still retype it into a collision
// (surfaced back via rest-sources:list's listening/listenError, see
// main/restIncoming.ts).
function nextDefaultPort(existing: RestDataSource[]): number {
  const used = new Set(existing.map((s) => s.port))
  let port = DEFAULT_PORT_START
  while (used.has(port)) port++
  return port
}

export function createRestDataSource(name: string): RestDataSource {
  const existing = getRestDataSources()
  const source: RestDataSource = {
    id: randomUUID(),
    name,
    enabled: true,
    port: nextDefaultPort(existing),
    bearerToken: randomBytes(24).toString('base64url'),
    targetDeckId: '',
    mappings: []
  }
  updateRestDataSources([...existing, source])
  return source
}

export function regenerateRestDataSourceToken(sourceId: string): RestDataSource[] {
  const next = getRestDataSources().map((s) => (s.id === sourceId ? { ...s, bearerToken: randomBytes(24).toString('base64url') } : s))
  return updateRestDataSources(next)
}
