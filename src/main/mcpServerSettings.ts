// The MCP server's own settings — a single object, not a list (there's
// exactly one MCP server, unlike restDataSources.ts's N independent
// sources), same cached-JSON-in-userData idiom as appSettings.ts. Whether
// the server actually RUNS is gated by the separate app-wide 'mcp' entry in
// AppSettings.enabledPlugins (see shared/plugins/mcp.ts) — this file only
// owns the bearer token, generated once on first read so a token exists as
// soon as the feature can be turned on, not deferred until the user opens
// the settings panel.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface McpServerSettings {
  bearerToken: string
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'mcp-server-settings.json')
}

function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

let cached: McpServerSettings | null = null

// Main/mcp/server.ts's bearer-token check calls this per-request — since
// `cached` is only ever replaced by regenerateMcpServerToken (which also
// writes through to disk immediately), the in-memory value here is always
// current, so a token regenerated from the settings panel takes effect on
// the very next request with no app restart, same freshness restIncoming.ts
// already relies on for RestDataSource tokens.
export function getMcpServerSettings(): McpServerSettings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    cached = { bearerToken: generateToken(), ...(JSON.parse(raw) as Partial<McpServerSettings>) }
  } catch {
    cached = { bearerToken: generateToken() }
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsFilePath(), JSON.stringify(cached, null, 2), 'utf-8')
  }
  return cached
}

export function regenerateMcpServerToken(): McpServerSettings {
  const next: McpServerSettings = { bearerToken: generateToken() }
  cached = next
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsFilePath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
