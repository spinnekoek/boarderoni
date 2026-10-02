// Patches a module's indicator init script so DCS exports it to the named
// viewport in Boarderoni.lua. Unlike the MFCDs, RWR scopes only export when
// the init script itself calls try_find_assigned_viewport (see the ED forum's
// "Exporting Displays (RWR, Radar, etc)" threads). Edits are confined to a
// marker-delimited block so re-applying is idempotent, and the pristine file
// is copied to <file>.boarderoni.bak once, never overwritten.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RwrPatchStatus } from '../../shared/dcsViewportsTypes'
import { DCS_AIRCRAFT_CATALOG } from '../../shared/dcsViewportsCatalog'

const BEGIN = '-- boarderoni begin'
const END = '-- boarderoni end'
const BLOCK_RE = /[ \t]*-- boarderoni begin[\s\S]*?-- boarderoni end[ \t]*(\r?\n)?/

export function buildPatchBlock(viewportName: string, eol: string): string {
  return [
    BEGIN,
    'dofile(LockOn_Options.common_script_path.."ViewportHandling.lua")',
    `try_find_assigned_viewport("${viewportName}")`,
    END
  ].join(eol)
}

// Pure: returns the file text with the block inserted/replaced, or unchanged
// text if it's already correct.
export function applyPatchToSource(source: string, viewportName: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const block = buildPatchBlock(viewportName, eol)
  if (BLOCK_RE.test(source)) return source.replace(BLOCK_RE, () => block + eol)
  const sep = source.endsWith('\n') ? '' : eol
  return source + sep + eol + block + eol
}

export function isPatchedSource(source: string, viewportName: string): boolean {
  return source.includes(BEGIN) && source.includes(`try_find_assigned_viewport("${viewportName}")`)
}

interface Target {
  aircraft: string
  componentId: string
  label: string
  initFile: string
}

function patchTargets(): Target[] {
  const targets: Target[] = []
  for (const [aircraft, profile] of Object.entries(DCS_AIRCRAFT_CATALOG)) {
    for (const c of profile.components) {
      if (c.initFile) targets.push({ aircraft, componentId: c.id, label: `${profile.label} ${c.label}`, initFile: c.initFile })
    }
  }
  return targets
}

function statusFor(dcsInstallDir: string, t: Target, apply: boolean): RwrPatchStatus {
  const base = { key: `${t.aircraft}:${t.componentId}`, label: t.label }
  if (!dcsInstallDir) return { ...base, state: 'missing', detail: 'DCS install folder not set' }
  const path = join(dcsInstallDir, ...t.initFile.split('/'))
  if (!existsSync(path)) return { ...base, state: 'missing', detail: `Not found: ${path}` }
  try {
    const source = readFileSync(path, 'utf-8')
    if (isPatchedSource(source, t.componentId)) return { ...base, state: 'patched' }
    if (!apply) return { ...base, state: 'unpatched' }
    const backup = `${path}.boarderoni.bak`
    if (!existsSync(backup)) copyFileSync(path, backup)
    writeFileSync(path, applyPatchToSource(source, t.componentId), 'utf-8')
    return { ...base, state: 'patched' }
  } catch (err) {
    return { ...base, state: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}

export function checkRwrPatches(dcsInstallDir: string): RwrPatchStatus[] {
  return patchTargets().map((t) => statusFor(dcsInstallDir, t, false))
}

export function applyRwrPatches(dcsInstallDir: string): RwrPatchStatus[] {
  return patchTargets().map((t) => statusFor(dcsInstallDir, t, true))
}
