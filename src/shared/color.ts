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

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!match) return null
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
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

// Lightens a hex color by a 0-1 fraction toward white — used to auto-derive
// a "clicked" look from a widget's default color.
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb.map((c) => Math.min(255, Math.round(c + (255 - c) * amount)))
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
