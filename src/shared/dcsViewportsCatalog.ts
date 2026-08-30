// Aircraft -> component catalog for the DCS Viewports plugin. Each
// component's `id` is the exact DCS MonitorSetup.lua viewport name (see
// wiki.hoggitworld.com/view/Exporting_MFCD_Displays and the DCS-Helios-MFD
// project's FA-18C MonitorSetup config) — `luaWriter.ts` uses these ids
// verbatim as lua table names, and DCS looks them up by this exact string.
// Hornet-only for now: it needs no core-game-file edits to export these
// (some other modules require an extra dofile/ViewportHandling.lua injected
// into the module's own cockpit init, which this deliberately avoids).
// Adding another aircraft later is just another entry here.
import type { ScreenRegion } from './types'

export interface DcsViewportComponent {
  id: string
  label: string
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
      { id: 'CENTER_MFCD', label: 'AMPCD' }
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
export function computeAircraftSlots(virtualDisplayBounds: ScreenRegion, aircraft: string): Record<string, ScreenRegion> {
  const profile = DCS_AIRCRAFT_CATALOG[aircraft]
  if (!profile || profile.components.length === 0) return {}
  const count = profile.components.length
  const squareSize = Math.floor(Math.min(virtualDisplayBounds.width / count, virtualDisplayBounds.height))
  const slots: Record<string, ScreenRegion> = {}
  profile.components.forEach((component, index) => {
    const x = virtualDisplayBounds.x + index * squareSize
    slots[component.id] = { x, y: virtualDisplayBounds.y, width: squareSize, height: squareSize }
  })
  return slots
}

export function computeComponentSlot(virtualDisplayBounds: ScreenRegion, aircraft: string, componentId: string): ScreenRegion | null {
  return computeAircraftSlots(virtualDisplayBounds, aircraft)[componentId] ?? null
}
