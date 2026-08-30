// Virtual Display Driver (github.com/VirtualDrivers/Virtual-Display-Driver)
// detection + resolution management. The driver's PnP device lifecycle
// (install/uninstall) is intentionally out of scope — the user installs it
// themselves via the official installer (link surfaced in the settings
// panel when not detected); this module only detects it and drives an
// already-live virtual monitor to the resolution Boarderoni needs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, type Display } from 'electron'
import type { ScreenRegion } from '../../shared/types'
import type { DcsViewportsStatus } from '../../shared/dcsViewportsTypes'
import {
  applyDisplayMode,
  getDeviceNameForBounds,
  isVirtualDisplayDriverPnpPresent,
  listDisplayModes,
  togglePnpDeviceElevated,
  type DisplayMode
} from './resolutionScript'

// NOT the same string as Windows' own PnP adapter friendly name ("Virtual
// Display Driver", seen in Device Manager / Get-PnpDevice) — Electron's
// Display.label reports the MONITOR's own EDID name instead, which for this
// driver is "VDD by MTT" (confirmed empirically: Device Manager and
// Electron disagree here, since one describes the adapter and the other the
// monitor). Matched case-insensitively as a substring rather than an exact
// string, in case of minor variation across driver versions.
const VIRTUAL_DISPLAY_LABEL_MATCH = 'vdd by mtt'
export const RELEASES_URL = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases'

// Fixed, not user-configurable: 1920x1080 is one of the driver's own
// shipped defaults (verified against a live install's vdd_settings.xml), so
// this resolution is essentially always already registered — the
// elevated-toggle path in ensureResolutionRegistered below almost never
// actually runs. The display is never seen, so there's no reason to expose
// this as a setting; components are tiled as squares within it regardless
// of its exact size (see dcsViewportsCatalog.ts's computeAircraftSlots).
export const VIRTUAL_DISPLAY_RESOLUTION = { width: 1920, height: 1080 }

const DEFAULT_REFRESH_RATE = 60

// Files the official installer always lays down at the chosen install dir
// (verified against a real install) — checked first since it's instant and
// works even if the PnP device is temporarily disabled.
export function detectVirtualDisplayDriverOnDisk(vddInstallDir: string): boolean {
  if (!vddInstallDir) return false
  return existsSync(join(vddInstallDir, 'MttVDD.dll')) && existsSync(join(vddInstallDir, 'vdd_settings.xml'))
}

export async function detectVirtualDisplayDriver(vddInstallDir: string): Promise<boolean> {
  if (detectVirtualDisplayDriverOnDisk(vddInstallDir)) return true
  try {
    return await isVirtualDisplayDriverPnpPresent()
  } catch {
    return false
  }
}

// Matching by label is enough for the capture pipeline (captureRegionJpeg
// matches by bounds/id, not by raw device name, see screenCaptureWorker.ts).
// Re-resolved on every call rather than cached: a PnP toggle renumbers the
// underlying device (see resolutionScript.ts's top comment), so any cached
// Display object would go stale silently.
export function findVirtualDisplay(): Display | null {
  const displays = screen.getAllDisplays()
  return displays.find((d) => d.label.toLowerCase().includes(VIRTUAL_DISPLAY_LABEL_MATCH)) ?? null
}

function vddSettingsXmlPath(vddInstallDir: string): string {
  return join(vddInstallDir, 'vdd_settings.xml')
}

function resolutionInXml(xml: string, width: number, height: number): boolean {
  const pattern = new RegExp(`<width>\\s*${width}\\s*</width>\\s*<height>\\s*${height}\\s*</height>`)
  return pattern.test(xml)
}

// Naive string insertion, mirroring the vendor's own fixxml.ps1 approach to
// this same file — no XML library needed for a schema this small and stable.
function appendResolutionToXml(xml: string, width: number, height: number, refreshRate: number): string {
  const entry = `        <resolution>\n            <width>${width}</width>\n            <height>${height}</height>\n            <refresh_rate>${refreshRate}</refresh_rate>\n        </resolution>\n    `
  return xml.replace('</resolutions>', `${entry}</resolutions>`)
}

