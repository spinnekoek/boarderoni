import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { DcsViewportsSettings } from '../../shared/dcsViewportsTypes'

const DEFAULT_VDD_INSTALL_DIR = 'C:\\VirtualDisplayDriver'

function candidateDcsInstallDirs(): string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  return ['DCS World', 'DCS World OpenBeta'].map((name) => join(programFiles, 'Eagle Dynamics', name))
}

function probeDcsInstallDir(): string {
  return candidateDcsInstallDirs().find((candidate) => existsSync(candidate)) ?? ''
}

function candidateSavedGamesDirs(): string[] {
  return ['DCS', 'DCS.openbeta', 'DCS.openalpha'].map((branch) => join(app.getPath('home'), 'Saved Games', branch))
}

function probeSavedGamesDir(): string {
  return candidateSavedGamesDirs().find((candidate) => existsSync(candidate)) ?? ''
}

function defaultSettings(): DcsViewportsSettings {
  return {
    // Only one real-world install location exists in practice (the
    // installer doesn't offer a custom path) — suggested unconditionally,
    // driver.ts's own detection falls back to a live PnP check regardless.
    vddInstallDir: DEFAULT_VDD_INSTALL_DIR,
    dcsInstallDir: probeDcsInstallDir(),
    savedGamesDir: probeSavedGamesDir(),
    activeAircraft: 'hornet',
    primaryDisplayId: null
  }
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'dcs-viewports-settings.json')
}

let cachedSettings: DcsViewportsSettings | null = null

function loadSettings(): DcsViewportsSettings {
  if (cachedSettings) return cachedSettings
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DcsViewportsSettings>
    cachedSettings = { ...defaultSettings(), ...parsed }
  } catch {
    cachedSettings = defaultSettings()
  }
  return cachedSettings
}

function persistSettings(settings: DcsViewportsSettings): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function getSettings(): DcsViewportsSettings {
  return loadSettings()
}

export function updateSettings(patch: Partial<DcsViewportsSettings>): DcsViewportsSettings {
  const next: DcsViewportsSettings = { ...loadSettings(), ...patch }
  cachedSettings = next
  persistSettings(next)
  return next
}

// Lets the settings UI show validity feedback for an arbitrary candidate
// path before Save, same pattern as DCS-BIOS's validateDocsDir.
export function validateSavedGamesDir(candidateDir: string): { valid: boolean } {
  try {
    return { valid: existsSync(candidateDir) }
  } catch {
    return { valid: false }
  }
}

export function validateDcsInstallDir(candidateDir: string): { valid: boolean } {
  try {
    return { valid: existsSync(join(candidateDir, 'bin', 'DCS.exe')) }
  } catch {
    return { valid: false }
  }
}
