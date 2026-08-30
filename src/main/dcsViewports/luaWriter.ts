// Generates the DCS MonitorSetup.lua that points every cataloged aircraft's
// components at the virtual display. A valid MonitorSetup.lua must also
// describe the main 3D view (Viewports.Center) — DCS uses this file to
// describe the WHOLE display configuration, not just the extra viewports —
// so this deliberately sizes Center to the user's actual primary monitor
// (not the virtual display), preserving their normal single-monitor 3D view.
// Users with a more elaborate existing multi-monitor MonitorSetup should
// merge this by hand; replicating an arbitrary existing setup is out of
// scope (see the settings panel's copy, which says as much).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen } from 'electron'
import type { ScreenRegion } from '../../shared/types'
import { computeAircraftSlots, DCS_AIRCRAFT_CATALOG } from '../../shared/dcsViewportsCatalog'

const GENERATED_LUA_NAME = 'Boarderoni.lua'

// Tiling math lives in dcsViewportsCatalog.ts's computeAircraftSlots — the
// DCS Viewport widget's capture resolver uses the exact same function, so
// the crop it captures always matches what this writes into the lua.
function aircraftViewportEntries(virtualDisplayBounds: ScreenRegion): string {
  const blocks: string[] = []
  for (const [aircraftId, aircraft] of Object.entries(DCS_AIRCRAFT_CATALOG)) {
    const slots = computeAircraftSlots(virtualDisplayBounds, aircraftId)
    for (const component of aircraft.components) {
      const slot = slots[component.id]
      if (!slot) continue
      blocks.push(
        `${component.id} = {\n    x = ${slot.x};\n    y = ${slot.y};\n    width = ${slot.width};\n    height = ${slot.height};\n}`
      )
    }
  }
  return blocks.join('\n\n')
}

// The resolution (and render-surface origin) DCS itself needs for
// MonitorSetup.lua's absolute-pixel viewports to land correctly. DCS's
// Fullscreen mode, when the requested resolution doesn't match a single
// physical output, spans the union of the WHOLE Windows virtual desktop —
// every currently connected monitor, even ones no viewport references —
// anchored at that union's own top-left corner, not at the OS-designated
// primary display's (0,0). Confirmed empirically: with a monitor positioned
// left of the primary (negative x in Electron's `screen` bounds), DCS drew
// Viewports.Center starting at that monitor's edge instead of the primary's,
// because Center's x/y were written primary-relative while DCS's own frame
// starts at the union's corner instead. Pure — no filesystem/Electron
// access, so it's testable with plain rects — split out so the settings
// panel can show the resolution without generating a whole lua string.
export function virtualDesktopBounds(displays: ScreenRegion[]): ScreenRegion {
  const x = Math.min(...displays.map((d) => d.x))
  const y = Math.min(...displays.map((d) => d.y))
  const right = Math.max(...displays.map((d) => d.x + d.width))
  const bottom = Math.max(...displays.map((d) => d.y + d.height))
  return { x, y, width: right - x, height: bottom - y }
}

export function getVirtualDesktopBounds(): ScreenRegion {
  return virtualDesktopBounds(
    screen.getAllDisplays().map((d) => ({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }))
  )
}

// `overrideDisplayId` is DcsViewportsSettings.primaryDisplayId — lets the
// user pick which physical monitor is the "gaming" one when the OS-level
// primary isn't it (common once a virtual display is in the mix: adding one
// can shuffle which display Windows calls primary, and multi-monitor rigs
// often game on a non-primary screen already). Falls back to the real OS
// primary if the override id no longer resolves to a live display (e.g. a
// monitor was unplugged since it was picked).
export function getPrimaryBounds(overrideDisplayId?: number | null): ScreenRegion {
  const override = overrideDisplayId != null ? screen.getAllDisplays().find((d) => d.id === overrideDisplayId) : undefined
  const bounds = (override ?? screen.getPrimaryDisplay()).bounds
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
}

// `desktopOrigin` is virtualDesktopBounds()'s own x/y — the top-left of the
// union of every connected monitor, which is what DCS's render surface is
// actually anchored to (see virtualDesktopBounds's comment above). Defaults
// to (0,0), which is only correct when the primary monitor is itself the
// desktop union's top-left (true for the common two-monitor primary+virtual
// case, which is also what the tests below exercise); real call sites
// always pass the real one via writeBoarderoniLua.
export function buildMonitorSetupLua(
  primaryBounds: ScreenRegion,
  virtualDisplayBounds: ScreenRegion,
  desktopOrigin: { x: number; y: number } = { x: 0, y: 0 }
): string {
  const center: ScreenRegion = { ...primaryBounds, x: primaryBounds.x - desktopOrigin.x, y: primaryBounds.y - desktopOrigin.y }
  const virtual: ScreenRegion = {
    ...virtualDisplayBounds,
    x: virtualDisplayBounds.x - desktopOrigin.x,
    y: virtualDisplayBounds.y - desktopOrigin.y
  }
  const aspect = center.width / center.height
  return `-- Generated by Boarderoni (DCS Viewports plugin). Do not edit by hand — it is
-- overwritten whenever plugin settings change. This file only adds named
-- component viewports on the Boarderoni virtual display; the main 3D view
-- below is sized to your primary monitor, not the virtual display.
_ = declare_globals or {}

name = "Boarderoni"
description = "Boarderoni-managed DDI/AMPCD viewports"

Viewports = {
    Center = {
        x = ${center.x};
        y = ${center.y};
        width = ${center.width};
        height = ${center.height};
        viewDx = 0;
        viewDy = 0;
        aspect = ${aspect};
        hudAspect = ${aspect};
    };
}
UIMainView = Viewports.Center

${aircraftViewportEntries(virtual)}
`
}

function monitorSetupDir(savedGamesDir: string): string {
  return join(savedGamesDir, 'Config', 'MonitorSetup')
}

// Exposed so callers (the settings panel, via DcsViewportsStatus.luaPath)
// can point at exactly where the file is expected, even before/without a
// successful write — same path writeBoarderoniLua itself writes to.
export function boarderoniLuaPath(savedGamesDir: string): string {
  return join(monitorSetupDir(savedGamesDir), GENERATED_LUA_NAME)
}

// Writes only Boarderoni.lua — never touches any other file in that folder,
// so an existing user MonitorSetup.lua (e.g. from Winwing SimAppPro) is
// left alone; this just adds a new selectable entry to DCS's Monitors list.
export function writeBoarderoniLua(savedGamesDir: string, virtualDisplayBounds: ScreenRegion, primaryDisplayId?: number | null): void {
  const primaryBounds = getPrimaryBounds(primaryDisplayId)
  const desktopOrigin = getVirtualDesktopBounds()
  const dir = monitorSetupDir(savedGamesDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(boarderoniLuaPath(savedGamesDir), buildMonitorSetupLua(primaryBounds, virtualDisplayBounds, desktopOrigin), 'utf-8')
}
