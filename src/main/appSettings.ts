// App-wide "enabled data sources" gating — see EVENT_SOURCE_TYPES in
// shared/eventSources.ts for the kinds this gates, and syncEventSources in
// index.ts for where disabling actually stops a kind's producer (not just
// hides it from EventsModal's add-picker). Deliberately generic, not
// DCS-BIOS-specific: a future high-intensity kind just adds an
// EVENT_SOURCE_TYPES entry and it's automatically covered here too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { EVENT_SOURCE_TYPES } from '../shared/eventSources'

export interface AppSettings {
  enabledDataSources: string[]
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

// Opt-out, not opt-in — every known kind enabled by default, so nothing an
// existing user has configured silently vanishes on upgrade to a version
// that adds this gate.
function defaultSettings(): AppSettings {
  return { enabledDataSources: EVENT_SOURCE_TYPES.map((t) => t.kind) }
}

let cached: AppSettings | null = null

export function getAppSettings(): AppSettings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    cached = { ...defaultSettings(), ...parsed }
  } catch {
    cached = defaultSettings()
  }
  return cached
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...getAppSettings(), ...patch }
  cached = next
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsFilePath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
