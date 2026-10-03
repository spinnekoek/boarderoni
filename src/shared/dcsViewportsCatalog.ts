// Aircraft -> component catalog for the DCS Viewports plugin. Each
// component's `id` is the exact DCS MonitorSetup.lua viewport name (see
// wiki.hoggitworld.com/view/Exporting_MFCD_Displays and the DCS-Helios-MFD
// project's FA-18C MonitorSetup config) — `luaWriter.ts` uses these ids
// verbatim as lua table names, and DCS looks them up by this exact string.
// The MFCDs need no core-game-file edits to export. Components that DO
// (the RWR scopes) carry an `initFile`: the module's own indicator init
// script, which main/dcsViewports/rwrPatcher.ts patches (with a one-time
// backup) to call try_find_assigned_viewport(<id>). Adding another aircraft
// later is just another entry here.
import type { ScreenRegion } from './types'

export interface DcsViewportComponent {
  id: string
  label: string
  // Path (forward slashes) relative to the DCS install folder of the init
  // script that must be patched for DCS to honor this viewport name.
  initFile?: string
  // Skips the MFCD-bezel crop applied to captures (see resolveComponentRegion).
  noBezelInset?: boolean
  // Extra capture crop (px) on the left edge only, for components whose
  // texture carries a stray strip of the neighbouring viewport there.
  leftInsetPx?: number
  // Square slot edge in px; defaults to the even-split size shared by the rest.
  size?: number
}

export interface DcsAircraftProfile {
  label: string
  components: DcsViewportComponent[]
}

export const DCS_AIRCRAFT_CATALOG: Record<string, DcsAircraftProfile> = {
  hornet: {
    label: 'F/A-18C Hornet',
    components: [
      { id: 'LEFT_MFCD', label: 'Left DDI' },
      { id: 'RIGHT_MFCD', label: 'Right DDI' },
      { id: 'CENTER_MFCD', label: 'AMPCD' },
      {
        id: 'RWR_FA18C',
        label: 'RWR (ALR-67)',
        // The BAKE init, not RWR_ALR67_init.lua: the shipped config.lua has
        // bakeIndicators = true, and ED's own MFCDs call
        // try_find_assigned_viewport from their *_bake_init.lua in that mode.
        initFile: 'Mods/aircraft/FA-18C/Cockpit/Scripts/TEWS/indicator/BAKE/RWR_ALR67_bake_init.lua',
        noBezelInset: true,
        leftInsetPx: 6,
        size: 320
      }
    ]
  }
}

export function findComponent(aircraft: string, componentId: string): DcsViewportComponent | undefined {
  return DCS_AIRCRAFT_CATALOG[aircraft]?.components.find((c) => c.id === componentId)
}

// Single source of truth for "where does each component sit on the virtual
// display" — used both by luaWriter.ts (to tell DCS where to draw) and by
// the DCS Viewport widget's capture resolver (to know where to crop from).
// They must never compute this independently, or a future layout tweak in
// one place would silently desync the capture crop from what DCS actually
// draws there. Real DDIs/AMPCDs are roughly square, so each component gets
// a square slot sized to fit `count` of them in one row — NOT stretched to
// fill the full display height, which would distort the instrument's
// aspect ratio. The virtual display is never actually seen, so the leftover
// space below the row is simply left black; that's fine.
// Black gutter between neighbouring slots so edge bleed/rounding from one
// instrument's render never shows up in the next one's capture.
const SLOT_GAP = 8

export function computeAircraftSlots(virtualDisplayBounds: ScreenRegion, aircraft: string): Record<string, ScreenRegion> {
  const profile = DCS_AIRCRAFT_CATALOG[aircraft]
  if (!profile || profile.components.length === 0) return {}
  const count = profile.components.length
  const defaultSize = Math.floor(Math.min((virtualDisplayBounds.width - SLOT_GAP * (count - 1)) / count, virtualDisplayBounds.height))
  const slots: Record<string, ScreenRegion> = {}
  let x = virtualDisplayBounds.x
  for (const component of profile.components) {
    const size = Math.min(component.size ?? defaultSize, virtualDisplayBounds.height)
    slots[component.id] = { x, y: virtualDisplayBounds.y, width: size, height: size }
    x += size + SLOT_GAP
  }
  return slots
}

export function computeComponentSlot(virtualDisplayBounds: ScreenRegion, aircraft: string, componentId: string): ScreenRegion | null {
  return computeAircraftSlots(virtualDisplayBounds, aircraft)[componentId] ?? null
}
