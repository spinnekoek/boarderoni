// Starts/stops one http.createServer per enabled RestDataSource — this is
// the "webhook producer" main/plugins/index.ts's own comment already
// anticipated ("register a route on start and deregister on stop via a
// small shared route-registry the HTTP server consults"), except each REST
// source is user-ported rather than sharing the app's one fixed SERVER_PORT,
// so it gets its own listener instead of a route on the existing server.
//
// Deliberately has no idea what a "room" or "variable" is — like
// PluginProducer.start(instance, emit), this module's only job is
// "authenticate + parse + flatten a request body, then hand it off." Turning
// that into variable updates on some deck's room is main/index.ts's job (see
// applyRestIncoming there), same producer/emit split every other event
// source already uses. This keeps restIncoming.ts a leaf module — it only
// imports shared types + restDataSources.ts, never main/index.ts — avoiding
// a circular import with the module that actually owns `rooms`.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { flattenJson } from '../shared/flattenJson'
import type { RestDataSource } from '../shared/types'
import { getRestDataSources } from './restDataSources'
import { getAppSettings } from './appSettings'
import { readBody } from './httpBody'
import { timingSafeStringEqual } from './timingSafeAuth'

interface RunningServer {
  server: Server
  signature: string
}

const runningServers = new Map<string, RunningServer>()
const listenStatus = new Map<string, { listening: boolean; listenError?: string }>()

export function getRestListenStatus(sourceId: string): { listening: boolean; listenError?: string } {
  return listenStatus.get(sourceId) ?? { listening: false }
}

// REST Data Sources' own master switch — a core plugin (see
// PluginTypeMeta.core in shared/plugins/rest.ts), toggled from the same
// Settings enable-list every other plugin uses. Off means every listener
// below tears down regardless of each individual source's own `enabled`
// flag, same layering DCS-BIOS's kind-level gate already gives its own
// per-instance config.
function restPluginEnabled(): boolean {
  return getAppSettings().enabledPlugins.includes('rest')
}

// Only {enabled, port, bearerToken} matter here — a mapping/target-deck
// edit doesn't need a restart since the request handler re-fetches the live
// source on every request (see below), same "no restart needed for mapping
// edits" reasoning syncPlugins' own pluginSignature already documents.
function signatureOf(source: RestDataSource): string {
  return JSON.stringify({ enabled: source.enabled, port: source.port, bearerToken: source.bearerToken })
}

async function handleRequest(
  sourceId: string,
  emit: (sourceId: string, flattened: Record<string, unknown>) => void,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Re-fetched per request (not the `source` this server was created with)
  // so a mapping/target-deck/outgoing edit takes effect on the very next
  // request with no restart.
  const source = getRestDataSources().find((s) => s.id === sourceId)
  if (!source || !source.enabled || !restPluginEnabled()) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Data source unavailable' }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Only POST is accepted' }))
    return
  }
  if (!timingSafeStringEqual(req.headers.authorization ?? '', `Bearer ${source.bearerToken}`)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid or missing bearer token' }))
    return
  }

  let body: unknown
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  try {
    emit(sourceId, flattenJson(body))
  } catch (err) {
    console.error(`[boarderoni] REST incoming mapping failed (${source.name})`, err)
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export function syncRestIncomingServers(emit: (sourceId: string, flattened: Record<string, unknown>) => void): void {
  const pluginEnabled = restPluginEnabled()
  const sources = getRestDataSources()
  const byId = new Map(sources.map((s) => [s.id, s]))

  for (const [id, running] of runningServers) {
    const source = byId.get(id)
    if (!source || !source.enabled || !pluginEnabled || signatureOf(source) !== running.signature) {
      running.server.close()
      runningServers.delete(id)
      if (!source) listenStatus.delete(id)
    }
  }

  // Master switch off — every listener above has already been torn down;
  // nothing below should start back up regardless of each source's own
  // `enabled` flag.
  if (!pluginEnabled) {
    for (const source of sources) listenStatus.set(source.id, { listening: false })
    return
  }

  for (const source of sources) {
    if (!source.enabled) {
      listenStatus.set(source.id, { listening: false })
      continue
    }
    if (runningServers.has(source.id)) continue

    const server = createServer((req, res) => {
      handleRequest(source.id, emit, req, res).catch((err) => {
        console.error(`[boarderoni] REST incoming request failed (${source.name})`, err)
        if (!res.headersSent) res.writeHead(500).end()
      })
    })
    // e.g. EADDRINUSE — surfaced via listenStatus (see rest-sources:list)
    // instead of crashing the process; ports here are user-chosen and can
    // collide, unlike SERVER_PORT's fixed constant.
    server.on('error', (err) => {
      listenStatus.set(source.id, { listening: false, listenError: err instanceof Error ? err.message : String(err) })
    })
    server.listen(source.port, () => {
      listenStatus.set(source.id, { listening: true })
    })
    runningServers.set(source.id, { server, signature: signatureOf(source) })
  }
}
