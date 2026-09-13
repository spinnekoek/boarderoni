// App-wide, user-created REST webhook targets — the outgoing counterpart
// split out of what used to be RestDataSource's own `outgoing` half (see
// that interface's comment in shared/types.ts and RestDataSource's own
// header comment here in restDataSources.ts, which this file mirrors).
// Simpler than restDataSources.ts: no listener, no port/token to allocate,
// so there's no equivalent of nextDefaultPort/regenerateToken here.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RestWebhookTarget } from '../shared/types'

function dataFilePath(): string {
  return join(app.getPath('userData'), 'rest-webhook-targets.json')
}

let cached: RestWebhookTarget[] | null = null

// Backfills `method`/`headers` for a target saved before either field
// existed (method/headers/auth-header support added after the initial
// incoming/outgoing split) — same "missing means it predates this feature,
// not that the user cleared it" reasoning appSettings.ts's own
// migrateLegacySettings uses.
function normalize(raw: unknown): RestWebhookTarget[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => ({ method: 'POST', headers: [], ...(entry as RestWebhookTarget) }))
}

export function getRestWebhookTargets(): RestWebhookTarget[] {
  if (cached) return cached
  try {
    const raw = readFileSync(dataFilePath(), 'utf-8')
    cached = normalize(JSON.parse(raw))
  } catch {
    cached = []
  }
  return cached
}

export function updateRestWebhookTargets(targets: RestWebhookTarget[]): RestWebhookTarget[] {
  cached = targets
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(dataFilePath(), JSON.stringify(targets, null, 2), 'utf-8')
  return cached
}

export function createRestWebhookTarget(name: string): RestWebhookTarget {
  const target: RestWebhookTarget = { id: randomUUID(), name, enabled: true, method: 'POST', url: '', headers: [], payloadTemplate: '{}' }
  updateRestWebhookTargets([...getRestWebhookTargets(), target])
  return target
}
