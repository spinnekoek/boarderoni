import { describe, expect, it } from 'vitest'
import { buildMonitorSetupLua, virtualDesktopBounds } from './luaWriter'

describe('buildMonitorSetupLua', () => {
  it('tiles every cataloged component as adjacent squares, not stretched to full height', () => {
    const primary = { x: 0, y: 0, width: 3440, height: 1440 }
    // The actual fixed virtual-display resolution (see driver.ts's
    // VIRTUAL_DISPLAY_RESOLUTION) — deliberately not square itself, to prove
    // components come out square regardless.
    const virtual = { x: 3440, y: 0, width: 1920, height: 1080 }
    const lua = buildMonitorSetupLua(primary, virtual)

    // Hornet catalog: LEFT_MFCD, RIGHT_MFCD, CENTER_MFCD.
    const leftX = extractField(lua, 'LEFT_MFCD', 'x')
    const leftWidth = extractField(lua, 'LEFT_MFCD', 'width')
    const rightX = extractField(lua, 'RIGHT_MFCD', 'x')
    const rightWidth = extractField(lua, 'RIGHT_MFCD', 'width')
    const centerX = extractField(lua, 'CENTER_MFCD', 'x')
    const centerWidth = extractField(lua, 'CENTER_MFCD', 'width')

    expect(leftX).toBe(virtual.x)
    expect(leftX + leftWidth).toBe(rightX)
    expect(rightX + rightWidth).toBe(centerX)
    expect(centerX + centerWidth).toBeLessThanOrEqual(virtual.x + virtual.width)

    for (const name of ['LEFT_MFCD', 'RIGHT_MFCD', 'CENTER_MFCD']) {
      const width = extractField(lua, name, 'width')
      const height = extractField(lua, name, 'height')
      expect(extractField(lua, name, 'y')).toBe(virtual.y)
      expect(height).toBe(width) // square, not stretched
      expect(height).toBeLessThanOrEqual(virtual.height)
    }
  })

  it('sizes the main 3D view to the primary monitor, not the virtual display', () => {
    const primary = { x: 0, y: 0, width: 3440, height: 1440 }
    const virtual = { x: 3440, y: 0, width: 1920, height: 1080 }
    const lua = buildMonitorSetupLua(primary, virtual)

    expect(lua).toContain('width = 3440')
    expect(lua).toContain('height = 1440')
    expect(lua).toContain('UIMainView = Viewports.Center')
  })

  it('shifts every viewport by the desktop origin when a third monitor sits left of the primary', () => {
    // Reproduces a real reported setup: a 1920x1080 monitor positioned left
    // of (and not top-aligned with) the primary, pushing the true desktop
    // union's top-left to a negative x. DCS anchors its render surface there,
    // not at the primary's own (0,0) — see virtualDesktopBounds's comment.
    const thirdMonitor = { x: -1920, y: 174, width: 1920, height: 1080 }
    const primary = { x: 0, y: 0, width: 3440, height: 1440 }
    const virtual = { x: 3440, y: 0, width: 1920, height: 1080 }
    const origin = virtualDesktopBounds([thirdMonitor, primary, virtual])

    expect(origin).toEqual({ x: -1920, y: 0, width: 7280, height: 1440 })

    const lua = buildMonitorSetupLua(primary, virtual, origin)
    expect(extractField(lua, 'Center', 'x')).toBe(primary.x - origin.x) // 1920
    expect(extractField(lua, 'LEFT_MFCD', 'x')).toBe(virtual.x - origin.x) // 5360
  })
})

function extractField(lua: string, blockName: string, field: string): number {
  const blockMatch = new RegExp(`${blockName} = \\{([\\s\\S]*?)\\n\\}`).exec(lua)
  if (!blockMatch) throw new Error(`block ${blockName} not found`)
  const fieldMatch = new RegExp(`${field} = (-?\\d+);`).exec(blockMatch[1])
  if (!fieldMatch) throw new Error(`field ${field} not found in ${blockName}`)
  return Number(fieldMatch[1])
}
