import { AUTO_CLICKED_LIGHTEN } from './constants'

export const DEFAULT_WIDGET_COLOR = '#2a2e37'

export const COLOR_PALETTE = [
  '#2a2e37',
  '#3a3f4a',
  '#5b8def',
  '#4caf7d',
  '#e2b93b',
  '#e2793b',
  '#e2547b',
  '#8b5be2',
  '#e8e8ea',
  '#14161b'
]

// This file is included in both the main-process and renderer TS projects
// (see tsconfig.node.json/tsconfig.web.json's shared/** glob) even though
// only the renderer actually imports it — so it must stay DOM-free at
// compile time, not just "unreachable at runtime" in Node. A colorExpr/
// borderColorExpr can return any valid CSS color, not just hex ('red',
// rgb(), hsl(), ...), and resolving those requires asking an actual DOM;
// rather than reference DOM types/globals directly here, renderer-only
// bootstrap code (see main.tsx) installs that capability via this hook —
// hexToRgb still works hex-only (its original behavior) if nothing ever
// calls setExtendedColorResolver, e.g. if this module were ever evaluated
// somewhere without a DOM.
type ExtendedColorResolver = (color: string) => [number, number, number] | null
let extendedColorResolver: ExtendedColorResolver | null = null
export function setExtendedColorResolver(resolver: ExtendedColorResolver): void {
  extendedColorResolver = resolver
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (match) return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
  return extendedColorResolver ? extendedColorResolver(hex) : null
}

// Converts a hex color + 0-1 opacity into an rgba() string, for widget
// background/text/border transparency. Falls back to the hex color as-is if
// it isn't parseable (e.g. already an rgba string).
export function withOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

// WCAG relative-luminance heuristic: picks black or white text, whichever
// contrasts more against an arbitrary background color.
export function pickLegibleTextColor(backgroundColor: string): string {
  const rgb = hexToRgb(backgroundColor)
  if (!rgb) return '#ffffff'

  const [r, g, b] = rgb.map((c) => {
    const channel = c / 255
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

  return luminance > 0.5 ? '#14161b' : '#ffffff'
}

// Darkens a hex color by a 0-1 fraction toward black — used for the
// "auto" border color, a subtly darker shade of the widget's background.
export function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.round(c * (1 - amount))))
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const AUTO_BORDER_DARKEN = 0.25

export function pickAutoBorderColor(backgroundColor: string): string {
  return darken(backgroundColor, AUTO_BORDER_DARKEN)
}

// A switch position's auto-derived "selected" look — same brighten treatment
// as ButtonWidget's auto-derived "Clicked" state (see deriveClickedState in
// shared/states.ts), just applied to a switch position's color instead of a
// button's.
export function pickAutoActiveColor(unselectedColor: string): string {
  return lighten(unselectedColor, AUTO_CLICKED_LIGHTEN)
}

// Lightens a hex color by a 0-1 fraction toward white — used to auto-derive
// a "clicked" look from a widget's default color.
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb.map((c) => Math.min(255, Math.round(c + (255 - c) * amount)))
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// h in [0, 360), s/v in [0, 1] — used by HsvColorPicker's saturation/value
// square and hue slider.
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((n) => Math.round((n + m) * 255)) as [number, number, number]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`
}

// Falls back to black rather than throwing on an unparseable hex — callers
// (HsvColorPicker) may see a value mid-edit that isn't valid yet.
export function hexToHsv(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex)
  if (!rgb) return [0, 0, 0]
  return rgbToHsv(...rgb)
}

export function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(...hsvToRgb(h, s, v))
}
