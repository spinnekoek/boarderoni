// Plain data shapes for the DCS Viewports plugin — no Node APIs, so the
// renderer can import this directly (same reasoning as dcsBiosTypes.ts).
import type { ScreenRegion } from './types'

export interface DcsViewportsSettings {
  vddInstallDir: string
  dcsInstallDir: string
  savedGamesDir: string
  activeAircraft: string
  // Which physical monitor DCS's main 3D view (Viewports.Center) is sized to
  // — see luaWriter.ts's getPrimaryBounds. null means "trust Windows' own
  // primary display", which is right for most setups but wrong whenever the
  // OS-designated primary isn't the monitor the user actually games on.
  primaryDisplayId: number | null
}

// Reported after ensureVirtualDisplayReady() runs (on plugin enable, on
// settings save, and once at startup if already enabled) — drives the
// settings panel's status banner and whether 'dcs-viewport' widgets are
// allowed to stream (see main/index.ts's per-widget-type gate).
export interface DcsViewportsStatus {
  driverInstalled: boolean
  displayReady: boolean
  displayId: number | null
  bounds: ScreenRegion | null
  reason?: string
  // Whether Boarderoni.lua was actually (re)written the last time
  // refreshStatus() ran — surfaced in the settings panel so "did enabling
  // this actually do anything yet" is never a guess. luaPath is set even
  // when luaWritten is false-due-to-error, so the panel can point at
  // exactly where it expected to write.
  luaWritten: boolean
  luaPath: string | null
  // The Fullscreen resolution DCS itself needs — spans every connected
  // monitor, not just the primary + virtual display (see luaWriter.ts's
  // virtualDesktopBounds for why) — so the settings panel can tell the user
  // the exact number instead of them having to work it out by hand. Null
  // until the virtual display is ready, same as bounds.
  recommendedGameResolution: { width: number; height: number } | null
}