async function ensureResolutionRegistered(vddInstallDir: string, width: number, height: number, refreshRate: number): Promise<void> {
  const path = vddSettingsXmlPath(vddInstallDir)
  const xml = readFileSync(path, 'utf-8')
  if (resolutionInXml(xml, width, height)) return
  writeFileSync(path, appendResolutionToXml(xml, width, height, refreshRate), 'utf-8')
  // Only a genuinely new resolution needs the elevated reload — this is the
  // one UAC prompt the whole plugin ever needs, and only the first time a
  // given custom size is used (see resolutionScript.ts's top comment).
  await togglePnpDeviceElevated()
}

async function findMatchingLiveMode(deviceName: string, width: number, height: number): Promise<DisplayMode | null> {
  const modes = await listDisplayModes(deviceName)
  // Prefer the highest refresh rate available at this resolution.
  const candidates = modes.filter((m) => m.width === width && m.height === height)
  if (candidates.length === 0) return null
  return candidates.reduce((best, m) => (m.frequency > best.frequency ? m : best))
}

// Orchestrates: driver present? -> display live? -> resolution already
// live? -> (if not) register + elevate + reload -> apply. Called on plugin
// enable, on relevant settings changes, and once at startup if already
// enabled (see main/index.ts).
export async function ensureVirtualDisplayReady(vddInstallDir: string, width: number, height: number): Promise<DcsViewportsStatus> {
  const driverInstalled = await detectVirtualDisplayDriver(vddInstallDir)
  if (!driverInstalled) {
    return { driverInstalled: false, displayReady: false, displayId: null, bounds: null, reason: 'Virtual Display Driver not detected' }
  }

  let display = findVirtualDisplay()
  if (!display) {
    return { driverInstalled: true, displayReady: false, displayId: null, bounds: null, reason: 'Virtual display not found by Windows (is it enabled?)' }
  }

  const deviceName = await getDeviceNameForBounds(display.bounds)
  if (!deviceName) {
    return { driverInstalled: true, displayReady: false, displayId: display.id, bounds: null, reason: 'Could not resolve the virtual display\'s device name' }
  }

  let mode = await findMatchingLiveMode(deviceName, width, height)
  if (!mode) {
    await ensureResolutionRegistered(vddInstallDir, width, height, DEFAULT_REFRESH_RATE)
    // The elevated toggle above renumbers the device — re-resolve both the
    // Electron Display and its GDI name before touching either again.
    display = findVirtualDisplay()
    const freshDeviceName = display && (await getDeviceNameForBounds(display.bounds))
    if (!display || !freshDeviceName) {
      return { driverInstalled: true, displayReady: false, displayId: null, bounds: null, reason: 'Virtual display disappeared after registering the new resolution' }
    }
    mode = await findMatchingLiveMode(freshDeviceName, width, height)
    if (!mode) {
      return { driverInstalled: true, displayReady: false, displayId: display.id, bounds: null, reason: `Resolution ${width}x${height} still not available after reload` }
    }
    const applied = await applyDisplayMode(freshDeviceName, mode)
    display = findVirtualDisplay()
    if (!applied || !display) {
      return { driverInstalled: true, displayReady: false, displayId: display?.id ?? null, bounds: null, reason: 'Failed to apply the new resolution' }
    }
  } else {
    const applied = await applyDisplayMode(deviceName, mode)
    if (!applied) {
      return { driverInstalled: true, displayReady: false, displayId: display.id, bounds: null, reason: 'Failed to apply resolution' }
    }
    display = findVirtualDisplay()
    if (!display) {
      return { driverInstalled: true, displayReady: false, displayId: null, bounds: null, reason: 'Virtual display disappeared after applying resolution' }
    }
  }

  const bounds: ScreenRegion = { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height }
  return { driverInstalled: true, displayReady: true, displayId: display.id, bounds }
}
