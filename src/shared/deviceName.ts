import type { DeviceInfo } from './types'

// Whatever the user set via the view client's device settings modal, else
// the userAgent-derived guess. Use this wherever a device is displayed.
export function displayDeviceName(device: Pick<DeviceInfo, 'customName' | 'userAgent'>): string {
  return device.customName?.trim() || friendlyDeviceName(device.userAgent)
}

// Best-effort, heuristic — the web platform doesn't expose a real device
// name, so this just turns the raw user-agent string into something a human
// can recognize in the device dropdown.
export function friendlyDeviceName(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device'

  // Android WebView UAs embed the marketing/model name right after the OS
  // version, e.g. "...Android 14; Pixel 8 Pro Build/...". Some WebViews
  // append a "Build/XXXX" suffix to that same field, so strip it off.
  const androidMatch = /Android\s[\d.]+;\s*([^)]+)\)/.exec(userAgent)
  if (androidMatch) {
    const model = androidMatch[1].split('Build/')[0].trim()
    return model || 'Android device'
  }

  if (/iPad/.test(userAgent)) return 'iPad'
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/Macintosh/.test(userAgent)) return 'Mac'
  if (/Windows/.test(userAgent)) return 'Windows PC'
  if (/Linux/.test(userAgent)) return 'Linux device'

  return 'Unknown device'
}
