// Thin facade for main/index.ts — keeps the WS-handler code there thin,
// same split as dcsBios/connectionManager.ts vs. its call sites.
import type { ScreenRegion } from '../../shared/types'
import type { DcsViewportsSettings, DcsViewportsStatus } from '../../shared/dcsViewportsTypes'
import { computeComponentSlot } from '../../shared/dcsViewportsCatalog'
import { ensureVirtualDisplayReady, VIRTUAL_DISPLAY_RESOLUTION } from './driver'
import { boarderoniLuaPath, getVirtualDesktopBounds, writeBoarderoniLua } from './luaWriter'
import {
  getSettings as getStoredSettings,
  updateSettings as updateStoredSettings,
  validateDcsInstallDir,
  validateSavedGamesDir
} from './settingsManager'

export type { DcsViewportsSettings, DcsViewportsStatus } from '../../shared/dcsViewportsTypes'
export { validateDcsInstallDir, validateSavedGamesDir }

let cachedStatus: DcsViewportsStatus = {
  driverInstalled: false,
  displayReady: false,
  displayId: null,
  bounds: null,
  luaWritten: false,
  luaPath: null,
  recommendedGameResolution: null
}
const statusHandlers = new Set<(status: DcsViewportsStatus) => void>()

function setStatus(status: DcsViewportsStatus): void {
  cachedStatus = status
  for (const handler of statusHandlers) handler(status)
}

export function getSettings(): DcsViewportsSettings {
  return getStoredSettings()
}

export function getStatus(): DcsViewportsStatus {
  return cachedStatus
}

export function onStatusChange(handler: (status: DcsViewportsStatus) => void): () => void {
  statusHandlers.add(handler)
  return () => statusHandlers.delete(handler)
}

// Re-checks the driver/display against current settings and, only if the
// display comes up ready, rewrites Boarderoni.lua against its live bounds
// (which can shift — e.g. the elevated PnP toggle in driver.ts renumbers
// the device). Called on plugin enable, on settings Save, and once at
// startup if already enabled (see main/index.ts).
export async function refreshStatus(): Promise<DcsViewportsStatus> {
  const settings = getStoredSettings()
  const driverAndDisplay = await ensureVirtualDisplayReady(settings.vddInstallDir, VIRTUAL_DISPLAY_RESOLUTION.width, VIRTUAL_DISPLAY_RESOLUTION.height)
  const luaPath = settings.savedGamesDir ? boarderoniLuaPath(settings.savedGamesDir) : null
  let luaWritten = false
  if (driverAndDisplay.displayReady && driverAndDisplay.bounds && settings.savedGamesDir) {
    try {
      writeBoarderoniLua(settings.savedGamesDir, driverAndDisplay.bounds, settings.primaryDisplayId)
      luaWritten = true
    } catch (err) {
      console.error('[dcsViewports] failed to write Boarderoni.lua', err)
    }
  }
  // The union of every connected monitor, not just primary+virtual — see
  // luaWriter.ts's virtualDesktopBounds for why an unrelated third monitor
  // still has to be included here. Only width/height are meaningful to the
  // settings panel (it's a resolution, not a position).
  const desktopBounds = driverAndDisplay.bounds ? getVirtualDesktopBounds() : null
  const recommendedGameResolution = desktopBounds ? { width: desktopBounds.width, height: desktopBounds.height } : null
  const status: DcsViewportsStatus = { ...driverAndDisplay, luaWritten, luaPath, recommendedGameResolution }
  setStatus(status)
  return status
}

export async function updateSettings(patch: Partial<DcsViewportsSettings>): Promise<DcsViewportsSettings> {
  const next = updateStoredSettings(patch)
  await refreshStatus()
  return next
}

// Resolves a 'dcs-viewport' widget's componentKey ("<aircraftId>:<componentId>")
// into the region/displayId the capture pipeline needs — this, not the
// widget itself, is the single point of truth for where each component's
// pixels actually are, which is what keeps the region "locked" (see
// DcsViewportWidget's own comment in shared/types.ts). Returns null while
// the display isn't ready or the key doesn't parse/resolve, in which case
// the caller should serve a 404 same as an unconfigured Screen Capture
// widget does.
//
// DCS renders each MFCD/AMPCD with its own cockpit-instrument bezel baked
// into the texture, filling the whole slot regardless of the slot's size —
// confirmed by measuring a live AMPCD capture pixel-by-pixel (sharp,
// scanning inward from each edge for the first non-black pixel): a ~2.5%
// black margin on every side (16px/640 left-right, ~12px/640 top-bottom).
// It's invisible on the DDIs only because their own background happens to
// be black too. This crops it back out of the CAPTURE only — the lua's
// viewport size (what DCS actually renders into, via computeAircraftSlots)
// is untouched, since the bezel doesn't shrink if the target viewport does.
const BEZEL_INSET_RATIO = 0.03

export function resolveComponentRegion(componentKey: string | undefined): { region: ScreenRegion; displayId: number } | null {
  if (!componentKey) return null
  if (!cachedStatus.displayReady || !cachedStatus.bounds || cachedStatus.displayId === null) return null
  const [aircraftId, componentId] = componentKey.split(':')
  if (!aircraftId || !componentId) return null
  const slot = computeComponentSlot(cachedStatus.bounds, aircraftId, componentId)
  if (!slot) return null
  const insetX = Math.round(slot.width * BEZEL_INSET_RATIO)
  const insetY = Math.round(slot.height * BEZEL_INSET_RATIO)
  const region: ScreenRegion = {
    x: slot.x + insetX,
    y: slot.y + insetY,
    width: slot.width - insetX * 2,
    height: slot.height - insetY * 2
  }
  return { region, displayId: cachedStatus.displayId }
}
