// App-wide "enabled plugins" gating — see PLUGIN_TYPES in shared/plugins
// for the kinds this gates, and syncPlugins in index.ts for where disabling
// actually stops a kind's producer (not just hides it from
// EventSourcesModal's add-picker) and, for a kind with widgetTypes (e.g. Screen Capture),
// renders its widgets inert too. Deliberately generic, not DCS-BIOS-
// specific: a future plugin just adds a PLUGIN_TYPES entry and it's
// automatically covered here too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { PLUGIN_TYPES } from '../shared/plugins'

export interface AppSettings {
  enabledPlugins: string[]
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

// Opt-out, not opt-in — every known kind enabled by default, so nothing an
// existing user has configured silently vanishes on upgrade to a version
// that adds this gate.
function defaultSettings(): AppSettings {
  return { enabledPlugins: PLUGIN_TYPES.map((t) => t.kind) }
}

// A file saved before the event-source → plugin rename has `enabledDataSources`
// instead of `enabledPlugins`, possibly still naming the old 'ocrRegion' kind
// (now merged into 'screenCapture' — see shared/plugins/screenCapture.ts).
// Read once here so an existing user's actual saved preference (e.g. having
// deliberately disabled DCS-BIOS) survives the rename instead of silently
// reverting to defaultSettings()' all-enabled fallback.
//
// Also backfills any PLUGIN_TYPES kind entirely missing from the saved list
// — not just at first-ever-launch (defaultSettings() already covers that),
// but every time, since a kind can be ADDED to a version an existing user
// already has settings saved from (e.g. 'random'/'rest' didn't exist when
// they first configured this). Without this, `enabledPlugins.includes(kind)`
// reads a kind that simply didn't exist yet as indistinguishable from one
// the user deliberately disabled — silently turning off, say, every REST
// listener on upgrade. There's no way to tell "never existed" apart from
// "user turned it off" in a plain inclusion list, so this always resolves
// that ambiguity toward "enabled," matching this file's own opt-out
// philosophy (see defaultSettings' comment) consistently, not just once.
function migrateLegacySettings(parsed: Partial<AppSettings> & { enabledDataSources?: string[] }): Partial<AppSettings> {
  const legacy = parsed.enabledPlugins ?? parsed.enabledDataSources
  if (!legacy) return parsed
  const renamed = legacy.map((kind) => (kind === 'ocrRegion' ? 'screenCapture' : kind))
  const missing = PLUGIN_TYPES.map((t) => t.kind).filter((kind) => !renamed.includes(kind))
  return { enabledPlugins: [...renamed, ...missing] }
}

let cached: AppSettings | null = null

export function getAppSettings(): AppSettings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    const parsed = migrateLegacySettings(JSON.parse(raw))
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
